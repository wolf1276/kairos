// Momentum: rate-of-change + 24h volume trend agreement, already computed by the Context Engine
// (momentum.roc, volume.changePct) — never recomputes either.
import { normalizeConfidence } from '../util.js';
import type { Strategy, StrategyInput, StrategySignal } from '../types.js';

export const MOMENTUM_STRATEGY_ID = 'momentum';

const ROC_THRESHOLD_PCT = 1;

export const momentumStrategy: Strategy = {
  id: MOMENTUM_STRATEGY_ID,
  version: '1.0.0',
  evaluate(input: StrategyInput): StrategySignal {
    const { roc } = input.features.momentum;
    const { changePct } = input.features.volume;
    const { price } = input.features;

    let signal: StrategySignal['signal'] = 'HOLD';
    if (roc > ROC_THRESHOLD_PCT && changePct > 0) signal = 'BUY';
    else if (roc < -ROC_THRESHOLD_PCT && changePct < 0) signal = 'SELL';

    const confidence = normalizeConfidence(signal === 'HOLD' ? 0.2 : Math.abs(roc) / 10 + Math.abs(changePct) / 100);

    return {
      strategyId: MOMENTUM_STRATEGY_ID,
      signal,
      confidence,
      reasoning:
        signal === 'HOLD'
          ? `Rate-of-change (${roc.toFixed(3)}%) and 24h volume change (${changePct.toFixed(3)}%) do not agree — no confirmed momentum.`
          : `Rate-of-change ${roc.toFixed(3)}% and 24h volume change ${changePct.toFixed(3)}% agree in the ${signal === 'BUY' ? 'positive' : 'negative'} direction.`,
      indicatorsUsed: ['momentum.roc', 'volume.changePct'],
      entry: signal === 'HOLD' ? null : price,
      exit: null,
      stopLoss: null,
      takeProfit: null,
      risk: Math.abs(roc) > 10 ? 'high' : 'medium',
      metadata: { roc, changePct },
    };
  },
};
