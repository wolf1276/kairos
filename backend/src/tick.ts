import { Address, xdr } from '@stellar/stellar-sdk';
import { getKairosClient } from './kairos.js';
import { getAgentSigner, getActiveDelegationForAgent, recordTick, stopAgent, tradesToday } from './agentService.js';
import { mapExecutionError, mapThrownError } from './errors.js';
import type { AgentRow } from './db.js';
import type { AgentPolicy, DcaStrategyConfig, JsonSafeDelegation, LimitStrategyConfig, QuantStrategyConfig, RoleStrategyConfig } from './types.js';
import { getCandles, getLatestPrice } from './priceHistory.js';
import { getStrategy } from './strategies/index.js';
import { logEvent } from './auditService.js';
import { executePaperQuantTrade, executePaperLimitOrder } from './paperExecutor.js';
import { recordCompletedTrade } from './executionEngine.js';
import { isProtocolExecutionEnabled } from './config.js';
import { executeProtocolAction } from './protocolExecutionService.js';
import { buildSoroswapSwapRequest } from './swapExecution.js';

/** Reads the agent's stored policy, if any. No policy on record (agents created before this
 *  existed, or without explicit policy input) is treated as unrestricted. */
function getPolicy(row: AgentRow): AgentPolicy | null {
  return row.policy_json ? (JSON.parse(row.policy_json) as AgentPolicy) : null;
}

/** Enforces the Permissions wizard step (agentcreation.md §4): blocks a tick outright if the
 *  capability it would exercise was never granted. Returns a block reason, or null if clear. */
export function capabilityGate(row: AgentRow, capability: keyof AgentPolicy['capabilities']): string | null {
  const policy = getPolicy(row);
  if (!policy) return null;
  if (!policy.capabilities[capability]) {
    return `Capability "${capability}" is disabled by this agent's policy`;
  }
  return null;
}

/** Enforces the Capital & Safety wizard step's "Maximum Allocation" limit (agentcreation.md
 *  §3): a single trade may not commit more than maxAllocationPct of the agent's allocated
 *  capital. No policy, or no capital on record, means no cap (e.g. paper agents predating
 *  policy persistence). `tradeAmountUnits` is in the pair's natural (decimal) units, matching
 *  `row.capital`'s convention. */
export function allocationGate(row: AgentRow, tradeAmountUnits: number): string | null {
  const policy = getPolicy(row);
  if (!policy || !row.capital) return null;
  const capital = parseFloat(row.capital);
  if (!(capital > 0)) return null;
  const pct = (tradeAmountUnits / capital) * 100;
  if (pct > policy.maxAllocationPct) {
    return `Trade would commit ${pct.toFixed(1)}% of capital, exceeding the ${policy.maxAllocationPct}% maxAllocationPct policy`;
  }
  return null;
}

function deserializeDelegation(d: JsonSafeDelegation) {
  return {
    ...d,
    salt: BigInt(d.salt),
    nonce: BigInt(d.nonce),
    caveats: d.caveats.map((c) => ({ enforcer: c.enforcer, terms: new Uint8Array(c.terms) })),
  };
}

/**
 * Runs one strategy tick for a single agent — branches on the strategy's `type`. 'dca' spends
 * a fixed amount via the delegated `execute()` call exactly as before. 'quant' evaluates a
 * registered signal function against recent candles and, on a buy/sell signal, submits a real
 * Stellar path payment signed by the agent's own keypair (not the Kairos delegation — quant
 * trades never move funds externally, they just rebalance within the agent's own account).
 * Respects `intervalSeconds` itself and records the outcome on the agent row either way.
 */
export async function runAgentTick(row: AgentRow): Promise<void> {
  if (!row.strategy_config_json) return;
  const strategy: DcaStrategyConfig | QuantStrategyConfig | LimitStrategyConfig | RoleStrategyConfig = JSON.parse(row.strategy_config_json);

  const now = Date.now();
  if (row.last_tick_at && now - row.last_tick_at < strategy.intervalSeconds * 1000) {
    return; // not due yet
  }

  // Enforces the wizard's Capital & Safety "Maximum Daily Trades" limit (agentcreation.md §3)
  // for every strategy type — previously collected in the UI but never sent to or checked by
  // the backend. No policy on record (agents created before this existed, or without explicit
  // policy input) means no cap.
  if (row.policy_json) {
    const policy = JSON.parse(row.policy_json) as AgentPolicy;
    if (policy.maxDailyTrades > 0 && tradesToday(row.id) >= policy.maxDailyTrades) {
      recordTick(row.id, { ok: true, message: `Daily trade limit reached (${policy.maxDailyTrades}) — skipping until tomorrow` });
      return;
    }
  }

  if (strategy.type === 'role') {
    // Autonomous role agents (yield/strategic/balancer) run their own decision pipeline.
    const { runRoleTick } = await import('./roleTick.js');
    await runRoleTick(row, strategy);
    return;
  }

  if (strategy.type === 'quant') {
    await runQuantTick(row, strategy);
    return;
  }

  if (strategy.type === 'limit') {
    await runLimitTick(row, strategy);
    return;
  }

  await runDcaTick(row, strategy);
}

