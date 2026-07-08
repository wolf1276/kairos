// Strategy Analytics (Phase 3). Pure aggregation over externally-supplied `StrategyRunRecord[]`
// — this module never runs a strategy, never talks to Benchmark Core or the Context Engine, and
// never fabricates a metric it doesn't have data for. Same philosophy as
// `benchmarkCore/tradingMetrics.ts`: a caller (a replay harness, a benchmark session reducer,
// scripts/longRunStress.ts, etc.) is responsible for pairing each strategy evaluation with its
// eventual outcome and market regime; this module only aggregates and ranks what it's given.
import type { ExtendedRegimeLabel } from '../agentContext/regimeDetector.js';
import type { StrategySignalAction } from './types.js';

/** One strategy evaluation, joined with whatever regime it ran under and (if known) the PnL that
 *  resulted from acting on it. `pnl` is `null`/absent for a run whose outcome hasn't resolved yet
 *  (e.g. still open, or the pipeline never reached the outcome stage) — such runs still count
 *  toward usage/signal-frequency/confidence, just not toward winRate/pnlContribution/regime
 *  ranking, mirroring how `computeTradingMetrics` excludes unusable outcomes rather than
 *  treating them as a loss. */
export interface StrategyRunRecord {
  strategyId: string;
  signal: StrategySignalAction;
  confidence: number;
  regime: ExtendedRegimeLabel;
  pnl?: number | null;
}

export interface StrategyAnalytics {
  strategyId: string;
  usageCount: number;
  /** Fraction of runs with a known `pnl` > 0. `0` when no run has a resolved outcome yet. */
  winRate: number;
  /** Sum of every resolved `pnl` this strategy produced. */
  pnlContribution: number;
  averageConfidence: number;
  /** Regime with the highest mean PnL for this strategy; `null` when no run has a resolved
   *  outcome. */
  bestRegime: ExtendedRegimeLabel | null;
  /** Regime with the lowest mean PnL for this strategy; `null` under the same condition, and
   *  equal to `bestRegime` when only one regime has resolved outcomes. */
  worstRegime: ExtendedRegimeLabel | null;
  buyFrequency: number;
  sellFrequency: number;
  holdFrequency: number;
  /** Blended ranking score — see `rankStrategies` for the formula and why it's weighted this way. */
  compositeScore: number;
}

export interface RankedStrategy extends StrategyAnalytics {
  rank: number;
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function frequency(records: StrategyRunRecord[], signal: StrategySignalAction): number {
  return records.length > 0 ? records.filter((r) => r.signal === signal).length / records.length : 0;
}

function hasResolvedPnl(record: StrategyRunRecord): record is StrategyRunRecord & { pnl: number } {
  return typeof record.pnl === 'number' && Number.isFinite(record.pnl);
}

/** Composite ranking score: 60% resolved PnL contribution, 30% win rate, 10% average confidence
 *  (each of the latter two scaled to the same order of magnitude as a typical PnL figure so
 *  neither term is drowned out or dominates purely from unit mismatch). PnL is weighted highest
 *  because it is the only figure directly tied to real trading outcome; win rate and confidence
 *  are secondary tie-breakers on strategy quality when PnL samples are thin. */
function compositeScore(pnlContribution: number, winRate: number, averageConfidence: number): number {
  return pnlContribution * 0.6 + winRate * 100 * 0.3 + averageConfidence * 100 * 0.1;
}

function analyzeOne(strategyId: string, runs: StrategyRunRecord[]): StrategyAnalytics {
  const usageCount = runs.length;
  const resolved = runs.filter(hasResolvedPnl);
  const wins = resolved.filter((r) => r.pnl > 0);
  const winRate = resolved.length > 0 ? wins.length / resolved.length : 0;
  const pnlContribution = resolved.reduce((acc, r) => acc + r.pnl, 0);
  const averageConfidence = mean(runs.map((r) => r.confidence));

  const pnlByRegime = new Map<ExtendedRegimeLabel, number[]>();
  for (const r of resolved) {
    const bucket = pnlByRegime.get(r.regime) ?? [];
    bucket.push(r.pnl);
    pnlByRegime.set(r.regime, bucket);
  }

  let bestRegime: ExtendedRegimeLabel | null = null;
  let worstRegime: ExtendedRegimeLabel | null = null;
  let bestMean = -Infinity;
  let worstMean = Infinity;
  for (const [regime, pnls] of pnlByRegime) {
    const regimeMean = mean(pnls);
    if (regimeMean > bestMean) {
      bestMean = regimeMean;
      bestRegime = regime;
    }
    if (regimeMean < worstMean) {
      worstMean = regimeMean;
      worstRegime = regime;
    }
  }

  return {
    strategyId,
    usageCount,
    winRate,
    pnlContribution,
    averageConfidence,
    bestRegime,
    worstRegime,
    buyFrequency: frequency(runs, 'BUY'),
    sellFrequency: frequency(runs, 'SELL'),
    holdFrequency: frequency(runs, 'HOLD'),
    compositeScore: compositeScore(pnlContribution, winRate, averageConfidence),
  };
}

/** Aggregates per-strategy analytics from a flat list of runs. `knownStrategyIds`, when given
 *  (e.g. `registry.list().map((s) => s.id)`), guarantees every registered strategy appears in
 *  the result — including one with zero runs — rather than only strategies that happen to show
 *  up in `records`, so a newly-registered but not-yet-invoked strategy is still visible (with
 *  all-zero/null stats) instead of silently missing from the report. */
export function computeStrategyAnalytics(
  records: StrategyRunRecord[],
  knownStrategyIds: string[] = []
): StrategyAnalytics[] {
  const byStrategy = new Map<string, StrategyRunRecord[]>();
  for (const id of knownStrategyIds) byStrategy.set(id, []);
  for (const record of records) {
    const bucket = byStrategy.get(record.strategyId) ?? [];
    bucket.push(record);
    byStrategy.set(record.strategyId, bucket);
  }

  return [...byStrategy.entries()].map(([strategyId, runs]) => analyzeOne(strategyId, runs));
}

/** Ranks already-computed analytics by `compositeScore` (descending). Ties are broken by
 *  `pnlContribution` (descending, the more directly meaningful figure), then by `usageCount`
 *  (descending — a strategy with more samples backing an equal score is the safer bet), then by
 *  `strategyId` (ascending) so the ordering is fully deterministic regardless of input order. */
export function rankStrategies(analytics: StrategyAnalytics[]): RankedStrategy[] {
  const sorted = [...analytics].sort((a, b) => {
    if (b.compositeScore !== a.compositeScore) return b.compositeScore - a.compositeScore;
    if (b.pnlContribution !== a.pnlContribution) return b.pnlContribution - a.pnlContribution;
    if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
    return a.strategyId.localeCompare(b.strategyId);
  });
  return sorted.map((analytics, index) => ({ ...analytics, rank: index + 1 }));
}

/** Convenience one-shot: computes analytics for every id in `knownStrategyIds` and returns them
 *  ranked. Equivalent to `rankStrategies(computeStrategyAnalytics(records, knownStrategyIds))`. */
export function buildStrategyRanking(
  records: StrategyRunRecord[],
  knownStrategyIds: string[] = []
): RankedStrategy[] {
  return rankStrategies(computeStrategyAnalytics(records, knownStrategyIds));
}
