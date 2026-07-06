// Market Context domain — everything the AI needs to know about the external market. Pure
// aggregation over decisionEngine's already-computed indicators/regime (via featureEngine's
// FeatureSet) and the regime classification — no indicator recomputation, no new oracle calls.
import type { FeatureBuildResult } from '../featureEngine.js';

// Oracle age band this domain's confidence decays over — 0-60s old is "fully fresh" (1.0),
// beyond 900s (the same ceiling validation.ts's MAX_ORACLE_AGE_SECONDS rejects a context at)
// confidence bottoms out at 0. Kept in sync with validation.ts by convention/comment rather than
// a shared import, since importing validation.ts here would create a domains -> validation ->
// domains cycle (validation.ts depends on every domain's view type).
const FRESH_AGE_SECONDS = 60;
const STALE_AGE_SECONDS = 900;

export interface MarketContextView {
  pair: string;
  price: number;
  oracle: {
    /** Epoch ms of the last candle the oracle returned. */
    timestamp: number;
    /** Seconds between now and the oracle timestamp — the freshness the caller should judge
     *  "is this data stale" against. */
    ageSeconds: number;
  };
  candles: {
    resolutionSeconds: number;
  };
  trend: FeatureBuildResult['featureSet']['trend'];
  momentum: FeatureBuildResult['featureSet']['momentum'];
  volatility: FeatureBuildResult['featureSet']['volatility'];
  volume: FeatureBuildResult['featureSet']['volume'];
  liquidity: FeatureBuildResult['featureSet']['liquidity'];
  regime: {
    base: string;
    label: string;
    breakout: boolean;
    volatilityBand: 'low' | 'normal' | 'high';
  };
  /** 0-1 — how much this domain's data should be trusted, based purely on oracle freshness.
   *  Not a prediction or a decision input weight; a deterministic data-quality signal. */
  confidence: number;
}

/** Linear decay from 1.0 at `freshAt` seconds old down to 0.0 at `staleAt` seconds old. */
function freshnessConfidence(ageSeconds: number, freshAt: number, staleAt: number): number {
  if (ageSeconds <= freshAt) return 1;
  if (ageSeconds >= staleAt) return 0;
  return 1 - (ageSeconds - freshAt) / (staleAt - freshAt);
}

export function buildMarketContextView(result: FeatureBuildResult, intervalSeconds: number, now = Date.now()): MarketContextView {
  const { featureSet, regime } = result;
  const ageSeconds = Math.max(0, Math.round((now - result.oracleTimestamp) / 1000));
  return {
    pair: featureSet.pair,
    price: featureSet.price,
    oracle: {
      timestamp: result.oracleTimestamp,
      ageSeconds,
    },
    candles: { resolutionSeconds: intervalSeconds },
    trend: featureSet.trend,
    momentum: featureSet.momentum,
    volatility: featureSet.volatility,
    volume: featureSet.volume,
    liquidity: featureSet.liquidity,
    regime,
    confidence: freshnessConfidence(ageSeconds, FRESH_AGE_SECONDS, STALE_AGE_SECONDS),
  };
}