async function runDcaTick(row: AgentRow, strategy: DcaStrategyConfig): Promise<void> {
  const capBlock = capabilityGate(row, 'dca');
  if (capBlock) {
    recordTick(row.id, { ok: true, message: capBlock });
    return;
  }
  const amountUnits = Number(BigInt(strategy.amountPerTick)) / 1e7;
  const allocBlock = allocationGate(row, amountUnits);
  if (allocBlock) {
    recordTick(row.id, { ok: true, message: allocBlock });
    return;
  }

  // Re-checked every tick (not just at attach time) so a mid-flight revoke or pause takes
  // effect on the next tick, not just at start-up.
  const delegationJson = getActiveDelegationForAgent(row);
  if (!delegationJson) {
    logEvent({
      agentId: row.id,
      owner: row.owner,
      eventType: 'delegation_invalid',
      mode: row.mode,
      mpcAccount: row.public_key,
      delegationValidation: { ok: false, reason: 'Delegation is revoked, paused, or missing' },
      message: 'Delegation is revoked, paused, or missing',
    });
    recordTick(row.id, { ok: false, message: 'Delegation is revoked, paused, or missing' });
    return;
  }

  const client = getKairosClient();
  const signer = await getAgentSigner(row);
  const delegation = deserializeDelegation(delegationJson);

  const amount = BigInt(strategy.amountPerTick);
  const hi = xdr.Int64.fromString(BigInt.asIntN(64, amount >> 64n).toString());
  const lo = xdr.Uint64.fromString(BigInt.asUintN(64, amount).toString());

  try {
    const result = await client.execution.execute({
      redeemer: signer,
      delegationChains: [[delegation]],
      executions: [
        {
          target: strategy.token,
          function: 'transfer',
          args: [
            Address.fromString(delegation.delegator).toScVal(),
            Address.fromString(strategy.destination).toScVal(),
            xdr.ScVal.scvI128(new xdr.Int128Parts({ hi, lo })),
          ],
        },
      ],
    });

    if (result.status !== 'SUCCESS') {
      recordTick(row.id, { ok: false, message: mapExecutionError(result) });
      return;
    }
    recordTick(row.id, { ok: true, message: `Sent ${strategy.amountPerTick} of ${strategy.token} to ${strategy.destination}. Tx: ${result.hash}` });
  } catch (error) {
    recordTick(row.id, { ok: false, message: mapThrownError(error) });
  }
}

