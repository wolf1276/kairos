// Ranking: pure, deterministic scoring and ordering of candidate quotes. No adapter I/O, no
// randomness, no wall-clock dependence — identical CandidateQuote inputs always produce an
// identical score and an identical ordering, which is what makes `computeRoute` reproducible.
import type { HealthStatus } from '../../protocolAdapters/types.js';
import type { CandidateQuote, RankedCandidate, RouteCandidate } from './types.js';

export const WEIGHT_OUTPUT = 1;
export const WEIGHT_FEE = 1;
export const WEIGHT_SLIPPAGE = 1000; // pct points weighted heavily — slippage directly costs the trader
export const WEIGHT_LIQUIDITY = 10;
export const WEIGHT_COMPLEXITY = 0.5; // penalty per hop beyond the first — fewer hops is simpler/safer
export const DEGRADED_HEALTH_PENALTY = 1_000_000; // large enough to always rank a DEGRADED protocol below a READY one with an otherwise-worse quote

function healthPenalty(health: HealthStatus): number {
  return health === 'DEGRADED' ? DEGRADED_HEALTH_PENALTY : 0;
}

export function scoreCandidateQuote(quote: CandidateQuote, health: HealthStatus): RouteCandidate['scoreBreakdown'] & { total: number } {
  const output = WEIGHT_OUTPUT * Number(quote.outputAmount);
  const fees = -WEIGHT_FEE * Number(quote.estimatedFees);
  const slippage = -WEIGHT_SLIPPAGE * quote.estimatedSlippagePct;
  const liquidity = WEIGHT_LIQUIDITY * quote.liquidityScore;
  const complexity = -WEIGHT_COMPLEXITY * Math.max(0, quote.routeHops.length - 1);
  const health_ = -healthPenalty(health);
  const total = output + fees + slippage + liquidity + complexity + health_;
  return { output, fees, slippage, liquidity, complexity, health: health_, total };
}

/** Sorts candidates highest score first. Ties are broken by protocol name (ascending) so ordering
 *  never depends on array insertion order or any other non-deterministic factor. */
export function rankCandidates(candidates: RouteCandidate[]): RankedCandidate[] {
  return [...candidates]
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.protocol.localeCompare(b.protocol)))
    .map((candidate, index) => ({
      protocol: candidate.protocol,
      rank: index + 1,
      score: candidate.score,
      quote: candidate.quote,
    }));
}
