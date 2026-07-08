// Runtime Analytics (Phase 6), pure half. No I/O, no `os`/`process` reads — every function here
// takes already-observed history (PipelineResult[], token-throughput inputs, a SchedulerStatus)
// and aggregates it. Same "never fabricate a metric it doesn't have data for" philosophy as
// strategyEngine/analytics.ts, memoryLayer/analytics.ts, learningAnalytics/analytics.ts. Live
// OS/process sampling (CPU%, RAM, GPU) lives in ./snapshot.ts, kept separate so this file stays
// trivially unit-testable.
import { PIPELINE_STAGE_NAMES } from '../runtime/pipelineRunner/types.js';
import type { PipelineStageName } from '../runtime/pipelineRunner/types.js';
import type { SchedulerStatus } from '../runner.js';
import type {
  PipelineLatencyReport,
  PipelineResult,
  SchedulerHealth,
  StageLatencyStats,
  TokenThroughput,
  TokenThroughputInput,
} from './types.js';

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/** Nearest-rank percentile over a sorted-ascending copy of `values`; 0 for an empty input. */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function analyzeStage(stage: PipelineStageName, durations: number[]): StageLatencyStats {
  return {
    stage,
    runCount: durations.length,
    avgMs: mean(durations),
    minMs: durations.length > 0 ? Math.min(...durations) : 0,
    maxMs: durations.length > 0 ? Math.max(...durations) : 0,
    p95Ms: percentile(durations, 95),
  };
}

/** Aggregates pipeline- and stage-level latency across a batch of already-run `PipelineResult`s
 *  (e.g. pulled from wherever a caller logs/stores them — this module never runs a pipeline).
 *  A stage that never completed in a given run (failed before it, or the run failed on it and
 *  duration wasn't recorded) is simply excluded from that stage's samples, not counted as 0. */
export function computePipelineLatencyReport(results: PipelineResult[]): PipelineLatencyReport {
  const totals = results.map((r) => r.totalDurationMs);
  const stages = PIPELINE_STAGE_NAMES.map((stageName) => {
    const durations = results
      .map((r) => r.stageDurations[stageName])
      .filter((d): d is number => typeof d === 'number' && Number.isFinite(d));
    return analyzeStage(stageName, durations);
  });

  return {
    runCount: results.length,
    successCount: results.filter((r) => r.success).length,
    failureCount: results.filter((r) => !r.success).length,
    avgTotalMs: mean(totals),
    minTotalMs: totals.length > 0 ? Math.min(...totals) : 0,
    maxTotalMs: totals.length > 0 ? Math.max(...totals) : 0,
    p95TotalMs: percentile(totals, 95),
    stages,
  };
}

/** Derives tokens/sec per (provider, model) from already-accumulated totals — mirrors
 *  `monitoring/monitor.ts::buildDecisionIntelligenceMetrics`'s read of Decision Intelligence's
 *  own aggregate, just adding the throughput division that module doesn't compute. */
export function computeTokenThroughput(inputs: TokenThroughputInput[]): TokenThroughput[] {
  return inputs
    .map((input) => ({
      provider: input.provider,
      model: input.model,
      totalTokens: input.totalTokens,
      tokensPerSec: input.totalProviderLatencyMs > 0 ? input.totalTokens / (input.totalProviderLatencyMs / 1000) : null,
    }))
    .sort((a, b) => `${a.provider}:${a.model}`.localeCompare(`${b.provider}:${b.model}`));
}

/** Classifies scheduler health from its own reported status — never a live check, purely a
 *  reading of what the scheduler already tracked. `stopped`: not running. `unknown`: running but
 *  no cycle has completed yet (can't judge staleness). `stalled`: running, has cycled before, but
 *  the gap since the last completed cycle exceeds `staleFactor` * its own interval (default 3x —
 *  generous enough to tolerate one slow cycle without false-alarming, tight enough to catch a
 *  genuinely stuck loop). `healthy`: running and within that window. */
export function evaluateSchedulerHealth(
  status: SchedulerStatus,
  now: number = Date.now(),
  staleFactor: number = 3
): SchedulerHealth {
  if (!status.running) {
    return { level: 'stopped', status, msSinceLastCycle: null };
  }
  if (status.lastCycleFinishedAt === null) {
    return { level: 'unknown', status, msSinceLastCycle: null };
  }
  const msSinceLastCycle = now - status.lastCycleFinishedAt;
  const level = msSinceLastCycle > status.intervalMs * staleFactor ? 'stalled' : 'healthy';
  return { level, status, msSinceLastCycle };
}