export async function runQuantTick(row: AgentRow, strategy: QuantStrategyConfig): Promise<void> {
  const def = getStrategy(strategy.strategyId);
  if (!def) {
    recordTick(row.id, { ok: false, message: `Unknown strategy id: ${strategy.strategyId}` });
    return;
  }

  try {
    const candles = await getCandles(strategy.pair, strategy.intervalSeconds, 200);
    const signal = def.evaluate(candles);
    if (signal === 'hold') {
      recordTick(row.id, { ok: true, message: `${def.name}: hold (no trade)` });
      return;
    }

    const capBlock = capabilityGate(row, 'swap');
    if (capBlock) {
      recordTick(row.id, { ok: true, message: capBlock });
      return;
    }
    const allocBlock = allocationGate(row, Number(BigInt(strategy.amountPerTrade)) / 1e7);
    if (allocBlock) {
      recordTick(row.id, { ok: true, message: allocBlock });
      return;
    }

    if (row.mode === 'live' && !getActiveDelegationForAgent(row)) {
      logEvent({ agentId: row.id, owner: row.owner, eventType: 'delegation_invalid', mode: row.mode, mpcAccount: row.public_key, pair: strategy.pair, message: 'Live quant agent has no active delegation — cannot trade without on-chain authority' });
      recordTick(row.id, { ok: false, message: 'No active delegation — attach one before starting a live quant agent' });
      return;
    }

    const price = candles.length ? candles[candles.length - 1].close : null;
    if (price === null) {
      recordTick(row.id, { ok: false, message: 'No price data available to trade against' });
      return;
    }

    logEvent({
      agentId: row.id,
      owner: row.owner,
      eventType: 'signal_generated',
      mode: row.mode,
      strategyId: strategy.strategyId,
      mpcAccount: row.public_key,
      pair: strategy.pair,
      signal,
      marketSnapshot: candles.slice(-5),
      message: `${def.name} signal: ${signal} at ${price}`,
    });

    // amountPerTrade is in stroops (matches DcaStrategyConfig's convention and what the
    // frontend sends); Horizon's classic path payment ops take decimal amounts in the asset's
    // natural units (7dp), so convert once here and use the converted value everywhere below.
    const amount = (BigInt(strategy.amountPerTrade) / 10_000_000n).toString() + '.' + (BigInt(strategy.amountPerTrade) % 10_000_000n).toString().padStart(7, '0');

    const policy = row.policy_json ? (JSON.parse(row.policy_json) as AgentPolicy) : null;
    const txHash =
      row.mode === 'paper'
        ? await executePaperQuantTrade(row, { ...strategy, amountPerTrade: amount }, signal)
        : isProtocolExecutionEnabled()
          ? await executeQuantTradeViaProtocol(row, strategy, signal, price, policy?.maxSlippagePct ?? 1)
          : await executeQuantTrade(row, { ...strategy, amountPerTrade: amount }, signal, price, policy?.maxSlippagePct);

    recordCompletedTrade({
      row,
      strategyId: strategy.strategyId,
      side: signal,
      pair: strategy.pair,
      amount,
      price: String(price),
      txHash,
      mode: row.mode,
      eventType: 'trade_executed',
      message: `${def.name}: ${signal} ${amount} at ${price}. Tx: ${txHash}`,
    });
  } catch (error) {
    recordTick(row.id, { ok: false, message: mapThrownError(error) });
  }
}

/** A one-shot conditional order: re-checks the latest price every tick against
 *  triggerComparator/triggerPrice, and fires exactly once when the condition is met — then
 *  stops the agent so it never fires again. This is what "buy 5 XLM when price drops to X"
 *  parses into (see apps/web/lib/decision/hfIntentParser.ts and the trade page's Intent mode). */
export async function runLimitTick(row: AgentRow, strategy: LimitStrategyConfig): Promise<void> {
  try {
    const price = await getLatestPrice(strategy.pair);
    if (price === null) {
      recordTick(row.id, { ok: false, message: 'No price data available to evaluate the trigger' });
      return;
    }

    const trigger = parseFloat(strategy.triggerPrice);
    const met = evaluateLimitTrigger(strategy, price);
    if (!met) {
      recordTick(row.id, { ok: true, message: `Waiting: price ${price} (need ${strategy.triggerComparator === 'lte' ? '<=' : '>='} ${trigger})` });
      return;
    }

    logEvent({
      agentId: row.id,
      owner: row.owner,
      eventType: 'signal_generated',
      mode: row.mode,
      strategyId: 'limit',
      mpcAccount: row.public_key,
      pair: strategy.pair,
      signal: strategy.side,
      message: `Limit trigger met: price ${price} vs ${strategy.triggerComparator} ${trigger}`,
    });

    const capBlock = capabilityGate(row, 'swap');
    if (capBlock) {
      recordTick(row.id, { ok: true, message: capBlock });
      return;
    }
    const allocBlock = allocationGate(row, parseFloat(strategy.quantity));
    if (allocBlock) {
      recordTick(row.id, { ok: true, message: allocBlock });
      return;
    }

    if (row.mode === 'live' && !getActiveDelegationForAgent(row)) {
      logEvent({ agentId: row.id, owner: row.owner, eventType: 'delegation_invalid', mode: row.mode, mpcAccount: row.public_key, pair: strategy.pair, message: 'Live limit agent has no active delegation — cannot trade without on-chain authority' });
      recordTick(row.id, { ok: false, message: 'No active delegation — attach one before starting a live limit agent' });
      return;
    }

    const txHash = row.mode === 'paper'
      ? await executePaperLimitOrder(row, strategy, price)
      : isProtocolExecutionEnabled()
        ? await executeLimitOrderViaProtocol(row, strategy, price)
        : await executeLimitOrder(row, strategy, price);

    recordCompletedTrade({
      row,
      strategyId: 'limit',
      side: strategy.side,
      pair: strategy.pair,
      amount: strategy.quantity,
      price: String(price),
      txHash,
      mode: row.mode,
      eventType: 'trade_executed',
      message: `Order filled: ${strategy.side} ${strategy.quantity} ${strategy.asset} at ${price}. Tx: ${txHash}`,
    });
    stopAgent(row.id);
  } catch (error) {
    recordTick(row.id, { ok: false, message: mapThrownError(error) });
  }
}

