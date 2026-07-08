// Benchmark Integration (Phase 2 follow-up): wires `BenchmarkExecutionRecord[]` (Benchmark Core,
// Phase 1) into a full six-report `BenchmarkReportBundle` (Phase 8) by calling each existing
// phase's own `compute*`/`build*` function — this module computes no metric itself, only maps
// records into each function's expected input shape and hands off.
//
// Trading/Runtime/Reliability are derivable straight from what Benchmark Core actually records
// (pipelineDurationMs, stageDurations, success/failureStage/error). Strategy/Memory/Learning
// analytics need data BenchmarkExecutionRecord does not carry (resolved PnL, market regime,
// episodic/semantic/working memory snapshots, memory-influence flags) — Benchmark Core stores
// `decision`/`outcome`/`learningSnapshot` as opaque `unknown`, and no upstream stage attaches
// those fields today. Rather than fabricate them, this module passes those three analyzers empty
// input, same as their own "never fabricate a metric it doesn't have data for" philosophy
// (strategyEngine/analytics.ts, memoryLayer/analytics.ts, learningAnalytics/analytics.ts).
import { computeTradingMetrics } from '../benchmarkCore/tradingMetrics.js';
import { buildStrategyRanking } from '../strategyEngine/analytics.js';
import { computePipelineLatencyReport } from '../runtimeAnalytics/analytics.js';
import { buildMemoryAnalyticsReport } from '../memoryLayer/analytics.js';
import { buildLearningTrendReport } from '../learningAnalytics/analytics.js';
import { computeReliabilityReport } from '../reliabilityAnalytics/analytics.js';
import { buildBenchmarkReportBundle } from './report.js';
import type { BenchmarkExecutionRecord } from '../benchmarkCore/types.js';
import type { PipelineResult } from '../runtimeAnalytics/types.js';
import type { ReliabilityEvent } from '../reliabilityAnalytics/types.js';
import type { BenchmarkReportBundle } from './types.js';

/** Maps a `BenchmarkExecutionRecord.failureStage` to the closest `ReliabilityEventType` — the
 *  same handful of stage names Pipeline Runner uses (see scripts/longRunStress.ts's
 *  `STAGE_ORDER`). Falls back to `'executionFailure'`, the most general failure category, for any
 *  stage name this mapping doesn't recognize. */
function reliabilityEventTypeForStage(failureStage: string | undefined): ReliabilityEvent['type'] {
  switch (failureStage) {
    case 'decisionVerification':
      return 'verificationFailure';
    case 'executionResult':
      return 'executionFailure';
    default:
      return 'executionFailure';
  }
}

/** Every non-`success` record becomes one `ReliabilityEvent`, timestamped from the record itself.
 *  `recovered` is left `undefined` (not `false`) — Benchmark Core records the outcome of one
 *  execution attempt, not whether a later retry recovered from it, so "was this recovered" is not
 *  data this function has. */
function toReliabilityEvents(records: BenchmarkExecutionRecord[]): ReliabilityEvent[] {
  return records
    .filter((r) => !r.success)
    .map((r) => ({
      type: reliabilityEventTypeForStage(r.failureStage),
      timestamp: r.timestamp,
    }));
}

/** Every record becomes one `PipelineResult` — the fields Runtime Analytics actually reads
 *  (`success`, `totalDurationMs`, `stageDurations`) map directly onto what Benchmark Core already
 *  stores; the rest of `PipelineResult` is optional and left unset. */
function toPipelineResults(records: BenchmarkExecutionRecord[]): PipelineResult[] {
  return records.map((r) => ({
    success: r.success,
    startedAt: r.timestamp,
    finishedAt: r.timestamp + r.pipelineDurationMs,
    totalDurationMs: r.pipelineDurationMs,
    stageDurations: r.stageDurations as PipelineResult['stageDurations'],
  }));
}

/** Builds a full six-report `BenchmarkReportBundle` for one session directly from its recorded
 *  executions. Matches the `buildReportBundle` shape `routes/benchmark.ts::BenchmarkApiConfig`
 *  expects, so it can be passed straight to `createBenchmarkRouter({ buildReportBundle })`.
 *  Returns `null` for a session with no records, same as an unconfigured session 404ing rather
 *  than returning a fabricated empty bundle. */
export function buildReportBundle(sessionId: string, records: BenchmarkExecutionRecord[]): BenchmarkReportBundle | null {
  if (records.length === 0) return null;

  const generatedAt = records.reduce((max, r) => Math.max(max, r.recordedAt), 0);

  return buildBenchmarkReportBundle({
    generatedAt,
    sessionId,
    trading: computeTradingMetrics(records),
    strategy: buildStrategyRanking([]),
    runtime: computePipelineLatencyReport(toPipelineResults(records)),
    memory: buildMemoryAnalyticsReport({ episodic: [], semantic: [], working: [], now: generatedAt }),
    learning: buildLearningTrendReport([]),
    reliability: computeReliabilityReport(toReliabilityEvents(records), records.length),
  });
}
