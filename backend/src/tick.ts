import { Address, Asset, BASE_FEE, Horizon, Operation, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { getKairosClient } from './kairos.js';
import { getAgentSigner, recordTick } from './agentService.js';
import { mapExecutionError, mapThrownError } from './errors.js';
import type { AgentRow } from './db.js';
import type { DcaStrategyConfig, JsonSafeDelegation, QuantStrategyConfig } from './types.js';
import { getCandles, TESTNET_USDC_ISSUER } from './priceHistory.js';
import { getStrategy } from './strategies/index.js';
import { insertTrade } from './tradeService.js';
import { computeAvgCostAndRealize } from './pnl.js';
import { getNetwork } from './config.js';

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
  const strategy: DcaStrategyConfig | QuantStrategyConfig = JSON.parse(row.strategy_config_json);

  const now = Date.now();
  if (row.last_tick_at && now - row.last_tick_at < strategy.intervalSeconds * 1000) {
    return; // not due yet
  }

  if (strategy.type === 'quant') {
    await runQuantTick(row, strategy);
    return;
  }

  await runDcaTick(row, strategy);
}

async function runDcaTick(row: AgentRow, strategy: DcaStrategyConfig): Promise<void> {
  if (!row.delegation_json) return;
  const delegationJson: JsonSafeDelegation = JSON.parse(row.delegation_json);

  const client = getKairosClient();
  const signer = getAgentSigner(row);
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

async function runQuantTick(row: AgentRow, strategy: QuantStrategyConfig): Promise<void> {
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

    const price = candles.length ? candles[candles.length - 1].close : null;
    if (price === null) {
      recordTick(row.id, { ok: false, message: 'No price data available to trade against' });
      return;
    }

    const txHash = await executeQuantTrade(row, strategy, signal);

    const { realizedPnl } = computeAvgCostAndRealize(row.id, strategy.pair, signal, strategy.amountPerTrade, String(price));
    insertTrade({
      agentId: row.id,
      strategyId: strategy.strategyId,
      side: signal,
      pair: strategy.pair,
      amount: strategy.amountPerTrade,
      price: String(price),
      txHash,
      status: 'success',
      realizedPnl,
    });

    recordTick(row.id, { ok: true, message: `${def.name}: ${signal} ${strategy.amountPerTrade} at ${price}. Tx: ${txHash}` });
  } catch (error) {
    recordTick(row.id, { ok: false, message: mapThrownError(error) });
  }
}

/** Submits a real classic Stellar path payment for a quant buy/sell signal, signed by the
 *  agent's own keypair (the agent trades from its own funded Stellar account — see
 *  agentService.createAgent — not via the Kairos SDK delegation `execute()`). Currently only
 *  the XLM/USDC pair is supported: 'buy' spends XLM to acquire USDC, 'sell' spends USDC to
 *  acquire XLM. Mirrors apps/web/app/lib/stellar.ts's executeSwap, reimplemented server-side. */
export async function executeQuantTrade(row: AgentRow, strategy: QuantStrategyConfig, side: 'buy' | 'sell'): Promise<string> {
  if (strategy.pair !== 'XLM/USDC') {
    throw new Error(`Unsupported pair for trading: ${strategy.pair}`);
  }

  const signer = getAgentSigner(row);
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

  const op = Operation.pathPaymentStrictSend({
    sendAsset,
    sendAmount: amount,
    destination: signer.publicKey(),
    destAsset,
    destMin: '0.0000001',
  });

  const transaction = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(op)
    .setTimeout(30)
    .build();
  transaction.sign(signer);

  const result = await server.submitTransaction(transaction);
  return result.hash;
}
