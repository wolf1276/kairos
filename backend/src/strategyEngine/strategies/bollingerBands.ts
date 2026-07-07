// Bollinger Bands: the Context Engine's FeatureSet does not expose raw Bollinger upper/lower
// bands (no raw candle series reaches this layer, only aggregated indicators) — this strategy
// derives an equivalent band from price ± a volatility-scaled offset using volatility.volatilityPct
// (already computed by the frozen Context Engine), which is a standard % -based-band
// approximation of Bollinger Bands. Documented here rather than silently presented as exact.
import { normalizeConfidence } from '../util.js';
import type { Strategy, StrategyInput, StrategySignal } from '../types.js';

export const BOLLINGER_BANDS_STRATEGY_ID = 'bollinger-bands';

const BAND_WIDTH_MULTIPLIER = 2; // approximates the standard 2-stddev Bollinger band width

export const bollingerBandsStrategy: Strategy = {
  id: BOLLINGER_BANDS_STRATEGY_ID,
  version: '1.0.0',
  evaluate(input: StrategyInput): StrategySignal {
    const { price } = input.features;
    const { volatilityPct } = input.features.volatility;
    const bandOffset = price * (volatilityPct / 100) * BAND_WIDTH_MULTIPLIER;
    const upperBand = price + bandOffset;
    const lowerBand = price - bandOffset;

    // Price is compared against its own derived bands, so it is always exactly on the boundary
    // by construction — the meaningful edge here is volatility-driven risk sizing (band width),
    // not a literal touch/breach, so this strategy signals HOLD with a volatility-scaled
    // confidence/risk rather than fabricating a false BUY/SELL from a self-referential band.
    const signal: StrategySignal['signal'] = 'HOLD';
    const confidence = normalizeConfidence(0.5 - volatilityPct / 100);

    return {
      strategyId: BOLLINGER_BANDS_STRATEGY_ID,
      signal,
      confidence,
      reasoning: `Derived Bollinger-style band width is ${(bandOffset * 2).toFixed(6)} (${(volatilityPct * BAND_WIDTH_MULTIPLIER).toFixed(2)}% of price) — width alone, without a raw candle series, is a volatility read, not an entry signal.`,
      indicatorsUsed: ['features.price', 'volatility.volatilityPct'],
      entry: null,
      exit: null,
      stopLoss: price - bandOffset,
      takeProfit: price + bandOffset,
      risk: volatilityPct > 5 ? 'high' : volatilityPct > 2 ? 'medium' : 'low',
      metadata: { upperBand, lowerBand, bandOffset },
    };
  },
};
