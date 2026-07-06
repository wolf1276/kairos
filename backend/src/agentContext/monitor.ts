// Context Layer operational monitor — periodic self-check over the counters in metrics.ts.
// Pure read of already-recorded metrics + a plain setInterval loop (same pattern as
// runner.ts's scheduler): never touches contextBuilder.ts, never calls buildAgentContext, never
// changes what a context looks like. Reuses the existing scheduling infrastructure rather than
// introducing a new job runner, and reuses metrics.ts rather than a new metrics store.
//
// Extension point for Prometheus/OpenTelemetry: getContextHealthSummary()'s return shape is the
// single seam a future exporter needs — wrap it in a `/metrics` text-format handler (prom-client)
// or push it via an OTel Meter's observable gauges on the same interval this module already
// ticks on. No other file would need to change.
import { getContextMonitorIntervalMs } from '../config.js';
import { getContextMetricsSnapshot } from './metrics.js';

// ── Thresholds ────────────────────────────────────────────────────────────────────────────────
// Each one is a simple, independently-tunable constant — see docs/architecture/CONTEXT_LAYER.md
// (or the "Thresholds" section this task's summary documents) for the reasoning behind each
// number. Kept here, not in config.ts/env, since these are monitoring judgment calls, not
// deployment configuration.
const THRESHOLDS = {
  /** Below this, contexts are failing to build often enough that something upstream (oracle,
   *  DB, a domain builder) is likely degraded — not just occasional bad input. */
  minSuccessRate: 0.95,
  /** Above this fraction of contexts failing validation, the *data* feeding the Context Layer
   *  (not the layer itself) is probably the problem — worth a look even though every one of
   *  those contexts is still returned (never blocked) for inspection. */
  maxValidationFailureRate: 0.2,
  /** Below this, the feature cache isn't doing its job (every request re-hits the oracle) —
   *  only evaluated once there's enough cache traffic to be meaningful (see minCacheSamples). */
  minCacheHitRate: 0.5,
  minCacheSamples: 20,
  /** Above this fraction of builds crossing metrics.ts's own slow-build threshold, latency is a
   *  systemic issue, not a one-off. */
  maxSlowBuildRate: 0.05,
  /** Below this average quality score, the platform is routinely handing future reasoning
   *  layers low-confidence data even when individual contexts are technically "valid". */
  minAvgQualityScore: 0.4,
} as const;

export type ContextHealthStatus = 'healthy' | 'degraded';

export interface ContextHealthWarning {
  code: string;
  message: string;
  observed: number;
  threshold: number;
}

