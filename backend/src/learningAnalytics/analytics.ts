// Learning Analytics (Phase 5). Pure aggregation over externally-supplied `LearningTradeRecord[]`
// — this module never queries the trades table, never calls the strategy engine or memory layer,
// and never fabricates a metric it doesn't have data for. Same philosophy as
// `strategyEngine/analytics.ts` and `memoryLayer/analytics.ts`: a caller (a route handler, a
// scheduled job, a replay script) pairs each trade with its strategy/confidence/memory-influence
// facts and hands the ordered list here. Cohorts are fixed-size, sequential slices of the input
// order (trades 1-100, 101-200, 201-300, ...) — NOT time windows — so "learning over time" means
// "learning across successive trades," matching how the phase was specified.
export const LEARNING_COHORT_SIZE = 100;

export interface LearningTradeRecord {
  /** Strategy that produced this trade's signal. */
  strategyId: string;
  /** Confidence attached to the decision that led to this trade, in [0, 1]. */
  confidence: number;
  /** Resolved PnL for this trade, or null/undefined if not yet resolved — excluded from
   *  winRate/pnl aggregation, mirroring how the other analytics modules treat unresolved outcomes. */
  pnl?: number | null;
  /** Whether memory (episodic/semantic retrieval) was consulted and non-empty for this decision. */
  memoryInfluenced: boolean;
  timestamp: number;
}

export interface CohortStats {
  /** 1-based cohort index: 1 covers trades 1-100, 2 covers 101-200, etc. */
  cohort: number;
  /** Inclusive 1-based [startTrade, endTrade] range this cohort covers. */
  startTrade: number;
  endTrade: number;
  tradeCount: number;
  winRate: number;
  totalPnl: number;
  averagePnl: number;
  averageConfidence: number;
  /** Count of consecutive-trade boundaries within the cohort where `strategyId` changed. */
  strategyChangeCount: number;
  /** Distinct strategies used within the cohort. */
  distinctStrategies: number;
  /** Fraction of trades in the cohort where memory influenced the decision. */
  memoryInfluenceRate: number;
}

export interface CohortDelta {
  /** The later cohort in the comparison (e.g. 2 when comparing cohort 1 -> 2). */
  toCohort: number;
  winRateDelta: number;
  averagePnlDelta: number;
  averageConfidenceDelta: number;
  strategyChangeCountDelta: number;
  memoryInfluenceRateDelta: number;
}

export interface LearningTrendReport {
  cohorts: CohortStats[];
  /** Deltas between each cohort and the one immediately before it, in order. Empty when fewer
   *  than 2 cohorts have any trades. */
  deltas: CohortDelta[];
  /** `true` when winRate, averagePnl, and averageConfidence are each non-decreasing across every
   *  successive cohort pair — a simple, conservative "is the agent trending better" signal. Not
   *  meaningful (`false`) with fewer than 2 cohorts. */
  isImproving: boolean;
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function hasResolvedPnl(record: LearningTradeRecord): record is LearningTradeRecord & { pnl: number } {
  return typeof record.pnl === 'number' && Number.isFinite(record.pnl);
}

function analyzeCohort(cohort: number, records: LearningTradeRecord[]): CohortStats {
  const resolved = records.filter(hasResolvedPnl);
  const wins = resolved.filter((r) => r.pnl > 0);
  const totalPnl = resolved.reduce((acc, r) => acc + r.pnl, 0);

  let strategyChangeCount = 0;
  const strategiesSeen = new Set<string>();
  for (let i = 0; i < records.length; i++) {
    strategiesSeen.add(records[i].strategyId);
    if (i > 0 && records[i].strategyId !== records[i - 1].strategyId) strategyChangeCount++;
  }

  return {
    cohort,
    startTrade: (cohort - 1) * LEARNING_COHORT_SIZE + 1,
    endTrade: (cohort - 1) * LEARNING_COHORT_SIZE + records.length,
    tradeCount: records.length,
    winRate: resolved.length > 0 ? wins.length / resolved.length : 0,
    totalPnl,
    averagePnl: resolved.length > 0 ? totalPnl / resolved.length : 0,
    averageConfidence: mean(records.map((r) => r.confidence)),
    strategyChangeCount,
    distinctStrategies: strategiesSeen.size,
    memoryInfluenceRate: records.length > 0 ? records.filter((r) => r.memoryInfluenced).length / records.length : 0,
  };
}

/** Splits `records` (assumed already ordered oldest-first, matching `listTradesForAgent`'s
 *  ascending order) into fixed-size sequential cohorts of `cohortSize` and computes stats for
 *  each. The final cohort may be partial (fewer than `cohortSize` trades) if the total isn't an
 *  exact multiple. */
export function computeCohortStats(
  records: LearningTradeRecord[],
  cohortSize: number = LEARNING_COHORT_SIZE
): CohortStats[] {
  const cohorts: CohortStats[] = [];
  for (let i = 0; i < records.length; i += cohortSize) {
    const slice = records.slice(i, i + cohortSize);
    cohorts.push(analyzeCohort(cohorts.length + 1, slice));
  }
  return cohorts;
}

function computeCohortDeltas(cohorts: CohortStats[]): CohortDelta[] {
  const deltas: CohortDelta[] = [];
  for (let i = 1; i < cohorts.length; i++) {
    const prev = cohorts[i - 1];
    const curr = cohorts[i];
    deltas.push({
      toCohort: curr.cohort,
      winRateDelta: curr.winRate - prev.winRate,
      averagePnlDelta: curr.averagePnl - prev.averagePnl,
      averageConfidenceDelta: curr.averageConfidence - prev.averageConfidence,
      strategyChangeCountDelta: curr.strategyChangeCount - prev.strategyChangeCount,
      memoryInfluenceRateDelta: curr.memoryInfluenceRate - prev.memoryInfluenceRate,
    });
  }
  return deltas;
}

/** Builds the full learning trend report: per-cohort stats plus successive-cohort deltas and a
 *  conservative `isImproving` signal. Pure function over the given records; `cohortSize` defaults
 *  to 100 to match the Phase 5 spec (1-100, 101-200, 201-300, ...). */
export function buildLearningTrendReport(
  records: LearningTradeRecord[],
  cohortSize: number = LEARNING_COHORT_SIZE
): LearningTrendReport {
  const cohorts = computeCohortStats(records, cohortSize);
  const deltas = computeCohortDeltas(cohorts);
  const isImproving =
    deltas.length > 0 &&
    deltas.every((d) => d.winRateDelta >= 0 && d.averagePnlDelta >= 0 && d.averageConfidenceDelta >= 0);

  return { cohorts, deltas, isImproving };
}
