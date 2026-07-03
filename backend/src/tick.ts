import { Address, Asset, BASE_FEE, Horizon, Operation, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { signTransaction } from '@wolf1276/kairos-sdk';
import { getKairosClient } from './kairos.js';
import { getAgentSigner, getActiveDelegationForAgent, recordTick, stopAgent } from './agentService.js';
import { mapExecutionError, mapThrownError } from './errors.js';
import type { AgentRow } from './db.js';
import type { DcaStrategyConfig, JsonSafeDelegation, LimitStrategyConfig, QuantStrategyConfig, RoleStrategyConfig } from './types.js';
import { getCandles, getLatestPrice, TESTNET_USDC_ISSUER } from './priceHistory.js';
import { getStrategy } from './strategies/index.js';
import { getNetwork } from './config.js';
import { logEvent } from './auditService.js';
import { executePaperQuantTrade, executePaperLimitOrder } from './paperExecutor.js';
import { recordCompletedTrade } from './executionEngine.js';

const HORIZON_TESTNET_URL = 'https://horizon-testnet.stellar.org';

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

    const txHash =
      row.mode === 'paper'
        ? await executePaperQuantTrade(row, { ...strategy, amountPerTrade: amount }, signal)
        : await executeQuantTrade(row, { ...strategy, amountPerTrade: amount }, signal);

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

    if (row.mode === 'live' && !getActiveDelegationForAgent(row)) {
      logEvent({ agentId: row.id, owner: row.owner, eventType: 'delegation_invalid', mode: row.mode, mpcAccount: row.public_key, pair: strategy.pair, message: 'Live limit agent has no active delegation — cannot trade without on-chain authority' });
      recordTick(row.id, { ok: false, message: 'No active delegation — attach one before starting a live limit agent' });
      return;
    }

    const txHash = row.mode === 'paper' ? await executePaperLimitOrder(row, strategy, price) : await executeLimitOrder(row, strategy, price);

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

/** True if the loaded account already trusts `asset` (native XLM never needs a trustline). */
function hasTrustline(account: Awaited<ReturnType<Horizon.Server['loadAccount']>>, asset: Asset): boolean {
  if (asset.isNative()) return true;
  return account.balances.some(
    (b) =>
      b.asset_type !== 'native' &&
      (b as { asset_code: string; asset_issuer: string }).asset_code === asset.getCode() &&
      (b as { asset_code: string; asset_issuer: string }).asset_issuer === asset.getIssuer()
  );
}

/** Submits a real classic Stellar path payment for a quant buy/sell signal, signed by the
 *  agent's own keypair (the agent trades from its own funded Stellar account — see
 *  agentService.createAgent — not via the Kairos SDK delegation `execute()`). Currently only
 *  the XLM/USDC pair is supported: 'buy' spends USDC to acquire XLM, 'sell' spends XLM to
 *  acquire USDC. Mirrors apps/web/app/lib/stellar.ts's executeSwap, reimplemented server-side.
 *  A freshly-created agent account only holds native XLM (friendbot funding) — it has no USDC
 *  trustline yet, so a missing trustline is established here in the same transaction as the
 *  trade, rather than requiring a separate manual setup step per agent. */
export async function executeQuantTrade(row: AgentRow, strategy: { pair: string; amountPerTrade: string }, side: 'buy' | 'sell'): Promise<string> {
  if (strategy.pair !== 'XLM/USDC') {
    throw new Error(`Unsupported pair for trading: ${strategy.pair}`);
  }

  const signer = await getAgentSigner(row);
  const networkPassphrase =
    getNetwork() === 'testnet'
      ? 'Test SDF Network ; September 2015'
      : 'Public Global Stellar Network ; September 2015';

  const server = new Horizon.Server(HORIZON_TESTNET_URL, { allowHttp: false });
  const account = await server.loadAccount(signer.publicKey());

  const usdcAsset = new Asset('USDC', TESTNET_USDC_ISSUER);
  const xlmAsset = Asset.native();

  // 'buy' means "buy XLM with USDC" per the quant strategy's own trade side vocabulary (a
  // buy signal on the pair increases XLM exposure); 'sell' unwinds it back to USDC.
  const sendAsset = side === 'buy' ? usdcAsset : xlmAsset;
  const destAsset = side === 'buy' ? xlmAsset : usdcAsset;
  const amount = strategy.amountPerTrade;

  const needsUsdcTrustline = !hasTrustline(account, usdcAsset);

  const op = Operation.pathPaymentStrictSend({
    sendAsset,
    sendAmount: amount,
    destination: signer.publicKey(),
    destAsset,
    destMin: '0.0000001',
  });

  const builder = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase });
  if (needsUsdcTrustline) {
    builder.addOperation(Operation.changeTrust({ asset: usdcAsset }));
  }
  const transaction = builder.addOperation(op).setTimeout(30).build();
  await signTransaction(transaction, signer);

  const result = await server.submitTransaction(transaction);
  return result.hash;
}

