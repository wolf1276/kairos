// Dashboard API (Phase 9) — exhaustive test suite. Exercises createDashboardRouter() end-to-end
// over a real ephemeral HTTP server (same pattern as monitoring.test.ts), against a real (not
// mocked) AutonomousRuntime and the real Memory/Learning Engine providers — this phase adds an
// HTTP surface only, no engine changes.
import express from 'express';
import type { Server } from 'http';
import { createHash } from 'crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDashboardRouter } from '../routes/dashboard.js';
import { AutonomousRuntime } from '../runtime/autonomousRuntime/index.js';
import type { PipelineRunner } from '../runtime/autonomousRuntime/index.js';
import { writeMemory } from '../reasoning/memoryWriter/index.js';
import type { OutcomeRecordInput } from '../reasoning/memoryWriter/types.js';
import { resetAllMemoryProviders } from '../memoryLayer/providers/index.js';

function hex64(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

function makeOutcomeRecord(overrides: Partial<OutcomeRecordInput> = {}): OutcomeRecordInput {
  const base: OutcomeRecordInput = {
    outcomeId: 'outcome-1',
    outcomeHash: hex64('outcome-1'),
    executionId: 'execution-1',
    executionHash: hex64('execution-1'),
    protocol: 'soroswap',
    action: 'SWAP',
    assets: ['XLM', 'USDC'],
    transactionHash: hex64('tx-1'),
    transactionXDRHash: hex64('xdr-1'),
    executionStatus: 'success',
    dataSource: 'synthetic',
    amountRequested: '100',
    amountExecuted: '99.5',
    fees: '0.01',
    slippage: 0.1,
    priceImpact: 0.05,
    balancesBefore: [{ asset: 'XLM', amount: '1000' }, { asset: 'USDC', amount: '50' }],
    balancesAfter: [{ asset: 'XLM', amount: '900' }, { asset: 'USDC', amount: '149.5' }],
    verificationHash: hex64('verification-1'),
    routeHash: hex64('route-1'),
    contextHash: hex64('context-1'),
    memoryHash: hex64('memory-1'),
    failureReason: null,
    retryCount: 0,
  };
  return { ...base, ...overrides };
}

function okRunner(): PipelineRunner {
  return { runPipeline: async () => ({ success: true }) };
}

let server: Server;
let baseUrl: string;

async function startApp(runtime?: AutonomousRuntime): Promise<void> {
  const app = express();
  app.use('/api/dashboard', createDashboardRouter({ getRuntime: () => runtime ?? null }));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const port = (server.address() as { port: number }).port;
  baseUrl = `http://127.0.0.1:${port}`;
}

afterEach(() => {
  server?.close();
});

describe('Dashboard API — runtime not wired', () => {
  beforeEach(async () => {
    await startApp(undefined);
  });

  it('reports status/health/metrics as null', async () => {
    const status = await (await fetch(`${baseUrl}/api/dashboard/status`)).json();
    expect(status).toEqual({ success: true, status: null });

    const health = await (await fetch(`${baseUrl}/api/dashboard/health`)).json();
    expect(health).toEqual({ success: true, health: null });

    const metrics = await (await fetch(`${baseUrl}/api/dashboard/metrics`)).json();
    expect(metrics).toEqual({ success: true, metrics: null });
  });

  it('returns 503 for start/stop/pause/resume', async () => {
    for (const action of ['start', 'stop', 'pause', 'resume']) {
      const res = await fetch(`${baseUrl}/api/dashboard/${action}`, { method: 'POST' });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.success).toBe(false);
    }
  });
});