/** Pure trigger check factored out of runLimitTick so PriceFeedService can reuse it for
 *  in-memory, sub-poll-interval evaluation against a streamed price tick. */
export function evaluateLimitTrigger(strategy: LimitStrategyConfig, price: number): boolean {
  const trigger = parseFloat(strategy.triggerPrice);
  return strategy.triggerComparator === 'lte' ? price <= trigger : price >= trigger;
}

/** Smart-Wallet-custodied counterpart to executeQuantTrade — routes the quant signal through the
 *  Soroswap adapter via executeProtocolAction (delegation/redemption path) instead of signing a
 *  classic Stellar path payment from the agent's own Turnkey account. Throws on failure so the
 *  calling try/catch in runQuantTick handles it identically to the paper and legacy branches. */
export async function executeQuantTradeViaProtocol(
  row: AgentRow,
  strategy: { pair: string; amountPerTrade: string },
  side: 'buy' | 'sell',
  price: number,
  maxSlippagePct: number
): Promise<string> {
  const request = buildSoroswapSwapRequest(strategy.pair, side, BigInt(strategy.amountPerTrade), price, maxSlippagePct);
  const result = await executeProtocolAction(row, request);
  if (!result.ok) {
    throw new Error(result.error ?? 'Protocol execution failed with no error detail');
  }
  return result.txHash!;
}

/** Smart-Wallet-custodied counterpart to executeLimitOrder — routes the limit fill through the
 *  Soroswap adapter via executeProtocolAction (delegation/redemption path). Converts the decimal
 *  quantity string to stroops for the protocol adapter. Throws on failure. */
async function executeLimitOrderViaProtocol(
  row: AgentRow,
  strategy: LimitStrategyConfig,
  price: number
): Promise<string> {
  const quantityStroops = BigInt(Math.floor(parseFloat(strategy.quantity) * 1e7));
  const request = buildSoroswapSwapRequest(strategy.pair, strategy.side, quantityStroops, price, 1);
  const result = await executeProtocolAction(row, request);
  if (!result.ok) {
    throw new Error(result.error ?? 'Protocol execution failed with no error detail');
  }
  return result.txHash!;
}

// P0-3: executeQuantTrade/executeLimitOrder used to sign and submit a classic Stellar path
// payment directly from the agent's own Turnkey-MPC account (see agentService.createAgent /
// provisionService.ts's funding note) instead of via CustomAccount.execute_from_executor +
// DelegationManager.redeem_delegations. That meant every live quant/limit trade — and every
// live strategic/balancer role trade, plus the yield role whenever ENABLE_PROTOCOL_EXECUTION is
// unset (see roleTick.ts's useProtocolExecution) — moved funds under sole backend/Turnkey
// custody: no on-chain Delegation validation and no on-chain Policy enforcement (spend limits,
// target whitelist, time restriction) ever ran for the trade itself. The one-time smart-wallet
// -> agent-account funding transfer (apps/web/app/lib/stellar.ts's withdrawFromSmartWallet) is
// owner-authorized and bounded by a spend-limit delegation, but nothing bounded what happened to
// that capital afterward — a direct violation of "funds must always remain under Smart Wallet
// custody" / "every execution flows through Smart Wallet -> Delegation -> Policy -> Execution".
// See docs/security/MAINNET_AUDIT.md, P0-3. Disabled for live trading (paper mode is unaffected
// — it never moves real funds) until a Smart-Wallet-custodied execution path exists for spot
// swaps, following the pattern executeProtocolAction/protocolAdapters/soroswap already use for
// the yield role's Blend deposit.
const LEGACY_LIVE_CUSTODY_ERROR =
  'Live trading via the legacy direct-custody path is disabled: it would move funds outside ' +
  'Smart Wallet custody without on-chain Delegation validation or Policy enforcement ' +
  '(docs/security/MAINNET_AUDIT.md, P0-3). Use paper mode, or a protocol-execution-backed strategy.';

export async function executeQuantTrade(
  _row: AgentRow,
  _strategy: { pair: string; amountPerTrade: string },
  _side: 'buy' | 'sell',
  _price: number,
  _maxSlippagePct?: number
): Promise<string> {
  throw new Error(LEGACY_LIVE_CUSTODY_ERROR);
}

async function executeLimitOrder(_row: AgentRow, _strategy: LimitStrategyConfig, _price: number): Promise<string> {
  throw new Error(LEGACY_LIVE_CUSTODY_ERROR);
}
