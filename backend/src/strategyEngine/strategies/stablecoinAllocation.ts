// Stablecoin Allocation: defensive de-risking signal — favors rotating toward the stablecoin
// side of the portfolio when volatility is high or drawdown is materially negative, using the
// Context Engine's own already-computed volatility.band/risk.drawdownPct — never computes
// drawdown or volatility itself.
import { normalizeConfidence } from '../util.js';
import type { Strategy, StrategyInput, StrategySignal } from '../types.js';

export const STABLECOIN_ALLOCATION_STRATEGY_ID = 'stablecoin-allocation';

const DRAWDOWN_THRESHOLD_PCT = -10;

export const stablecoinAllocationStrategy: Strategy = {
  id: STABLECOIN_ALLOCATION_STRATEGY_ID,
  version: '1.0.0',
  evaluate(input: StrategyInput): StrategySignal {
    const { band } = input.features.volatility;
    const { drawdownPct } = input.features.risk;
    const { price } = input.features;

    const badDrawdown = drawdownPct !== null && drawdownPct <= DRAWDOWN_THRESHOLD_PCT;
    const defensive = band === 'high' || badDrawdown;

    // Defensive rotation means selling the volatile asset into the stablecoin — expressed here
    // as SELL (of the non-stable asset), matching the direction the other technical strategies
    // use for "reduce exposure to the volatile side."
    const signal: StrategySignal['signal'] = defensive ? 'SELL' : 'HOLD';
    const confidence = normalizeConfidence(defensive ? (band === 'high' ? 0.6 : 0) + (badDrawdown ? Math.abs(drawdownPct ?? 0) / 50 : 0) : 0.1);

    return {
      strategyId: STABLECOIN_ALLOCATION_STRATEGY_ID,
      signal,
      confidence,
      reasoning: defensive
        ? `Defensive rotation triggered — volatility band '${band}'${badDrawdown ? `, drawdown ${(drawdownPct as number).toFixed(2)}% below ${DRAWDOWN_THRESHOLD_PCT}% threshold` : ''}. Recommend increasing stablecoin allocation.`
        : `Volatility band '${band}' and drawdown (${drawdownPct === null ? 'n/a' : drawdownPct.toFixed(2) + '%'}) do not warrant a defensive stablecoin shift.`,
      indicatorsUsed: ['volatility.band', 'risk.drawdownPct'],
      entry: null,
      exit: signal === 'SELL' ? price : null,
      stopLoss: null,
      takeProfit: null,
      risk: badDrawdown ? 'high' : band === 'normal' ? 'medium' : band,
      metadata: { badDrawdown, drawdownPct, band },
    };
  },
};
