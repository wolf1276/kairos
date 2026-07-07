// Yield Allocation (DeFi): flags idle, undeployed capital as a BUY-into-yield opportunity, using
// the Context Engine's own already-computed portfolio.idleUsd/totalValue and protocolExposure —
// never queries a protocol or computes an APY itself (that belongs to the Protocol Layer).
import { normalizeConfidence } from '../util.js';
import type { Strategy, StrategyInput, StrategySignal } from '../types.js';

export const YIELD_ALLOCATION_STRATEGY_ID = 'yield-allocation';

const IDLE_THRESHOLD_PCT = 10;

export const yieldAllocationStrategy: Strategy = {
  id: YIELD_ALLOCATION_STRATEGY_ID,
  version: '1.0.0',
  evaluate(input: StrategyInput): StrategySignal {
    const { idleUsd, totalValue } = input.features.portfolio;
    const { price } = input.features;
    const idlePct = totalValue > 0 ? (idleUsd / totalValue) * 100 : 0;
    const hasExposure = input.features.protocolExposure.length > 0;

    const signal: StrategySignal['signal'] = idlePct >= IDLE_THRESHOLD_PCT ? 'BUY' : 'HOLD';
    const confidence = normalizeConfidence(signal === 'BUY' ? idlePct / 100 : 0.15);

    return {
      strategyId: YIELD_ALLOCATION_STRATEGY_ID,
      signal,
      confidence,
      reasoning:
        signal === 'BUY'
          ? `${idlePct.toFixed(1)}% of portfolio value ($${idleUsd.toFixed(2)}) is idle and undeployed — recommend allocating into a yield-bearing DeFi protocol.`
          : `Idle capital (${idlePct.toFixed(1)}%) is below the ${IDLE_THRESHOLD_PCT}% deployment threshold — no yield-allocation action needed.`,
      indicatorsUsed: ['portfolio.idleUsd', 'portfolio.totalValue', 'protocolExposure'],
      entry: signal === 'BUY' ? price : null,
      exit: null,
      stopLoss: null,
      takeProfit: null,
      risk: hasExposure ? 'medium' : 'low',
      metadata: { idlePct, idleUsd, hasExposure },
    };
  },
};
