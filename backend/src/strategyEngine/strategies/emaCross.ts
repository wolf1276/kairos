// EMA Cross: classic trend-following signal from the relative position of the fast/slow EMA
// already computed by the Context Engine (trend.ema20 vs trend.ema50) plus its own trend
// direction — this strategy never recomputes an EMA itself.
import { normalizeConfidence } from '../util.js';
import type { Strategy, StrategyInput, StrategySignal } from '../types.js';

export const EMA_CROSS_STRATEGY_ID = 'ema-cross';

export const emaCrossStrategy: Strategy = {
  id: EMA_CROSS_STRATEGY_ID,
  version: '1.0.0',
  evaluate(input: StrategyInput): StrategySignal {
    const { ema20, ema50, direction, trendStrength } = input.features.trend;
    const { price } = input.features;
    const spreadPct = ema50 !== 0 ? ((ema20 - ema50) / Math.abs(ema50)) * 100 : 0;

    let signal: StrategySignal['signal'] = 'HOLD';
    if (ema20 > ema50 && direction === 'up') signal = 'BUY';
    else if (ema20 < ema50 && direction === 'down') signal = 'SELL';

    const confidence = normalizeConfidence(signal === 'HOLD' ? 0.3 : Math.abs(spreadPct) / 5 + trendStrength / 100);

    return {
      strategyId: EMA_CROSS_STRATEGY_ID,
      signal,
      confidence,
      reasoning:
        signal === 'HOLD'
          ? `EMA20 (${ema20.toFixed(6)}) and EMA50 (${ema50.toFixed(6)}) do not agree with trend direction '${direction}' — no cross signal.`
          : `EMA20 ${ema20 > ema50 ? 'above' : 'below'} EMA50 (spread ${spreadPct.toFixed(3)}%) with trend direction '${direction}' confirms ${signal}.`,
      indicatorsUsed: ['trend.ema20', 'trend.ema50', 'trend.direction', 'trend.trendStrength'],
      entry: signal === 'HOLD' ? null : price,
      exit: null,
      stopLoss: null,
      takeProfit: null,
      risk: trendStrength < 20 ? 'high' : trendStrength < 50 ? 'medium' : 'low',
      metadata: { spreadPct, trendStrength },
    };
  },
};
