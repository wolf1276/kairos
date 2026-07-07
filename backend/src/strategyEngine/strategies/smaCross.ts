// SMA Cross: price vs its 20-period SMA (the only SMA the Context Engine currently exposes),
// combined with the EMA20 as the "fast" line — a standard price/SMA cross proxy given the
// single-SMA FeatureSet this engine is fed.
import { normalizeConfidence } from '../util.js';
import type { Strategy, StrategyInput, StrategySignal } from '../types.js';

export const SMA_CROSS_STRATEGY_ID = 'sma-cross';

export const smaCrossStrategy: Strategy = {
  id: SMA_CROSS_STRATEGY_ID,
  version: '1.0.0',
  evaluate(input: StrategyInput): StrategySignal {
    const { sma20, ema20 } = input.features.trend;
    const { price } = input.features;
    const priceVsSmaPct = sma20 !== 0 ? ((price - sma20) / Math.abs(sma20)) * 100 : 0;

    let signal: StrategySignal['signal'] = 'HOLD';
    if (price > sma20 && ema20 > sma20) signal = 'BUY';
    else if (price < sma20 && ema20 < sma20) signal = 'SELL';

    const confidence = normalizeConfidence(signal === 'HOLD' ? 0.25 : Math.abs(priceVsSmaPct) / 3);

    return {
      strategyId: SMA_CROSS_STRATEGY_ID,
      signal,
      confidence,
      reasoning:
        signal === 'HOLD'
          ? `Price (${price}) and EMA20 (${ema20.toFixed(6)}) do not agree relative to SMA20 (${sma20.toFixed(6)}).`
          : `Price is ${price > sma20 ? 'above' : 'below'} SMA20 by ${priceVsSmaPct.toFixed(3)}%, confirmed by EMA20 on the same side.`,
      indicatorsUsed: ['trend.sma20', 'trend.ema20', 'features.price'],
      entry: signal === 'HOLD' ? null : price,
      exit: null,
      stopLoss: null,
      takeProfit: null,
      risk: Math.abs(priceVsSmaPct) > 5 ? 'high' : 'medium',
      metadata: { priceVsSmaPct },
    };
  },
};