const LIMIT_ORDER_SLIPPAGE = 0.02;

/** Executes a one-shot limit order once its trigger has fired (see runLimitTick). Unlike
 *  executeQuantTrade (which always fixes the *sent* amount via pathPaymentStrictSend),
 *  strategy.quantity is denominated in strategy.asset regardless of side — "buy 5 XLM" and
 *  "sell 5 XLM" both mean exactly 5 XLM changes hands, so 'buy' uses pathPaymentStrictReceive
 *  (fix the amount received, cap what's spent) and 'sell' uses pathPaymentStrictSend (fix the
 *  amount given up, floor what's received). `price` is the latest USDC-per-XLM price used to
 *  size the other side of the trade with a slippage buffer. */
async function executeLimitOrder(row: AgentRow, strategy: LimitStrategyConfig, price: number): Promise<string> {
  if (strategy.pair !== 'XLM/USDC') {
    throw new Error(`Unsupported pair for trading: ${strategy.pair}`);
  }
  if (strategy.asset !== 'XLM' && strategy.asset !== 'USDC') {
    throw new Error(`Unsupported asset for limit order: ${strategy.asset}`);
  }

  const signer = await getAgentSigner(row);
  const networkPassphrase =
    getNetwork() === 'testnet'
      ? 'Test SDF Network ; September 2015'
      : 'Public Global Stellar Network ; September 2015';

  const server = new Horizon.Server(HORIZON_TESTNET_URL, { allowHttp: false });
  const account = await server.loadAccount(signer.publicKey());

  const usdcAsset = new Asset('USDC', TESTNET_USDC_ISSUER);
  const xlmAsset = Asset.native();

  const quantity = parseFloat(strategy.quantity);
  // The other side's amount, converting through the USDC-per-XLM price: XLM -> USDC multiplies,
  // USDC -> XLM divides.
  const otherSideAmount = strategy.asset === 'XLM' ? quantity * price : quantity / price;

  let op;
  if (strategy.asset === 'XLM') {
    op =
      strategy.side === 'buy'
        ? Operation.pathPaymentStrictReceive({
            sendAsset: usdcAsset,
            sendMax: (otherSideAmount * (1 + LIMIT_ORDER_SLIPPAGE)).toFixed(7),
            destination: signer.publicKey(),
            destAsset: xlmAsset,
            destAmount: quantity.toFixed(7),
          })
        : Operation.pathPaymentStrictSend({
            sendAsset: xlmAsset,
            sendAmount: quantity.toFixed(7),
            destination: signer.publicKey(),
            destAsset: usdcAsset,
            destMin: (otherSideAmount * (1 - LIMIT_ORDER_SLIPPAGE)).toFixed(7),
          });
  } else {
    op =
      strategy.side === 'buy'
        ? Operation.pathPaymentStrictReceive({
            sendAsset: xlmAsset,
            sendMax: (otherSideAmount * (1 + LIMIT_ORDER_SLIPPAGE)).toFixed(7),
            destination: signer.publicKey(),
            destAsset: usdcAsset,
            destAmount: quantity.toFixed(7),
          })
        : Operation.pathPaymentStrictSend({
            sendAsset: usdcAsset,
            sendAmount: quantity.toFixed(7),
            destination: signer.publicKey(),
            destAsset: xlmAsset,
            destMin: (otherSideAmount * (1 - LIMIT_ORDER_SLIPPAGE)).toFixed(7),
          });
  }

  const limitBuilder = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase });
  if (!hasTrustline(account, usdcAsset)) {
    limitBuilder.addOperation(Operation.changeTrust({ asset: usdcAsset }));
  }
  const transaction = limitBuilder.addOperation(op).setTimeout(30).build();
  await signTransaction(transaction, signer);

  const result = await server.submitTransaction(transaction);
  return result.hash;
}
