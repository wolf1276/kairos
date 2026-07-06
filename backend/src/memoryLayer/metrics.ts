// Memory Engine observability — in-process counters only, same shape as agentContext/metrics.ts.
// Pure bookkeeping: never reads/writes memory state, never changes what assembleMemoryPackage
// returns. Safe to rip out with zero behavior change anywhere else. No new monitoring framework
// is introduced — this reuses the existing Context Layer's counter/snapshot pattern.

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

const assemblyDuration = newDurationStats();
let assemblySuccessCount = 0;
let assemblyFailureCount = 0;

let validationOkCount = 0;
let validationFailCount = 0;
const validationErrorCounts = new Map<string, number>();

export function recordMemoryAssembly(durationMs: number, outcome: 'success' | 'failure'): void {
  record(assemblyDuration, durationMs);
  if (outcome === 'success') assemblySuccessCount += 1;
  else assemblyFailureCount += 1;
}

export function recordMemoryValidation(ok: boolean, errors: string[]): void {
  if (ok) validationOkCount += 1;
  else validationFailCount += 1;
  for (const err of errors) {
    validationErrorCounts.set(err, (validationErrorCounts.get(err) ?? 0) + 1);
  }
}

/** Read-only snapshot for a /metrics-style endpoint or ad-hoc inspection — never mutates state. */
export function getMemoryMetricsSnapshot() {
  return {
    assembly: {
      count: assemblyDuration.count,
      successCount: assemblySuccessCount,
      failureCount: assemblyFailureCount,
      avgDurationMs: avg(assemblyDuration),
      maxDurationMs: assemblyDuration.maxMs,
      minDurationMs: assemblyDuration.count === 0 ? 0 : assemblyDuration.minMs,
    },
    validation: {
      okCount: validationOkCount,
      failCount: validationFailCount,
      topErrors: [...validationErrorCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([error, count]) => ({ error, count })),
    },
  };
}

/** Test-only reset — production code never calls this. */
export function resetMemoryMetrics(): void {
  assemblyDuration.count = 0;
  assemblyDuration.totalMs = 0;
  assemblyDuration.maxMs = 0;
  assemblyDuration.minMs = Infinity;
  assemblySuccessCount = 0;
  assemblyFailureCount = 0;
  validationOkCount = 0;
  validationFailCount = 0;
  validationErrorCounts.clear();
}
