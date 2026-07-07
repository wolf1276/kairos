// Runtime Monitoring (Phase 8) — exhaustive test suite. Exercises buildMonitoringSnapshot()
// against real (not mocked) AutonomousRuntime/ProtocolRegistry/DecisionIntelligence-metrics
// instances — this phase adds monitoring only, no engine changes, so the components it observes
// are used exactly as published. The health API route is exercised end-to-end over a real
// ephemeral HTTP server.
import express from 'express';
import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMonitoringSnapshot } from '../monitoring/index.js';
import { createMonitoringRouter } from '../routes/monitoring.js';
import { AutonomousRuntime } from '../runtime/autonomousRuntime/index.js';
import { ProtocolRegistry } from '../protocolAdapters/registry.js';
import type { ProtocolAdapter } from '../protocolAdapters/adapter.js';
import type { ProtocolCapabilities, HealthStatus } from '../protocolAdapters/types.js';
import { recordDecisionIntelligenceCall, resetDecisionIntelligenceMetrics } from '../reasoning/decisionIntelligence/metrics.js';

function fakeAdapter(protocol: string, health: () => Promise<HealthStatus>): ProtocolAdapter {
  const capabilities: ProtocolCapabilities = {
    protocol,
    supportedActions: ['swap'],
    supportedAssets: ['XLM'],
    supportedNetworks: ['testnet'],
    simulationSupport: true,
    batchingSupport: false,
    rollbackSupport: false,
  };
  return {
    protocol,
    version: '1.0.0',
    initialize: async () => {},
    health,
    capabilities: () => capabilities,
    simulate: async () => ({ success: true, estimatedFees: '0', estimatedSlippagePct: 0, warnings: [], errors: [], estimatedOutputs: {}, simulationHash: 'h' }),
    validate: async () => ({ ok: true, errors: [] }),
    execute: async () => ({ status: 'success', txHash: null, fees: '0', durationMs: 1, metadata: {} }),
    estimateFees: async () => '0',
    estimateSlippage: async () => 0,
  };
}

beforeEach(() => {
  resetDecisionIntelligenceMetrics();
});

describe('buildMonitoringSnapshot — process metrics', () => {
  it('always reports real, non-negative uptime and RAM figures', async () => {
    const snapshot = await buildMonitoringSnapshot();
    expect(snapshot.process.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.process.ramTotalBytes).toBeGreaterThan(0);
    expect(snapshot.process.ramFreeBytes).toBeGreaterThanOrEqual(0);
    expect(snapshot.process.ramUsedBytes).toBe(snapshot.process.ramTotalBytes - snapshot.process.ramFreeBytes);
    expect(snapshot.process.rssBytes).toBeGreaterThan(0);
    expect(snapshot.process.heapUsedBytes).toBeGreaterThan(0);
  });

  it('reports gpu as null when no gpuProvider is injected — never fabricated', async () => {
    const snapshot = await buildMonitoringSnapshot();
    expect(snapshot.process.gpu).toBeNull();
  });

  it('reports the injected gpuProvider output verbatim', async () => {
    const snapshot = await buildMonitoringSnapshot({ gpuProvider: () => ({ name: 'Test GPU', utilizationPct: 42 }) });
    expect(snapshot.process.gpu).toEqual({ name: 'Test GPU', utilizationPct: 42 });
  });

  it('awaits an async gpuProvider', async () => {
    const snapshot = await buildMonitoringSnapshot({ gpuProvider: async () => ({ name: 'Async GPU' }) });
    expect(snapshot.process.gpu).toEqual({ name: 'Async GPU' });
  });
});

