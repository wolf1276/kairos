// RSI Mean Reversion: classic oversold/overbought reversal off momentum.rsi.
import { normalizeConfidence } from '../util.js';
import type { Strategy, StrategyInput, StrategySignal } from '../types.js';

export const RSI_MEAN_REVERSION_STRATEGY_ID = 'rsi-mean-reversion';

const OVERSOLD = 30;
const OVERBOUGHT = 70;

export const rsiMeanReversionStrategy: Strategy = {
  id: RSI_MEAN_REVERSION_STRATEGY_ID,
  version: '1.0.0',
  evaluate(input: StrategyInput): StrategySignal {
    const { rsi } = input.features.momentum;
    const { price } = input.features;
    const { atr } = input.features.volatility;

    let signal: StrategySignal['signal'] = 'HOLD';
    if (rsi <= OVERSOLD) signal = 'BUY';
    else if (rsi >= OVERBOUGHT) signal = 'SELL';

    const distanceFromMid = Math.abs(rsi - 50) / 50;
    const confidence = normalizeConfidence(signal === 'HOLD' ? 0.2 : distanceFromMid);

    return {
      strategyId: RSI_MEAN_REVERSION_STRATEGY_ID,
      signal,
      confidence,
      reasoning:
        signal === 'HOLD'
          ? `RSI ${rsi.toFixed(2)} is within the neutral band (${OVERSOLD}-${OVERBOUGHT}) — no mean-reversion edge.`
          : `RSI ${rsi.toFixed(2)} is ${signal === 'BUY' ? `oversold (<= ${OVERSOLD})` : `overbought (>= ${OVERBOUGHT})`}, favoring a reversion ${signal}.`,
      indicatorsUsed: ['momentum.rsi'],
      entry: signal === 'HOLD' ? null : price,
      exit: null,
      stopLoss: signal === 'BUY' ? price - atr : signal === 'SELL' ? price + atr : null,
      takeProfit: signal === 'BUY' ? price + atr * 2 : signal === 'SELL' ? price - atr * 2 : null,
      risk: rsi < 20 || rsi > 80 ? 'high' : 'medium',
      metadata: { rsi },
    };
  },
};
