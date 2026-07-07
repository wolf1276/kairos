// Portfolio Rebalancing: signals a trade back toward target allocation once drift exceeds a
// threshold, using the Context Engine's own already-computed portfolio.driftPct/xlmPct/
// targetXlmPct — never recomputes an allocation itself.
import { normalizeConfidence } from '../util.js';
import type { Strategy, StrategyInput, StrategySignal } from '../types.js';

export const PORTFOLIO_REBALANCING_STRATEGY_ID = 'portfolio-rebalancing';

const DRIFT_THRESHOLD_PCT = 5;

export const portfolioRebalancingStrategy: Strategy = {
  id: PORTFOLIO_REBALANCING_STRATEGY_ID,
  version: '1.0.0',
  evaluate(input: StrategyInput): StrategySignal {
    const { driftPct, xlmPct, targetXlmPct } = input.features.portfolio;
    const { price } = input.features;
    const overweightXlm = xlmPct > targetXlmPct;

    let signal: StrategySignal['signal'] = 'HOLD';
    if (Math.abs(driftPct) >= DRIFT_THRESHOLD_PCT) {
      // Overweight XLM relative to target -> sell XLM (rebalance toward the other asset);
      // underweight -> buy XLM.
      signal = overweightXlm ? 'SELL' : 'BUY';
    }

    const confidence = normalizeConfidence(signal === 'HOLD' ? 0.1 : Math.abs(driftPct) / 20);

    return {
      strategyId: PORTFOLIO_REBALANCING_STRATEGY_ID,
      signal,
      confidence,
      reasoning:
        signal === 'HOLD'
          ? `Drift (${driftPct.toFixed(2)}%) is within the ${DRIFT_THRESHOLD_PCT}% threshold — no rebalance needed.`
          : `Drift (${driftPct.toFixed(2)}%) exceeds the ${DRIFT_THRESHOLD_PCT}% threshold — XLM is ${overweightXlm ? 'overweight' : 'underweight'} vs target (${targetXlmPct.toFixed(1)}%), recommend ${signal}.`,
      indicatorsUsed: ['portfolio.driftPct', 'portfolio.xlmPct', 'portfolio.targetXlmPct'],
      entry: signal === 'HOLD' ? null : price,
      exit: null,
      stopLoss: null,
      takeProfit: null,
      risk: Math.abs(driftPct) > 15 ? 'high' : 'medium',
      metadata: { driftPct, xlmPct, targetXlmPct },
    };
  },
};
