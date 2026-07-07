// Phase 14 — Strategy Integration. Pure aggregation over Strategy Engine output, owned by
// Pipeline Composition (the wiring root), not the Strategy Engine itself — Strategy Engine's own
// files are never modified. No AI, no trading logic: this only tallies/averages the
// already-computed StrategySignal[] the frozen Strategy Engine returned.
import type { StrategySignal, StrategySignalAction } from '../../strategyEngine/index.js';

export interface StrategyConsensus {
  totalStrategies: number;
  buyCount: number;
  sellCount: number;
  holdCount: number;
  /** `null` only when `totalStrategies` is 0 — never fabricated as 'HOLD' when there is simply
   *  no data to form a consensus from. */
  majoritySignal: StrategySignalAction | null;
  /** Fraction of strategies that agree with `majoritySignal`, in [0, 1]. 0 when there are no
   *  signals. */
  agreementScore: number;
  /** Mean confidence across every signal, in [0, 1]. 0 when there are no signals. */
  averageConfidence: number;
}

const ACTION_ORDER: readonly StrategySignalAction[] = ['BUY', 'SELL', 'HOLD'];

/** Deterministic majority vote — ties broken by `ACTION_ORDER` (BUY before SELL before HOLD),
 *  so the same signal set always produces the same consensus regardless of iteration order. */
export function computeStrategyConsensus(signals: StrategySignal[]): StrategyConsensus {
  const totalStrategies = signals.length;
  const counts: Record<StrategySignalAction, number> = { BUY: 0, SELL: 0, HOLD: 0 };
  let confidenceSum = 0;
  for (const signal of signals) {
    counts[signal.signal] += 1;
    confidenceSum += signal.confidence;
  }

  if (totalStrategies === 0) {
    return { totalStrategies: 0, buyCount: 0, sellCount: 0, holdCount: 0, majoritySignal: null, agreementScore: 0, averageConfidence: 0 };
  }

  const majoritySignal = ACTION_ORDER.reduce((best, candidate) => (counts[candidate] > counts[best] ? candidate : best));

  return {
    totalStrategies,
    buyCount: counts.BUY,
    sellCount: counts.SELL,
    holdCount: counts.HOLD,
    majoritySignal,
    agreementScore: counts[majoritySignal] / totalStrategies,
    averageConfidence: confidenceSum / totalStrategies,
  };
}

/** Deterministic, human/LLM-readable rendering of strategy output for the prompt's existing
 *  Evidence section — plain text formatting only, no interpretation or recommendation of its
 *  own beyond what the signals/consensus already say. */
export function formatStrategyEvidence(
  signals: StrategySignal[],
  consensus: StrategyConsensus,
  failures: { strategyId: string; error: string }[]
): string {
  const signalLines = signals
    .map((s) => `- ${s.strategyId}: ${s.signal} (confidence ${s.confidence.toFixed(2)}, risk ${s.risk}) — ${s.reasoning}`)
    .join('\n');
  const failureLines = failures.length
    ? `\nStrategies that failed to produce a signal for this input: ${failures.map((f) => `${f.strategyId} (${f.error})`).join('; ')}`
    : '';
  const consensusLine = consensus.totalStrategies === 0
    ? 'No strategy signals available for this cycle.'
    : `Consensus: ${consensus.majoritySignal} (${consensus.buyCount} BUY / ${consensus.sellCount} SELL / ${consensus.holdCount} HOLD, agreement ${(consensus.agreementScore * 100).toFixed(0)}%, avg confidence ${consensus.averageConfidence.toFixed(2)}).`;

  return `${consensusLine}\n${signalLines}${failureLines}`;
}
