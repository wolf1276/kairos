// Types for Benchmark Comparison (Phase 9). Compares two already-built BenchmarkReportBundles
// (Phase 8) — this module computes nothing about a single session, only deltas between two.
// Never re-runs an engine, never re-derives a per-session metric that Phase 2-7 already own.
import type { BenchmarkReportBundle } from '../benchmarkReports/types.js';

export const BENCHMARK_COMPARISON_VERSION = '1.0.0';

/** Generic baseline -> current comparison for a single scalar metric. `percentChange` is `null`
 *  when `baseline` is 0 (division by zero has no meaningful percentage). */
export interface MetricDelta {
  baseline: number;
  current: number;
  delta: number;
  percentChange: number | null;
}

/** Per-strategy compositeScore comparison. A strategy present in only one bundle's ranking is
 *  excluded — comparing a strategy's presence/absence isn't a metric delta. */
export interface StrategyScoreDelta {
  strategyId: string;
  baselineScore: number;
  currentScore: number;
  delta: number;
}

export interface RuntimeDelta {
  avgTotalMs: MetricDelta;
  p95TotalMs: MetricDelta;
}

export interface LearningDelta {
  /** winRate of each bundle's last cohort; `null` when a bundle has no cohorts. */
  latestCohortWinRate: MetricDelta | null;
  latestCohortAveragePnl: MetricDelta | null;
}

export interface MemoryDelta {
  retrievalHitRate: MetricDelta;
  retrievalAvgDurationMs: MetricDelta;
  episodicGrowthRatePerHour: MetricDelta;
}

export interface BenchmarkComparisonReport {
  version: string;
  generatedAt: number;
  baselineSessionId: string;
  currentSessionId: string;
  pnlDelta: MetricDelta;
  winRateDelta: MetricDelta;
  strategyDelta: StrategyScoreDelta[];
  runtimeDelta: RuntimeDelta;
  learningDelta: LearningDelta;
  memoryDelta: MemoryDelta;
  /** 0-100. 100 = every tracked signal improved maximally; 0 = every tracked signal regressed
   *  maximally. See `compareBenchmarkSessions` for the weighting. */
  improvementScore: number;
}

export interface BenchmarkComparisonInput {
  generatedAt: number;
  baseline: BenchmarkReportBundle;
  current: BenchmarkReportBundle;
}
