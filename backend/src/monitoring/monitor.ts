// Runtime Monitoring (Phase 8): aggregates uptime/provider/model/GPU/RAM/latency/retries/
// failures/protocol health from the existing frozen components — Autonomous Runtime (Phase 11),
// Decision Intelligence (Phase 3), Protocol Adapter Framework — plus host process stats. No
// engine changes: this module only reads what those components already expose (heartbeats,
// metrics aggregates, live health() calls), it never re-implements or wraps their logic.
import os from 'os';
import { getDecisionIntelligenceMetrics } from '../reasoning/decisionIntelligence/metrics.js';
import type { DecisionModelMetric, MonitoringConfig, MonitoringSnapshot, ProcessMetrics, ProtocolHealthEntry, RuntimeMetrics } from './types.js';

export { MONITORING_VERSION } from './types.js';

function splitProviderModelKey(key: string): [string, string] {
  const separatorIndex = key.indexOf(':');
  return separatorIndex === -1 ? [key, ''] : [key.slice(0, separatorIndex), key.slice(separatorIndex + 1)];
}

async function buildProcessMetrics(config: MonitoringConfig): Promise<ProcessMetrics> {
  const mem = process.memoryUsage();
  return {
    uptimeMs: process.uptime() * 1000,
    ramTotalBytes: os.totalmem(),
    ramFreeBytes: os.freemem(),
    ramUsedBytes: os.totalmem() - os.freemem(),
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
    gpu: config.gpuProvider ? await config.gpuProvider() : null,
  };
}

function buildRuntimeMetrics(config: MonitoringConfig): RuntimeMetrics | null {
  if (!config.runtime) return null;
  const heartbeat = config.runtime.getHeartbeat();
  return {
    status: heartbeat.status,
    uptimeMs: heartbeat.uptimeMs,
    provider: heartbeat.provider,
    model: heartbeat.model,
    executionCount: heartbeat.executionCount,
    failureCount: heartbeat.failureCount,
    lastExecutionAt: heartbeat.lastExecutionAt,
  };
}

/** Direct transcription of Decision Intelligence's own per-(provider,model) aggregate — never
 *  re-accumulated here. Sorted by (provider, model) for deterministic report ordering. */
function buildDecisionIntelligenceMetrics(): DecisionModelMetric[] {
  const aggregates = getDecisionIntelligenceMetrics();
  return Object.entries(aggregates)
    .map(([key, agg]) => {
      const [provider, model] = splitProviderModelKey(key);
      return {
        provider,
        model,
        calls: agg.calls,
        failures: agg.failures,
        retries: agg.totalRetries,
        avgLatencyMs: agg.calls === 0 ? null : agg.totalProviderLatencyMs / agg.calls,
      };
    })
    .sort((a, b) => `${a.provider}:${a.model}`.localeCompare(`${b.provider}:${b.model}`));
}

/** Live-queries every registered protocol adapter's own `health()` — never assumed. A protocol
 *  whose `health()` call throws is reported `'UNAVAILABLE'` (a real HealthStatus value), never a
 *  fabricated status outside that enum. */
async function buildProtocolHealth(config: MonitoringConfig): Promise<ProtocolHealthEntry[] | null> {
  if (!config.registry) return null;
  const registry = config.registry;
  const metadataList = registry.list();
  return Promise.all(
    metadataList.map(async (metadata): Promise<ProtocolHealthEntry> => {
      try {
        const status = await registry.health(metadata.protocol);
        return { protocol: metadata.protocol, status };
      } catch {
        return { protocol: metadata.protocol, status: 'UNAVAILABLE' };
      }
    })
  );
}

/**
 * Builds one point-in-time MonitoringSnapshot. Every section is independently optional-safe:
 * omitting `runtime`/`registry` from `config` reports `null` for that section rather than
 * fabricating data for a component that was never wired in.
 */
export async function buildMonitoringSnapshot(config: MonitoringConfig = {}): Promise<MonitoringSnapshot> {
  const [processMetrics, protocolHealth] = await Promise.all([buildProcessMetrics(config), buildProtocolHealth(config)]);

  return {
    generatedAt: Date.now(),
    process: processMetrics,
    runtime: buildRuntimeMetrics(config),
    decisionIntelligence: buildDecisionIntelligenceMetrics(),
    protocolHealth,
  };
}
