// Types for Runtime Monitoring (Phase 8). Pure observability over the existing, frozen runtime
// layers — Autonomous Runtime (Phase 11), Decision Intelligence (Phase 3), Protocol Adapter
// Framework — plus host process stats. No engine logic lives here: every field is either read
// directly off an existing component's own reporting surface or a direct OS/process stat, never
// inferred. Fields this process cannot honestly observe (e.g. GPU, absent a caller-supplied
// provider) are `null`, never fabricated.
import type { AutonomousRuntime, RuntimeState } from '../runtime/autonomousRuntime/index.js';
import type { ProtocolRegistry } from '../protocolAdapters/registry.js';
import type { HealthStatus } from '../protocolAdapters/types.js';

export const MONITORING_VERSION = '1.0.0';

/** GPU stats are not obtainable in a portable way from plain Node — no native binding is added
 *  here (that would be an engine/dependency change). Callers running on hardware where GPU stats
 *  are available may inject a `GpuProvider`; without one, `gpu` is reported as `null`. */
export interface GpuInfo {
  name?: string;
  utilizationPct?: number;
  memoryUsedBytes?: number;
  memoryTotalBytes?: number;
}

export type GpuProvider = () => GpuInfo | null | Promise<GpuInfo | null>;

export interface MonitoringConfig {
  /** Autonomous Runtime instance to report uptime/provider/model/executionCount/failureCount
   *  from — omitted when no runtime is wired up yet, in which case `runtime` is reported `null`. */
  runtime?: AutonomousRuntime;
  /** Protocol registry to live-query per-protocol health from — omitted when not wired up yet,
   *  in which case `protocolHealth` is reported `null`. */
  registry?: ProtocolRegistry;
  gpuProvider?: GpuProvider;
}

export interface ProcessMetrics {
  uptimeMs: number;
  ramTotalBytes: number;
  ramFreeBytes: number;
  ramUsedBytes: number;
  rssBytes: number;
  heapUsedBytes: number;
  gpu: GpuInfo | null;
}

export interface RuntimeMetrics {
  status: RuntimeState;
  uptimeMs: number;
  provider: string | null;
  model: string | null;
  executionCount: number;
  failureCount: number;
  lastExecutionAt: number | null;
}

/** Per (provider, model) reasoning-call metrics — a direct read of Decision Intelligence's own
 *  already-recorded aggregate (`decisionIntelligence/metrics.ts::getDecisionIntelligenceMetrics`),
 *  never re-derived. `avgLatencyMs` is `null` rather than a fabricated 0 when zero calls have
 *  been recorded for that (provider, model) pair. */
export interface DecisionModelMetric {
  provider: string;
  model: string;
  calls: number;
  failures: number;
  retries: number;
  avgLatencyMs: number | null;
}

export interface ProtocolHealthEntry {
  protocol: string;
  status: HealthStatus;
}

export interface MonitoringSnapshot {
  generatedAt: number;
  process: ProcessMetrics;
  /** `null` when no AutonomousRuntime was supplied to `buildMonitoringSnapshot`. */
  runtime: RuntimeMetrics | null;
  decisionIntelligence: DecisionModelMetric[];
  /** `null` when no ProtocolRegistry was supplied to `buildMonitoringSnapshot`. */
  protocolHealth: ProtocolHealthEntry[] | null;
}
