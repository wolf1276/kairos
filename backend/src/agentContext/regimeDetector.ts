// Deterministic market-regime classifier for the Agent Foundation Layer. Layers finer-grained,
// still-deterministic labels (breakout / high-volatility / low-volatility) on top of the
// indicators and base regime decisionEngine.ts already computes — it does NOT recompute RSI/
// MACD/EMA/ATR/ADX/ROC itself (that would duplicate the exact calculations decisionEngine.ts
// and the strategic-agent heuristic already depend on). No AI, no LLM calls, no decisions.
import type { IndicatorSnapshot, MarketContext, RegimeMetrics } from '../decisionTypes.js';

export type ExtendedRegimeLabel =
  | 'trending_up'
  | 'trending_down'
  | 'ranging'
  | 'breakout_up'
  | 'breakout_down'
  | 'high_volatility'
  | 'low_volatility';

export interface RegimeClassification {
  /** Base regime from decisionEngine.computeRegime (trending_up/trending_down/ranging/volatile). */
  base: RegimeMetrics['regime'];
  /** Finer label layered on top — breakout and volatility bands take priority over trend/ranging. */
  label: ExtendedRegimeLabel;
  breakout: boolean;
  volatilityBand: 'low' | 'normal' | 'high';
}

const BREAKOUT_LOOKBACK = 20;
const LOW_VOLATILITY_PCT = 1;
const HIGH_VOLATILITY_PCT = 4; // matches decisionEngine.computeRegime's own 'volatile' cutoff

/** Detects a breakout: the latest close clears the high (or low) of the prior N candles —
 *  a purely price-action check, independent of the indicator snapshot. */
function detectBreakout(candles: MarketContext['candles']): 'up' | 'down' | null {
  if (candles.length < BREAKOUT_LOOKBACK + 1) return null;
  const window = candles.slice(-(BREAKOUT_LOOKBACK + 1), -1);
  const last = candles[candles.length - 1];
  const priorHigh = Math.max(...window.map((c) => c.high));
  const priorLow = Math.min(...window.map((c) => c.low));
  if (last.close > priorHigh) return 'up';
  if (last.close < priorLow) return 'down';
  return null;
}

function volatilityBand(volatilityPct: number): 'low' | 'normal' | 'high' {
  if (volatilityPct >= HIGH_VOLATILITY_PCT) return 'high';
  if (volatilityPct <= LOW_VOLATILITY_PCT) return 'low';
  return 'normal';
}

/**
 * Classifies the extended regime from an already-built MarketContext (candles + indicators +
 * base regime). Priority: breakout > volatility band > base trend/ranging — a breakout or a
 * volatility extreme is a more actionable signal than the underlying trend classification.
 */
export function classifyRegime(ctx: Pick<MarketContext, 'candles' | 'regime'>): RegimeClassification {
  const band = volatilityBand(ctx.regime.volatilityPct);
  const breakout = detectBreakout(ctx.candles);

  let label: ExtendedRegimeLabel;
  if (breakout === 'up') label = 'breakout_up';
  else if (breakout === 'down') label = 'breakout_down';
  else if (band === 'high') label = 'high_volatility';
  else if (band === 'low') label = 'low_volatility';
  // base regime is never 'volatile' here — that case is always caught by band === 'high' above,
  // since both use the same HIGH_VOLATILITY_PCT cutoff as decisionEngine.computeRegime.
  else label = ctx.regime.regime as Exclude<RegimeMetrics['regime'], 'volatile'>;

  return { base: ctx.regime.regime, label, breakout: breakout !== null, volatilityBand: band };
}

export type { IndicatorSnapshot };
