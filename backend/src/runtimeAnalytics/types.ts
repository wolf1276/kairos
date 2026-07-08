// Types for Runtime Analytics (Phase 6). Extends Runtime Monitoring (Phase 8, frozen) with the
// fields it doesn't cover — CPU%, pipeline/stage latency, tokens/sec, scheduler health — without
// modifying that module. Every field is either a direct OS/process read or a pure aggregation
// over caller-supplied history (PipelineResult[], decision-intelligence aggregates, scheduler
// status); nothing here is inferred or fabricated.
import type { GpuInfo } from '../monitoring/types.js';
import type { PipelineResult, PipelineStageName } from '../runtime/pipelineRunner/types.js';
import type { SchedulerStatus } from '../runner.js';

export const RUNTIME_ANALYTICS_VERSION = '1.0.0';

export interface CpuSample {
  /** `process.cpuUsage()` snapshot — microseconds of user+system CPU time consumed so far. */
  userMicros: number;
  systemMicros: number;
  /** `Date.now()` at the moment this sample was taken. */
  takenAt: number;
}

export interface CpuUsage {
  /** Percentage of one core consumed between the two samples (can exceed 100 on multi-core work). */
  usagePct: number;
  loadAvg1m: number;
  loadAvg5m: number;
  loadAvg15m: number;
  cpuCount: number;
}

export interface RamUsage {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  rssBytes: number;
  heapUsedBytes: number;
}

export interface StageLatencyStats {
  stage: PipelineStageName;
  runCount: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p95Ms: number;
}

export interface PipelineLatencyReport {
  runCount: number;
  successCount: number;
  failureCount: number;
  avgTotalMs: number;
  minTotalMs: number;
  maxTotalMs: number;
  p95TotalMs: number;
  stages: StageLatencyStats[];
}

/** Provider-call record with enough fields to derive tokens/sec — a subset of what Decision
 *  Intelligence's own aggregate (`DecisionModelMetric`, Phase 8) already exposes per provider/model. */
export interface TokenThroughputInput {
  provider: string;
  model: string;
  totalTokens: number;
  totalProviderLatencyMs: number;
}

export interface TokenThroughput {
  provider: string;
  model: string;
  totalTokens: number;
  /** `null` when total observed latency is 0 (no basis to divide by), never a fabricated rate. */
  tokensPerSec: number | null;
}

export type SchedulerHealthLevel = 'healthy' | 'stalled' | 'stopped' | 'unknown';

export interface SchedulerHealth {
  level: SchedulerHealthLevel;
  status: SchedulerStatus;
  /** ms since the last cycle finished, or null if no cycle has ever run. */
  msSinceLastCycle: number | null;
}

export interface RuntimeAnalyticsSnapshot {
  generatedAt: number;
  uptimeMs: number;
  cpu: CpuUsage;
  ram: RamUsage;
  gpu: GpuInfo | null;
  scheduler: SchedulerHealth;
}

export type { PipelineResult };