describe('Dashboard API — runtime wired', () => {
  let runtime: AutonomousRuntime;

  beforeEach(async () => {
    runtime = new AutonomousRuntime({ pipelineRunner: okRunner(), intervalMs: 60_000, providerName: 'openai', model: 'gpt-4' });
    await startApp(runtime);
  });

  afterEach(async () => {
    await runtime.stop();
  });

  it('GET /status reflects the live runtime state', async () => {
    let body = await (await fetch(`${baseUrl}/api/dashboard/status`)).json();
    expect(body).toEqual({ success: true, status: 'STOPPED' });

    await fetch(`${baseUrl}/api/dashboard/start`, { method: 'POST' });
    body = await (await fetch(`${baseUrl}/api/dashboard/status`)).json();
    expect(body).toEqual({ success: true, status: 'RUNNING' });
  });

  it('GET /health reports a real HealthReport', async () => {
    const body = await (await fetch(`${baseUrl}/api/dashboard/health`)).json();
    expect(body.success).toBe(true);
    expect(body.health).toMatchObject({ runtime: 'degraded', scheduler: 'ok', pipelineRunner: 'ok', provider: 'ok' });
  });

  it('GET /metrics reports a real Heartbeat', async () => {
    const body = await (await fetch(`${baseUrl}/api/dashboard/metrics`)).json();
    expect(body.success).toBe(true);
    expect(body.metrics).toMatchObject({ status: 'STOPPED', provider: 'openai', model: 'gpt-4', executionCount: 0, failureCount: 0 });
  });

  it('POST /start transitions STOPPED -> RUNNING', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/start`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, status: 'RUNNING' });
    expect(runtime.getState()).toBe('RUNNING');
  });

  it('POST /pause then /resume round-trips RUNNING -> PAUSED -> RUNNING', async () => {
    await fetch(`${baseUrl}/api/dashboard/start`, { method: 'POST' });
    const paused = await (await fetch(`${baseUrl}/api/dashboard/pause`, { method: 'POST' })).json();
    expect(paused).toEqual({ success: true, status: 'PAUSED' });
    const resumed = await (await fetch(`${baseUrl}/api/dashboard/resume`, { method: 'POST' })).json();
    expect(resumed).toEqual({ success: true, status: 'RUNNING' });
  });

  it('POST /stop transitions RUNNING -> STOPPED', async () => {
    await fetch(`${baseUrl}/api/dashboard/start`, { method: 'POST' });
    const body = await (await fetch(`${baseUrl}/api/dashboard/stop`, { method: 'POST' })).json();
    expect(body).toEqual({ success: true, status: 'STOPPED' });
  });

  it('POST /pause on a STOPPED runtime returns 409', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/pause`, { method: 'POST' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('POST /resume on a STOPPED runtime returns 409', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/resume`, { method: 'POST' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});

describe('Dashboard API — memory/learning/history', () => {
  beforeEach(async () => {
    resetAllMemoryProviders();
    await startApp(undefined);
  });

  afterEach(() => {
    resetAllMemoryProviders();
  });

  it('requires an agentId query parameter', async () => {
    for (const path of ['/memory', '/learning', '/history']) {
      const res = await fetch(`${baseUrl}/api/dashboard${path}`);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
    }
  });

  it('GET /memory returns an assembled MemoryPackage for the agent', async () => {
    await writeMemory(makeOutcomeRecord(), { agentId: 'agent-1', timestamp: 1_700_000_000_000, writeId: 'write-1' });

    const res = await fetch(`${baseUrl}/api/dashboard/memory?agentId=agent-1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.memory.meta.agentId).toBe('agent-1');
    expect(body.memory.episodic).toHaveLength(1);
  });

  it('GET /history returns the agent episodic records', async () => {
    await writeMemory(makeOutcomeRecord(), { agentId: 'agent-1', timestamp: 1_700_000_000_000, writeId: 'write-1' });

    const res = await fetch(`${baseUrl}/api/dashboard/history?agentId=agent-1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.history).toHaveLength(1);
    expect(body.history[0].outcome).toBe('win');
  });

  it('GET /history returns an empty array for an agent with no memory', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/history?agentId=agent-unknown`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.history).toEqual([]);
  });

  it('GET /learning returns a computed LearningSnapshot for the agent', async () => {
    await writeMemory(makeOutcomeRecord(), { agentId: 'agent-1', timestamp: 1_700_000_000_000, writeId: 'write-1' });

    const res = await fetch(`${baseUrl}/api/dashboard/learning?agentId=agent-1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.learning.protocolStats).toEqual(
      expect.arrayContaining([expect.objectContaining({ protocol: 'soroswap', usageCount: 1 })]),
    );
  });
});
