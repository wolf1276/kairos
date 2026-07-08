// Benchmark Comparison (Phase 9). Pure diffing over two already-built BenchmarkReportBundles
// (Phase 8) — no I/O, no engine calls, no `Date.now()` (caller supplies `generatedAt`). Same
// input always produces a byte-identical report.
import { BENCHMARK_COMPARISON_VERSION } from './types.js';
import type {
  BenchmarkComparisonInput,
  BenchmarkComparisonReport,
  LearningDelta,
  MemoryDelta,
  MetricDelta,
  RuntimeDelta,
  StrategyScoreDelta,
} from './types.js';
import type { BenchmarkReportBundle } from '../benchmarkReports/types.js';
import type { RankedStrategy } from '../strategyEngine/analytics.js';
import type { CohortStats } from '../learningAnalytics/analytics.js';

function metricDelta(baseline: number, current: number): MetricDelta {
  const delta = current - baseline;
  return {
    baseline,
    current,
    delta,
    percentChange: baseline !== 0 ? delta / Math.abs(baseline) : null,
  };
}

function buildStrategyDelta(baseline: RankedStrategy[], current: RankedStrategy[]): StrategyScoreDelta[] {
  const currentById = new Map(current.map((s) => [s.strategyId, s]));
  const out: StrategyScoreDelta[] = [];
  for (const b of baseline) {
    const c = currentById.get(b.strategyId);
    if (!c) continue;
    out.push({
      strategyId: b.strategyId,
      baselineScore: b.compositeScore,
      currentScore: c.compositeScore,
      delta: c.compositeScore - b.compositeScore,
    });
  }
  return out;
}

function lastCohort(cohorts: CohortStats[]): CohortStats | null {
  return cohorts.length > 0 ? cohorts[cohorts.length - 1] : null;
}

function buildLearningDelta(baseline: BenchmarkReportBundle, current: BenchmarkReportBundle): LearningDelta {
  const b = lastCohort(baseline.learning.cohorts);
  const c = lastCohort(current.learning.cohorts);
  if (!b || !c) {
    return { latestCohortWinRate: null, latestCohortAveragePnl: null };
  }
  return {
    latestCohortWinRate: metricDelta(b.winRate, c.winRate),
    latestCohortAveragePnl: metricDelta(b.averagePnl, c.averagePnl),
  };
}

function buildRuntimeDelta(baseline: BenchmarkReportBundle, current: BenchmarkReportBundle): RuntimeDelta {
  return {
    avgTotalMs: metricDelta(baseline.runtime.avgTotalMs, current.runtime.avgTotalMs),
    p95TotalMs: metricDelta(baseline.runtime.p95TotalMs, current.runtime.p95TotalMs),
  };
}

function buildMemoryDelta(baseline: BenchmarkReportBundle, current: BenchmarkReportBundle): MemoryDelta {
  return {
    retrievalHitRate: metricDelta(baseline.memory.retrievalPerformance.hitRate, current.memory.retrievalPerformance.hitRate),
    retrievalAvgDurationMs: metricDelta(
      baseline.memory.retrievalPerformance.avgDurationMs,
      current.memory.retrievalPerformance.avgDurationMs
    ),
    episodicGrowthRatePerHour: metricDelta(
      baseline.memory.episodicGrowth.ratePerHour,
      current.memory.episodicGrowth.ratePerHour
    ),
  };
}

/** +1 improved, -1 regressed, 0 unchanged/unknown. `higherIsBetter=false` inverts the sign
 *  (used for latency-style metrics where a lower value is the improvement). */
function sign(delta: number, higherIsBetter: boolean): number {
  if (delta === 0) return 0;
  const improved = higherIsBetter ? delta > 0 : delta < 0;
  return improved ? 1 : -1;
}

/** Weighted blend of six improvement signals into a single 0-100 score. Each signal contributes
 *  its direction (+1/-1/0), not its magnitude — keeps the score robust to wildly different metric
 *  scales (ms vs. fraction vs. PnL currency units) rather than needing per-metric normalization
 *  the underlying data doesn't support. `episodicGrowthRatePerHour` is deliberately excluded —
 *  more/less memory growth isn't inherently better or worse. */
function computeImprovementScore(report: Omit<BenchmarkComparisonReport, 'improvementScore' | 'version' | 'generatedAt' | 'baselineSessionId' | 'currentSessionId'>): number {
  const signals: number[] = [
    sign(report.pnlDelta.delta, true),
    sign(report.winRateDelta.delta, true),
    sign(report.runtimeDelta.avgTotalMs.delta, false),
    sign(report.runtimeDelta.p95TotalMs.delta, false),
    sign(report.memoryDelta.retrievalHitRate.delta, true),
    sign(report.memoryDelta.retrievalAvgDurationMs.delta, false),
  ];
  if (report.strategyDelta.length > 0) {
    const avgStrategyDelta = report.strategyDelta.reduce((acc, s) => acc + s.delta, 0) / report.strategyDelta.length;
    signals.push(sign(avgStrategyDelta, true));
  }
  if (report.learningDelta.latestCohortWinRate) signals.push(sign(report.learningDelta.latestCohortWinRate.delta, true));
  if (report.learningDelta.latestCohortAveragePnl) signals.push(sign(report.learningDelta.latestCohortAveragePnl.delta, true));

  const avg = signals.length > 0 ? signals.reduce((a, b) => a + b, 0) / signals.length : 0;
  return Math.round(((avg + 1) / 2) * 100);
}

export function compareBenchmarkSessions(input: BenchmarkComparisonInput): BenchmarkComparisonReport {
  const { baseline, current, generatedAt } = input;
  const base = {
    baselineSessionId: baseline.sessionId,
    currentSessionId: current.sessionId,
    pnlDelta: metricDelta(baseline.trading.pnl, current.trading.pnl),
    winRateDelta: metricDelta(baseline.trading.winRate, current.trading.winRate),
    strategyDelta: buildStrategyDelta(baseline.strategy, current.strategy),
    runtimeDelta: buildRuntimeDelta(baseline, current),
    learningDelta: buildLearningDelta(baseline, current),
    memoryDelta: buildMemoryDelta(baseline, current),
  };
  return {
    version: BENCHMARK_COMPARISON_VERSION,
    generatedAt,
    ...base,
    improvementScore: computeImprovementScore(base),
  };
}
