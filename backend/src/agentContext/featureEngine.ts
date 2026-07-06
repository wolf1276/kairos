// Centralized Feature Engine for the Agent Foundation Layer. Pure aggregation: every number here
// is computed by an existing service — this module never recomputes indicators, prices, PnL, or
// allocations itself. No AI, no decisions, no trade/protocol execution.
import { getDb } from '../db.js';
import { buildMarketContext } from '../decisionEngine.js';
import { getActiveDelegationForAgent, getAgentRow } from '../agentService.js';
import { computeAllocation, getTargets } from '../portfolioService.js';
import { listProtocolPositionsForAgent } from '../protocolPositionService.js';
import { computePnlSummary } from '../pnl.js';
import { getFeatureCacheProvider, cacheKey, featureCacheTtlForInterval } from './cache/index.js';
import type { CachedFeatureResult } from './cache/types.js';
import { classifyRegime } from './regimeDetector.js';
import type { AgentRow } from '../db.js';
import type { FeatureSet, ProtocolExposureEntry } from './types.js';
import { recordCacheHit, recordCacheMiss, recordProviderLatency } from './metrics.js';

export type FeatureBuildResult = CachedFeatureResult;

export class FeatureEngineError extends Error {}

/** Per-key in-flight computation tracker — prevents cache stampede:
 *  when N concurrent requests see the same cache miss, only the first
 *  actually computes; the rest await the same in-flight Promise. */
const inFlight = new Map<string, Promise<FeatureBuildResult | null>>();

function resolveSmartWalletAddress(row: AgentRow): string | null {
  if (!row.delegator) return null;
  const row_ = getDb()
    .prepare('SELECT address FROM smart_wallets WHERE owner = ? AND address = ?')
    .get(row.owner, row.delegator) as { address: string } | undefined;
  return row_?.address ?? row.delegator;
}

/**
 * Builds the normalized FeatureSet + regime classification for one agent+pair in a single pass
 * (one buildMarketContext call, so indicators/regime are computed exactly once per cache miss).
 * Reuses:
 * - decisionEngine.buildMarketContext (oracle candles + indicators + base regime)
 * - portfolioService.computeAllocation/getTargets, protocolPositionService.listProtocolPositionsForAgent
 * - pnl.computePnlSummary
 * Returns null if the oracle doesn't have enough candle history yet (same precondition
 * buildMarketContext itself enforces) — callers must treat that as "not ready", not an error.
 */
export async function buildFeatureResult(
  agentRow: AgentRow,
  pair: string,
  intervalSeconds: number,
  opts: { useCache?: boolean } = {}
): Promise<FeatureBuildResult | null> {
  const useCache = opts.useCache ?? true;
  const key = cacheKey(agentRow.id, pair);
  const cache = getFeatureCacheProvider();
  if (useCache) {
    const getStart = performance.now();
    const cached = await cache.get(key);
    recordProviderLatency(performance.now() - getStart);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();

    // Cache stampede protection: if another request is already computing
    // this key, await its result instead of starting a duplicate computation.
    const pending = inFlight.get(key);
    if (pending) {
      const result = await pending;
      if (result) recordCacheHit();
      return result;
    }
  }

  // Register this computation so concurrent callers can await it.
  const computation = buildFeatureResultInner(agentRow, pair, intervalSeconds, key, cache, useCache);
  inFlight.set(key, computation);

  try {
    const result = await computation;
    return result;
  } finally {
    // Always clean up — even on failure — to prevent stale Promise retention.
    inFlight.delete(key);
  }
}

