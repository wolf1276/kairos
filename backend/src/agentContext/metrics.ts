// Context Layer observability — in-process counters/histograms only. Pure bookkeeping: never
// reads/writes agent state, never changes what buildAgentContext returns or how it decides
// anything. Safe to rip out with zero behavior change anywhere else.

const SLOW_BUILD_THRESHOLD_MS = 500;

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

const contextBuildDuration = newDurationStats();
const providerLatency = newDurationStats();

let contextBuildSuccessCount = 0;
let contextBuildFailureCount = 0;
let contextBuildNullCount = 0; // "not ready yet" (no candle history), distinct from a thrown error
let slowBuildCount = 0;

let cacheHitCount = 0;
let cacheMissCount = 0;

let validationOkCount = 0;
let validationFailCount = 0;
const validationErrorCounts = new Map<string, number>();

let qualityScoreTotal = 0;
let qualityScoreCount = 0;
const qualityLevelCounts: Record<'high' | 'medium' | 'low', number> = { high: 0, medium: 0, low: 0 };

const confidenceTotals: Record<'market' | 'capital' | 'policy' | 'system' | 'historical', { total: number; count: number }> = {
  market: { total: 0, count: 0 },
  capital: { total: 0, count: 0 },
  policy: { total: 0, count: 0 },
  system: { total: 0, count: 0 },
  historical: { total: 0, count: 0 },
};

/** Records one buildAgentContext() attempt's wall-clock duration and outcome, and logs a warning
 *  if it crossed the slow-build threshold. Call this around the build, not inside it. */
export function recordContextBuild(durationMs: number, outcome: 'success' | 'failure' | 'null'): void {
  record(contextBuildDuration, durationMs);
  if (outcome === 'success') contextBuildSuccessCount += 1;
  else if (outcome === 'failure') contextBuildFailureCount += 1;
  else contextBuildNullCount += 1;

  if (durationMs >= SLOW_BUILD_THRESHOLD_MS) {
    slowBuildCount += 1;
    console.warn(`[context-metrics] slow context build: ${durationMs.toFixed(1)}ms (threshold ${SLOW_BUILD_THRESHOLD_MS}ms)`);
  }
}

export function recordCacheHit(): void {
  cacheHitCount += 1;
}

export function recordCacheMiss(): void {
  cacheMissCount += 1;
}

/** Records latency of a single call into the FeatureCacheProvider (get/set/invalidate/...) —
 *  provider-agnostic, so swapping in a Redis-backed provider later is covered automatically. */
export function recordProviderLatency(durationMs: number): void {
  record(providerLatency, durationMs);
}

export function recordValidation(ok: boolean, errors: string[]): void {
  if (ok) validationOkCount += 1;
  else validationFailCount += 1;
  for (const err of errors) {
    validationErrorCounts.set(err, (validationErrorCounts.get(err) ?? 0) + 1);
  }
}

export function recordQuality(score: number, level: 'high' | 'medium' | 'low'): void {
  qualityScoreTotal += score;
  qualityScoreCount += 1;
  qualityLevelCounts[level] += 1;
}

export function recordDomainConfidence(domain: keyof typeof confidenceTotals, value: number): void {
  confidenceTotals[domain].total += value;
  confidenceTotals[domain].count += 1;
}

/** Read-only snapshot for a /metrics-style endpoint or ad-hoc inspection — never mutates state. */
export function getContextMetricsSnapshot() {
  return {
    contextBuild: {
      count: contextBuildDuration.count,
      successCount: contextBuildSuccessCount,
      failureCount: contextBuildFailureCount,
      nullCount: contextBuildNullCount,
      slowBuildCount,
      slowBuildThresholdMs: SLOW_BUILD_THRESHOLD_MS,
      avgDurationMs: avg(contextBuildDuration),
      maxDurationMs: contextBuildDuration.maxMs,
      minDurationMs: contextBuildDuration.count === 0 ? 0 : contextBuildDuration.minMs,
    },
    cache: {
      hits: cacheHitCount,
      misses: cacheMissCount,
      hitRate: cacheHitCount + cacheMissCount === 0 ? 0 : cacheHitCount / (cacheHitCount + cacheMissCount),
    },
    providerLatency: {
      count: providerLatency.count,
      avgMs: avg(providerLatency),
      maxMs: providerLatency.maxMs,
    },
    validation: {
      okCount: validationOkCount,
      failCount: validationFailCount,
      topErrors: [...validationErrorCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([error, count]) => ({ error, count })),
    },
    quality: {
      avgScore: qualityScoreCount === 0 ? 0 : qualityScoreTotal / qualityScoreCount,
      levelCounts: { ...qualityLevelCounts },
    },
    confidence: Object.fromEntries(
      Object.entries(confidenceTotals).map(([domain, { total, count }]) => [domain, count === 0 ? 0 : total / count])
    ),
  };
}

/** Test-only reset — production code never calls this. */
export function resetContextMetrics(): void {
  contextBuildDuration.count = 0;
  contextBuildDuration.totalMs = 0;
  contextBuildDuration.maxMs = 0;
  contextBuildDuration.minMs = Infinity;
  providerLatency.count = 0;
  providerLatency.totalMs = 0;
  providerLatency.maxMs = 0;
  providerLatency.minMs = Infinity;
  contextBuildSuccessCount = 0;
  contextBuildFailureCount = 0;
  contextBuildNullCount = 0;
  slowBuildCount = 0;
  cacheHitCount = 0;
  cacheMissCount = 0;
  validationOkCount = 0;
  validationFailCount = 0;
  validationErrorCounts.clear();
  qualityScoreTotal = 0;
  qualityScoreCount = 0;
  qualityLevelCounts.high = 0;
  qualityLevelCounts.medium = 0;
  qualityLevelCounts.low = 0;
  for (const key of Object.keys(confidenceTotals) as (keyof typeof confidenceTotals)[]) {
    confidenceTotals[key].total = 0;
    confidenceTotals[key].count = 0;
  }
}
