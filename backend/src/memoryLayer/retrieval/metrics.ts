// Retrieval observability — same in-process counter/snapshot pattern as memoryLayer/metrics.ts.
// No new monitoring framework.
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

const retrievalDuration = newDurationStats();
const rankingDuration = newDurationStats();
let retrievalSuccessCount = 0;
let retrievalFailureCount = 0;
let totalScanned = 0;
let totalSelected = 0;

export function recordRetrieval(retrievalMs: number, rankingMs: number, scanned: number, selected: number, outcome: 'success' | 'failure'): void {
  record(retrievalDuration, retrievalMs);
  record(rankingDuration, rankingMs);
  totalScanned += scanned;
  totalSelected += selected;
  if (outcome === 'success') retrievalSuccessCount += 1;
  else retrievalFailureCount += 1;
}

export function getRetrievalMetricsSnapshot() {
  return {
    retrieval: {
      count: retrievalDuration.count,
      successCount: retrievalSuccessCount,
      failureCount: retrievalFailureCount,
      avgDurationMs: avg(retrievalDuration),
      maxDurationMs: retrievalDuration.maxMs,
      minDurationMs: retrievalDuration.count === 0 ? 0 : retrievalDuration.minMs,
    },
    ranking: {
      count: rankingDuration.count,
      avgDurationMs: avg(rankingDuration),
      maxDurationMs: rankingDuration.maxMs,
      minDurationMs: rankingDuration.count === 0 ? 0 : rankingDuration.minMs,
    },
    totalScanned,
    totalSelected,
  };
}

/** Test-only reset — production code never calls this. */
export function resetRetrievalMetrics(): void {
  retrievalDuration.count = 0;
  retrievalDuration.totalMs = 0;
  retrievalDuration.maxMs = 0;
  retrievalDuration.minMs = Infinity;
  rankingDuration.count = 0;
  rankingDuration.totalMs = 0;
  rankingDuration.maxMs = 0;
  rankingDuration.minMs = Infinity;
  retrievalSuccessCount = 0;
  retrievalFailureCount = 0;
  totalScanned = 0;
  totalSelected = 0;
}
