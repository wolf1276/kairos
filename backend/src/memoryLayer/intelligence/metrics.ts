// Intelligence observability — same in-process counter/snapshot pattern as memoryLayer/metrics.ts
// and memoryLayer/retrieval/metrics.ts. No new monitoring framework. Structured (object-shaped)
// log line on every build, matching the rest of the codebase's console-based structured logging.
interface DurationStats {
  count: number;
  totalMs: number;
  maxMs: number;
  minMs: number;
}

function newDurationStats(): DurationStats {
  return { count: 0, totalMs: 0, maxMs: 0, minMs: Infinity };
}

function record(stats: DurationStats, ms: number): void {
  stats.count += 1;
  stats.totalMs += ms;
  if (ms > stats.maxMs) stats.maxMs = ms;
  if (ms < stats.minMs) stats.minMs = ms;
}

function avg(stats: DurationStats): number {
  return stats.count === 0 ? 0 : stats.totalMs / stats.count;
}

const intelligenceDuration = newDurationStats();
const statisticsDuration = newDurationStats();
const patternDuration = newDurationStats();
const conflictDuration = newDurationStats();
const evidenceDuration = newDurationStats();
let successCount = 0;
let failureCount = 0;
let totalPatternCount = 0;
let totalEvidenceCount = 0;

export interface IntelligenceMetricsInput {
  intelligenceMs: number;
  statisticsMs: number;
  patternMs: number;
  conflictMs: number;
  evidenceMs: number;
  patternCount: number;
  evidenceCount: number;
  outcome: 'success' | 'failure';
}

export function recordIntelligence(input: IntelligenceMetricsInput): void {
  record(intelligenceDuration, input.intelligenceMs);
  record(statisticsDuration, input.statisticsMs);
  record(patternDuration, input.patternMs);
  record(conflictDuration, input.conflictMs);
  record(evidenceDuration, input.evidenceMs);
  totalPatternCount += input.patternCount;
  totalEvidenceCount += input.evidenceCount;
  if (input.outcome === 'success') successCount += 1;
  else failureCount += 1;
}

/** Slow-build threshold mirrors agentContext/metrics.ts's pattern: log only the anomalous case
 *  (structured, one line), never a line per successful call — an intelligence build runs on
 *  every tick, so per-call logging would be pure noise at steady state. */
const SLOW_INTELLIGENCE_BUILD_MS = 500;

export function logIfSlow(input: IntelligenceMetricsInput): void {
  if (input.outcome === 'failure' || input.intelligenceMs <= SLOW_INTELLIGENCE_BUILD_MS) return;
  // eslint-disable-next-line no-console
  console.warn('[memory-intelligence] slow build:', {
    intelligenceMs: Math.round(input.intelligenceMs * 100) / 100,
    statisticsMs: Math.round(input.statisticsMs * 100) / 100,
    patternMs: Math.round(input.patternMs * 100) / 100,
    conflictMs: Math.round(input.conflictMs * 100) / 100,
    evidenceMs: Math.round(input.evidenceMs * 100) / 100,
    patternCount: input.patternCount,
    evidenceCount: input.evidenceCount,
  });
}

export function getIntelligenceMetricsSnapshot() {
  return {
    intelligence: {
      count: intelligenceDuration.count,
      successCount,
      failureCount,
      avgDurationMs: avg(intelligenceDuration),
      maxDurationMs: intelligenceDuration.maxMs,
      minDurationMs: intelligenceDuration.count === 0 ? 0 : intelligenceDuration.minMs,
    },
    statistics: { avgDurationMs: avg(statisticsDuration), maxDurationMs: statisticsDuration.maxMs },
    patterns: { avgDurationMs: avg(patternDuration), maxDurationMs: patternDuration.maxMs, totalCount: totalPatternCount },
    conflicts: { avgDurationMs: avg(conflictDuration), maxDurationMs: conflictDuration.maxMs },
    evidence: { avgDurationMs: avg(evidenceDuration), maxDurationMs: evidenceDuration.maxMs, totalCount: totalEvidenceCount },
  };
}

/** Test-only reset — production code never calls this. */
export function resetIntelligenceMetrics(): void {
  for (const stats of [intelligenceDuration, statisticsDuration, patternDuration, conflictDuration, evidenceDuration]) {
    stats.count = 0;
    stats.totalMs = 0;
    stats.maxMs = 0;
    stats.minMs = Infinity;
  }
  successCount = 0;
  failureCount = 0;
  totalPatternCount = 0;
  totalEvidenceCount = 0;
}