export interface ContextHealthSummary {
  status: ContextHealthStatus;
  checkedAt: number;
  successRate: number;
  validationFailureRate: number;
  cacheHitRate: number;
  slowBuildRate: number;
  avgQualityScore: number;
  warnings: ContextHealthWarning[];
  metrics: ReturnType<typeof getContextMetricsSnapshot>;
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

/** Computes the current health summary from metrics.ts's counters — pure, synchronous, no I/O.
 *  Safe to call from a route handler on every request; the self-check loop below just also logs
 *  it periodically so warnings show up in server logs without anyone needing to poll an endpoint. */
export function getContextHealthSummary(): ContextHealthSummary {
  const metrics = getContextMetricsSnapshot();
  const { contextBuild, cache, validation, quality } = metrics;

  const successRate = rate(contextBuild.successCount + contextBuild.nullCount, contextBuild.count);
  const validationFailureRate = rate(validation.failCount, validation.okCount + validation.failCount);
  const cacheSamples = cache.hits + cache.misses;
  const cacheHitRate = cache.hitRate;
  const slowBuildRate = rate(contextBuild.slowBuildCount, contextBuild.count);
  const avgQualityScore = quality.avgScore;

  const warnings: ContextHealthWarning[] = [];

  if (contextBuild.count > 0 && successRate < THRESHOLDS.minSuccessRate) {
    warnings.push({
      code: 'LOW_SUCCESS_RATE',
      message: `Context build success rate ${(successRate * 100).toFixed(1)}% is below the ${(THRESHOLDS.minSuccessRate * 100).toFixed(0)}% threshold`,
      observed: successRate,
      threshold: THRESHOLDS.minSuccessRate,
    });
  }
  if (validation.okCount + validation.failCount > 0 && validationFailureRate > THRESHOLDS.maxValidationFailureRate) {
    warnings.push({
      code: 'HIGH_VALIDATION_FAILURE_RATE',
      message: `Validation failure rate ${(validationFailureRate * 100).toFixed(1)}% exceeds the ${(THRESHOLDS.maxValidationFailureRate * 100).toFixed(0)}% threshold`,
      observed: validationFailureRate,
      threshold: THRESHOLDS.maxValidationFailureRate,
    });
  }
  if (cacheSamples >= THRESHOLDS.minCacheSamples && cacheHitRate < THRESHOLDS.minCacheHitRate) {
    warnings.push({
      code: 'LOW_CACHE_HIT_RATE',
      message: `Cache hit rate ${(cacheHitRate * 100).toFixed(1)}% is below the ${(THRESHOLDS.minCacheHitRate * 100).toFixed(0)}% threshold`,
      observed: cacheHitRate,
      threshold: THRESHOLDS.minCacheHitRate,
    });
  }
  if (contextBuild.count > 0 && slowBuildRate > THRESHOLDS.maxSlowBuildRate) {
    warnings.push({
      code: 'HIGH_SLOW_BUILD_RATE',
      message: `Slow-build rate ${(slowBuildRate * 100).toFixed(1)}% exceeds the ${(THRESHOLDS.maxSlowBuildRate * 100).toFixed(0)}% threshold (>=${contextBuild.slowBuildThresholdMs}ms)`,
      observed: slowBuildRate,
      threshold: THRESHOLDS.maxSlowBuildRate,
    });
  }
  if (quality.avgScore > 0 && avgQualityScore < THRESHOLDS.minAvgQualityScore) {
    warnings.push({
      code: 'LOW_AVG_QUALITY',
      message: `Average context quality score ${avgQualityScore.toFixed(2)} is below the ${THRESHOLDS.minAvgQualityScore} threshold`,
      observed: avgQualityScore,
      threshold: THRESHOLDS.minAvgQualityScore,
    });
  }

  return {
    status: warnings.length === 0 ? 'healthy' : 'degraded',
    checkedAt: Date.now(),
    successRate,
    validationFailureRate,
    cacheHitRate,
    slowBuildRate,
    avgQualityScore,
    warnings,
    metrics,
  };
}

let timer: ReturnType<typeof setInterval> | null = null;
let lastSummary: ContextHealthSummary | null = null;

function runSelfCheck(): void {
  const summary = getContextHealthSummary();
  lastSummary = summary;
  if (summary.status === 'degraded') {
    // Structured, single-line, machine-parseable — one JSON object per warning batch rather than
    // prose, so a log pipeline (or a human grepping logs) can pull `code`/`observed`/`threshold`
    // out without parsing free text.
    console.warn(
      '[context-monitor] degraded:',
      JSON.stringify({ checkedAt: summary.checkedAt, warnings: summary.warnings })
    );
  }
}

/** Starts the periodic self-check (idempotent — a second call while already running is a
 *  no-op, same contract as runner.ts's startScheduler). Runs one check immediately, then every
 *  getContextMonitorIntervalMs(). */
export function startContextMonitor(): void {
  if (timer) return;
  timer = setInterval(runSelfCheck, getContextMonitorIntervalMs());
  timer.unref?.();
  runSelfCheck();
}

export function stopContextMonitor(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function isContextMonitorRunning(): boolean {
  return timer !== null;
}

/** Last self-check result, or null if the monitor has never run a check yet. Routes/health
 *  endpoints should prefer calling getContextHealthSummary() directly for a fresh read; this is
 *  for cases that specifically want "what did the periodic check last see". */
export function getLastContextHealthSummary(): ContextHealthSummary | null {
  return lastSummary;
}
