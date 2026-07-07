// ATR Volatility: not a directional signal generator — a risk-sizing strategy. Always HOLD;
// its value is the ATR-derived stop-loss/take-profit levels and the risk classification, for
// Decision Intelligence to combine with a directional strategy's signal.
import { normalizeConfidence } from '../util.js';
import type { Strategy, StrategyInput, StrategySignal } from '../types.js';

export const ATR_VOLATILITY_STRATEGY_ID = 'atr-volatility';

export const atrVolatilityStrategy: Strategy = {
  id: ATR_VOLATILITY_STRATEGY_ID,
  version: '1.0.0',
  evaluate(input: StrategyInput): StrategySignal {
    const { atr, band, volatilityPct } = input.features.volatility;
    const { price } = input.features;

    const confidence = normalizeConfidence(1 - volatilityPct / 100);
    // volatility.band uses 'normal' where StrategyRiskLevel uses 'medium' — mapped explicitly
    // rather than assumed equivalent, since the two enums are independently defined.
    const risk = band === 'normal' ? 'medium' : band;

    return {
      strategyId: ATR_VOLATILITY_STRATEGY_ID,
      signal: 'HOLD',
      confidence,
      reasoning: `ATR is ${atr.toFixed(6)} (volatility band: ${band}) — position sizing/stop distance should scale with this, not a fixed percentage.`,
      indicatorsUsed: ['volatility.atr', 'volatility.band', 'volatility.volatilityPct'],
      entry: null,
      exit: null,
      stopLoss: price - atr * 1.5,
      takeProfit: price + atr * 3,
      risk,
      metadata: { atr, band, volatilityPct },
    };
  },
};
