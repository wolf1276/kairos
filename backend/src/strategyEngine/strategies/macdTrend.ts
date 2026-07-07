// MACD Trend: signals off the MACD histogram's sign/magnitude already computed by the Context
// Engine (momentum.macdHistogram) — never recomputes MACD itself.
import { normalizeConfidence } from '../util.js';
import type { Strategy, StrategyInput, StrategySignal } from '../types.js';

export const MACD_TREND_STRATEGY_ID = 'macd-trend';

export const macdTrendStrategy: Strategy = {
  id: MACD_TREND_STRATEGY_ID,
  version: '1.0.0',
  evaluate(input: StrategyInput): StrategySignal {
    const { macdHistogram } = input.features.momentum;
    const { price } = input.features;

    let signal: StrategySignal['signal'] = 'HOLD';
    if (macdHistogram > 0) signal = 'BUY';
    else if (macdHistogram < 0) signal = 'SELL';

    // Magnitude relative to price gives a scale-independent confidence signal — a fixed
    // absolute threshold would be meaningless across assets with very different price scales.
    const relativeMagnitude = price !== 0 ? Math.abs(macdHistogram) / price : 0;
    const confidence = normalizeConfidence(relativeMagnitude * 20);

    return {
      strategyId: MACD_TREND_STRATEGY_ID,
      signal,
      confidence,
      reasoning:
        signal === 'HOLD'
          ? 'MACD histogram is exactly zero — no directional trend signal.'
          : `MACD histogram is ${signal === 'BUY' ? 'positive' : 'negative'} (${macdHistogram.toFixed(6)}), indicating ${signal === 'BUY' ? 'bullish' : 'bearish'} momentum.`,
      indicatorsUsed: ['momentum.macdHistogram'],
      entry: signal === 'HOLD' ? null : price,
      exit: null,
      stopLoss: null,
      takeProfit: null,
      risk: confidence > 0.6 ? 'low' : confidence > 0.3 ? 'medium' : 'high',
      metadata: { macdHistogram, relativeMagnitude },
    };
  },
};
