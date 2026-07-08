// Runtime Analytics (Phase 6), live half. Reads host/process stats directly (os, process) and
// the scheduler's own tracked status — same "read what already exists, never fabricate" approach
// as monitoring/monitor.ts, kept in a separate file from analytics.ts so the pure aggregation
// logic stays trivially unit-testable without touching the OS.
import os from 'os';
import { getSchedulerStatus } from '../runner.js';
import { evaluateSchedulerHealth } from './analytics.js';
import type { GpuInfo, GpuProvider } from '../monitoring/types.js';
import type { CpuSample, CpuUsage, RamUsage, RuntimeAnalyticsSnapshot } from './types.js';

export { RUNTIME_ANALYTICS_VERSION } from './types.js';

/** Takes a `process.cpuUsage()` sample now — pair two of these with `computeCpuUsagePct` to get a
 *  usage percentage over the interval between them. Exported separately (rather than always
 *  sampling twice internally) so a caller can hold a running baseline instead of paying a forced
 *  delay on every snapshot. */
export function sampleCpuUsage(): CpuSample {
  const usage = process.cpuUsage();
  return { userMicros: usage.user, systemMicros: usage.system, takenAt: Date.now() };
}

/** Percentage of one CPU core consumed between `start` and `end`. `100` means one core was fully
 *  busy for the whole interval; can exceed 100 under multi-core work. 0 when the interval is
 *  non-positive (can't divide by it) rather than a fabricated number. */
function computeCpuUsagePct(start: CpuSample, end: CpuSample): number {
  const elapsedMs = end.takenAt - start.takenAt;
  if (elapsedMs <= 0) return 0;
  const cpuMicros = end.userMicros - start.userMicros + (end.systemMicros - start.systemMicros);
  const cpuMs = cpuMicros / 1000;
  return (cpuMs / elapsedMs) * 100;
}

function buildRamUsage(): RamUsage {
  const mem = process.memoryUsage();
  return {
    totalBytes: os.totalmem(),
    freeBytes: os.freemem(),
    usedBytes: os.totalmem() - os.freemem(),
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
  };
}

function buildCpuUsage(usagePct: number): CpuUsage {
  const [loadAvg1m, loadAvg5m, loadAvg15m] = os.loadavg();
  return { usagePct, loadAvg1m, loadAvg5m, loadAvg15m, cpuCount: os.cpus().length };
}

export interface RuntimeAnalyticsSnapshotOptions {
  /** Window (ms) over which CPU% is sampled — two `process.cpuUsage()` reads this far apart.
   *  Defaults to 100ms: long enough to be a meaningful sample, short enough not to noticeably
   *  delay a snapshot request. */
  cpuSampleWindowMs?: number;
  gpuProvider?: GpuProvider;
}

/** Builds one point-in-time Runtime Analytics snapshot: CPU%, RAM, GPU (if a provider is
 *  supplied), process uptime, and scheduler health (read from the in-process scheduler's own
 *  tracked status via `getSchedulerStatus`). Deliberately does NOT include pipeline/stage latency
 *  or tokens/sec here — those are batch aggregations over history a caller supplies to
 *  `computePipelineLatencyReport` / `computeTokenThroughput` in analytics.ts, not a live reading. */
export async function buildRuntimeAnalyticsSnapshot(
  options: RuntimeAnalyticsSnapshotOptions = {}
): Promise<RuntimeAnalyticsSnapshot> {
  const windowMs = options.cpuSampleWindowMs ?? 100;
  const start = sampleCpuUsage();
  await new Promise((resolve) => setTimeout(resolve, windowMs));
  const end = sampleCpuUsage();

  const gpu: GpuInfo | null = options.gpuProvider ? await options.gpuProvider() : null;

  return {
    generatedAt: Date.now(),
    uptimeMs: process.uptime() * 1000,
    cpu: buildCpuUsage(computeCpuUsagePct(start, end)),
    ram: buildRamUsage(),
    gpu,
    scheduler: evaluateSchedulerHealth(getSchedulerStatus()),
  };
}
