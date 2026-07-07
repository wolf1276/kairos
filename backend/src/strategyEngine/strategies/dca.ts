// DCA (Dollar-Cost Averaging): deterministic, schedule-driven — always recommends a fixed-size
// recurring BUY regardless of market conditions, by design (that is what DCA is). Confidence is
// fixed, not derived from market data, since DCA's whole premise is ignoring market timing.
import type { Strategy, StrategyInput, StrategySignal } from '../types.js';

export const DCA_STRATEGY_ID = 'dca';

const DCA_FIXED_CONFIDENCE = 0.6;
/** Fraction of idle capital DCA recommends deploying per tick — conservative and fixed, since
 *  DCA's premise is regular small allocations, not market-sized ones. */
const DCA_ALLOCATION_FRACTION = 0.05;

export const dcaStrategy: Strategy = {
  id: DCA_STRATEGY_ID,
  version: '1.0.0',
  evaluate(input: StrategyInput): StrategySignal {
    const { price } = input.features;

    return {
      strategyId: DCA_STRATEGY_ID,
      signal: 'BUY',
      confidence: DCA_FIXED_CONFIDENCE,
      reasoning: 'Scheduled recurring buy (dollar-cost averaging) — deliberately ignores current market conditions by design.',
      indicatorsUsed: ['features.price'],
      entry: price,
      exit: null,
      stopLoss: null,
      takeProfit: null,
      risk: 'low',
      metadata: { allocationFraction: DCA_ALLOCATION_FRACTION },
    };
  },
};