async function buildFeatureResultInner(
  agentRow: AgentRow,
  pair: string,
  intervalSeconds: number,
  key: string,
  cache: ReturnType<typeof getFeatureCacheProvider>,
  useCache: boolean
): Promise<FeatureBuildResult | null> {
  const ctx = await buildMarketContext(pair, intervalSeconds);
  if (!ctx) return null;

  const regime = classifyRegime(ctx);
  const lastCandle = ctx.candles[ctx.candles.length - 1];
  const marketId = `${pair}@${lastCandle.time}`;
  const allocation = computeAllocation(agentRow.owner, ctx.price);
  const targets = getTargets(agentRow.owner);
  const protocolPositions = listProtocolPositionsForAgent(agentRow.id);
  const delegation = getActiveDelegationForAgent(agentRow);
  const pnl = computePnlSummary(agentRow.id, pair, ctx.price);

  const protocolExposure: ProtocolExposureEntry[] = protocolPositions.map((p) => ({
    protocolId: p.protocol_id,
    kind: p.kind,
    asset: p.asset,
    amount: p.amount,
  }));

  const parsedCapital = agentRow.capital ? parseFloat(agentRow.capital) : null;
  const capital = parsedCapital !== null && Number.isFinite(parsedCapital) ? parsedCapital : null;
  const parsedRealizedPnl = parseFloat(pnl.realizedPnl);
  const parsedUnrealizedPnl = parseFloat(pnl.unrealizedPnl);
  const realizedPnl = Number.isFinite(parsedRealizedPnl) ? parsedRealizedPnl : 0;
  const unrealizedPnl = Number.isFinite(parsedUnrealizedPnl) ? parsedUnrealizedPnl : 0;
  const rawDrawdownPct = capital && capital > 0 ? ((realizedPnl + unrealizedPnl) / capital) * 100 : null;
  const drawdownPct = rawDrawdownPct !== null && Number.isFinite(rawDrawdownPct) ? rawDrawdownPct : null;

  const featureSet: FeatureSet = {
    pair,
    price: ctx.price,
    trend: {
      ema20: ctx.indicators.ema20,
      ema50: ctx.indicators.ema50,
      sma20: ctx.indicators.sma20,
      trendStrength: ctx.regime.trendStrength,
      direction: ctx.indicators.ema20 > ctx.indicators.ema50 ? 'up' : ctx.indicators.ema20 < ctx.indicators.ema50 ? 'down' : 'flat',
    },
    momentum: {
      rsi: ctx.indicators.rsi,
      macdHistogram: ctx.indicators.macd.histogram,
      roc: ctx.regime.momentum,
    },
    volatility: {
      atr: ctx.indicators.atr,
      volatilityPct: ctx.regime.volatilityPct,
      band: regime.volatilityBand,
    },
    volume: {
      window24h: ctx.volume24h,
      changePct: ctx.change24h,
    },
    liquidity: {
      recentVolume: ctx.regime.liquidity,
    },
    wallet: {
      publicKey: agentRow.public_key,
      smartWalletAddress: resolveSmartWalletAddress(agentRow),
      delegationActive: delegation !== null,
      mode: agentRow.mode,
      capital: agentRow.capital,
    },
    portfolio: {
      xlmPct: allocation.xlmPct,
      usdcPct: allocation.usdcPct,
      idleUsd: allocation.idleUsd,
      totalValue: allocation.totalValue,
      targetXlmPct: targets.xlmPct,
      targetUsdcPct: targets.usdcPct,
      driftPct: Number.isFinite(allocation.xlmPct) && Number.isFinite(targets.xlmPct) ? Math.abs(allocation.xlmPct - targets.xlmPct) : 0,
    },
    protocolExposure,
    risk: {
      realizedPnl,
      unrealizedPnl,
      drawdownPct,
      volatilityPct: ctx.regime.volatilityPct,
    },
    computedAt: Date.now(),
  };

  const result: FeatureBuildResult = { featureSet, regime, marketId, oracleTimestamp: lastCandle.time };
  if (useCache) {
    const setStart = performance.now();
    await cache.set(key, result, featureCacheTtlForInterval(intervalSeconds));
    recordProviderLatency(performance.now() - setStart);
  }
  return result;
}

/** Convenience wrapper for callers that only need the FeatureSet, not the regime classification. */
export async function buildFeatureSet(
  agentRow: AgentRow,
  pair: string,
  intervalSeconds: number,
  opts: { useCache?: boolean } = {}
): Promise<FeatureSet | null> {
  const result = await buildFeatureResult(agentRow, pair, intervalSeconds, opts);
  return result?.featureSet ?? null;
}

export { getAgentRow };