describe('buildMonitoringSnapshot — runtime metrics', () => {
  it('reports null when no AutonomousRuntime is supplied', async () => {
    const snapshot = await buildMonitoringSnapshot();
    expect(snapshot.runtime).toBeNull();
  });

  it('reports uptime, provider, model, executionCount, failureCount from a real AutonomousRuntime', async () => {
    const runtime = new AutonomousRuntime({
      pipelineRunner: { runPipeline: async () => ({ success: true }) },
      intervalMs: 1_000_000,
      providerName: 'openai',
      model: 'gpt-x',
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    await runtime.start();

    const snapshot = await buildMonitoringSnapshot({ runtime });
    expect(snapshot.runtime).not.toBeNull();
    expect(snapshot.runtime!.status).toBe('RUNNING');
    expect(snapshot.runtime!.provider).toBe('openai');
    expect(snapshot.runtime!.model).toBe('gpt-x');
    expect(snapshot.runtime!.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.runtime!.executionCount).toBe(0);
    expect(snapshot.runtime!.failureCount).toBe(0);

    await runtime.stop();
  });

  it('reflects failureCount from a runtime whose pipeline fails', async () => {
    const runtime = new AutonomousRuntime({
      pipelineRunner: { runPipeline: async () => ({ success: false, error: 'boom' }) },
      intervalMs: 5,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    await runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 40));
    await runtime.stop();

    const snapshot = await buildMonitoringSnapshot({ runtime });
    expect(snapshot.runtime!.failureCount).toBeGreaterThan(0);
    expect(snapshot.runtime!.executionCount).toBeGreaterThan(0);
  });
});

describe('buildMonitoringSnapshot — decision intelligence metrics (latency/retries/failures)', () => {
  it('is empty when no calls have been recorded', async () => {
    const snapshot = await buildMonitoringSnapshot();
    expect(snapshot.decisionIntelligence).toEqual([]);
  });

  it('reports calls/failures/retries/avgLatencyMs per (provider, model), directly transcribed from the real metrics aggregate', async () => {
    recordDecisionIntelligenceCall({
      provider: 'openai', model: 'gpt-x', reasoningDurationMs: 10, validationDurationMs: 1, confidence: 0.8,
      alternativeCount: 0, evidenceCount: 0, uncertaintyScore: 0, promptTokens: 1, completionTokens: 1, totalTokens: 2,
      providerLatencyMs: 100, retryCount: 1, failed: false,
    });
    recordDecisionIntelligenceCall({
      provider: 'openai', model: 'gpt-x', reasoningDurationMs: 10, validationDurationMs: 1, confidence: 0,
      alternativeCount: 0, evidenceCount: 0, uncertaintyScore: 0, promptTokens: 1, completionTokens: 1, totalTokens: 2,
      providerLatencyMs: 200, retryCount: 2, failed: true, errorKind: 'timeout',
    });

    const snapshot = await buildMonitoringSnapshot();
    expect(snapshot.decisionIntelligence).toEqual([
      { provider: 'openai', model: 'gpt-x', calls: 2, failures: 1, retries: 3, avgLatencyMs: 150 },
    ]);
  });

  it('keeps distinct (provider, model) pairs fully isolated and sorted', async () => {
    recordDecisionIntelligenceCall({
      provider: 'anthropic', model: 'claude-x', reasoningDurationMs: 1, validationDurationMs: 1, confidence: 1,
      alternativeCount: 0, evidenceCount: 0, uncertaintyScore: 0, promptTokens: 1, completionTokens: 1, totalTokens: 2,
      providerLatencyMs: 5, retryCount: 0, failed: false,
    });
    recordDecisionIntelligenceCall({
      provider: 'openai', model: 'gpt-x', reasoningDurationMs: 1, validationDurationMs: 1, confidence: 1,
      alternativeCount: 0, evidenceCount: 0, uncertaintyScore: 0, promptTokens: 1, completionTokens: 1, totalTokens: 2,
      providerLatencyMs: 5, retryCount: 0, failed: false,
    });

    const snapshot = await buildMonitoringSnapshot();
    expect(snapshot.decisionIntelligence.map((d) => `${d.provider}:${d.model}`)).toEqual(['anthropic:claude-x', 'openai:gpt-x']);
  });
});

describe('buildMonitoringSnapshot — protocol health', () => {
  it('reports null when no registry is supplied', async () => {
    const snapshot = await buildMonitoringSnapshot();
    expect(snapshot.protocolHealth).toBeNull();
  });

  it('live-queries every registered adapter\'s own health(), including a healthy and an unhealthy one', async () => {
    const registry = new ProtocolRegistry();
    registry.register(fakeAdapter('soroswap', async () => 'READY'));
    registry.register(fakeAdapter('blend', async () => 'DEGRADED'));

    const snapshot = await buildMonitoringSnapshot({ registry });
    expect(snapshot.protocolHealth).toEqual([
      { protocol: 'blend', status: 'DEGRADED' },
      { protocol: 'soroswap', status: 'READY' },
    ]);
  });

  it('reports UNAVAILABLE (never a fabricated status) when an adapter\'s health() throws', async () => {
    const registry = new ProtocolRegistry();
    registry.register(
      fakeAdapter('phoenix', async () => {
        throw new Error('rpc down');
      })
    );

    const snapshot = await buildMonitoringSnapshot({ registry });
    expect(snapshot.protocolHealth).toEqual([{ protocol: 'phoenix', status: 'UNAVAILABLE' }]);
  });
});

describe('health API route', () => {
  let server: Server;
  let baseUrl: string;

  afterEach(() => {
    server?.close();
  });

  it('GET /health returns a full monitoring snapshot over real HTTP', async () => {
    const app = express();
    app.use('/api/monitoring', createMonitoringRouter());
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const port = (server.address() as { port: number }).port;
    baseUrl = `http://127.0.0.1:${port}`;

    const response = await fetch(`${baseUrl}/api/monitoring/health`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.monitoring.process.ramTotalBytes).toBeGreaterThan(0);
    expect(body.monitoring.runtime).toBeNull();
    expect(body.monitoring.protocolHealth).toBeNull();
    expect(Array.isArray(body.monitoring.decisionIntelligence)).toBe(true);
  });

  it('threads an injected AutonomousRuntime + ProtocolRegistry through to the HTTP response', async () => {
    const runtime = new AutonomousRuntime({
      pipelineRunner: { runPipeline: async () => ({ success: true }) },
      intervalMs: 1_000_000,
      providerName: 'openai',
      model: 'gpt-x',
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    await runtime.start();

    const registry = new ProtocolRegistry();
    registry.register(fakeAdapter('soroswap', async () => 'READY'));

    const app = express();
    app.use('/api/monitoring', createMonitoringRouter({ runtime, registry }));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const port = (server.address() as { port: number }).port;
    baseUrl = `http://127.0.0.1:${port}`;

    const response = await fetch(`${baseUrl}/api/monitoring/health`);
    const body = await response.json();
    expect(body.monitoring.runtime.status).toBe('RUNNING');
    expect(body.monitoring.runtime.provider).toBe('openai');
    expect(body.monitoring.protocolHealth).toEqual([{ protocol: 'soroswap', status: 'READY' }]);

    await runtime.stop();
  });
});
