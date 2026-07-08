// Benchmark API (Phase 10) — exercises createBenchmarkRouter() over a real ephemeral HTTP server
// (same pattern as dashboard.test.ts/monitoring.test.ts), against a real InMemoryBenchmarkStore.
// This phase adds a read-only HTTP surface only — no engine changes.
import express from 'express';
import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBenchmarkRouter } from '../routes/benchmark.js';
import { InMemoryBenchmarkStore } from '../benchmarkCore/store.js';
import { BenchmarkSession } from '../benchmarkCore/session.js';
import { buildBenchmarkReportBundle } from '../benchmarkReports/index.js';
import { computeTradingMetrics } from '../benchmarkCore/tradingMetrics.js';
import { buildStrategyRanking } from '../strategyEngine/analytics.js';
import { computePipelineLatencyReport } from '../runtimeAnalytics/analytics.js';
import { buildMemoryAnalyticsReport } from '../memoryLayer/analytics.js';
import { buildLearningTrendReport } from '../learningAnalytics/analytics.js';
import { computeReliabilityReport } from '../reliabilityAnalytics/analytics.js';
import type { BenchmarkExecutionRecord } from '../benchmarkCore/types.js';
import type { BenchmarkReportBundle } from '../benchmarkReports/types.js';

let server: Server;
let baseUrl: string;
let store: InMemoryBenchmarkStore;

function trivialBundle(sessionId: string, records: BenchmarkExecutionRecord[]): BenchmarkReportBundle | null {
  if (records.length === 0) return null;
  return buildBenchmarkReportBundle({
    generatedAt: 1700000000000,
    sessionId,
    trading: computeTradingMetrics(records),
    strategy: buildStrategyRanking([], ['meanReversion']),
    runtime: computePipelineLatencyReport([]),
    memory: buildMemoryAnalyticsReport({ episodic: [], semantic: [], working: [], now: 1700000000000 }),
    learning: buildLearningTrendReport([]),
    reliability: computeReliabilityReport([], 10),
  });
}

beforeEach(async () => {
  store = new InMemoryBenchmarkStore();
  const session = new BenchmarkSession('session-1', store);
  session.record({ pipelineDurationMs: 100, stageDurations: {}, provider: 'p', model: 'm', timestamp: 1 });
  session.record({ pipelineDurationMs: 200, stageDurations: {}, provider: 'p', model: 'm', timestamp: 2 });
  const other = new BenchmarkSession('session-2', store);
  other.record({ pipelineDurationMs: 50, stageDurations: {}, provider: 'p', model: 'm', timestamp: 3 });

  const app = express();
  app.use('/api/benchmark', createBenchmarkRouter({ store, buildReportBundle: trivialBundle }));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('GET /api/benchmark/sessions', () => {
  it('lists every session with counts, sorted by most recent', async () => {
    const body = await (await fetch(`${baseUrl}/api/benchmark/sessions`)).json();
    expect(body.success).toBe(true);
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions[0].sessionId).toBe('session-2');
    expect(body.sessions[1].executionCount).toBe(2);
  });
});

describe('GET /api/benchmark/latest', () => {
  it('returns the most recent session plus its trading metrics', async () => {
    const body = await (await fetch(`${baseUrl}/api/benchmark/latest`)).json();
    expect(body.success).toBe(true);
    expect(body.session.sessionId).toBe('session-2');
    expect(body.trading.tradeCount).toBe(0);
  });
});

describe('GET /api/benchmark/history', () => {
  it('returns raw executions and trading metrics for a session', async () => {
    const body = await (await fetch(`${baseUrl}/api/benchmark/history?sessionId=session-1`)).json();
    expect(body.success).toBe(true);
    expect(body.executions).toHaveLength(2);
    expect(body.sessionId).toBe('session-1');
  });

  it('falls back to session list when no sessionId is given', async () => {
    const body = await (await fetch(`${baseUrl}/api/benchmark/history`)).json();
    expect(body.success).toBe(true);
    expect(body.sessions).toHaveLength(2);
  });
});

describe('GET /api/benchmark/reports', () => {
  it('requires sessionId', async () => {
    const res = await fetch(`${baseUrl}/api/benchmark/reports`);
    expect(res.status).toBe(400);
  });

  it('returns a full report bundle when configured', async () => {
    const body = await (await fetch(`${baseUrl}/api/benchmark/reports?sessionId=session-1`)).json();
    expect(body.success).toBe(true);
    expect(body.report.sessionId).toBe('session-1');
    expect(body.report.trading.tradeCount).toBe(0);
  });

  it('404s for a session with no data', async () => {
    const res = await fetch(`${baseUrl}/api/benchmark/reports?sessionId=nope`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/benchmark/compare', () => {
  it('returns a comparison report between two sessions', async () => {
    const body = await (
      await fetch(`${baseUrl}/api/benchmark/compare?baselineSessionId=session-1&currentSessionId=session-2`)
    ).json();
    expect(body.success).toBe(true);
    expect(body.comparison.baselineSessionId).toBe('session-1');
    expect(body.comparison.currentSessionId).toBe('session-2');
    expect(typeof body.comparison.improvementScore).toBe('number');
  });

  it('400s when a session id is missing', async () => {
    const res = await fetch(`${baseUrl}/api/benchmark/compare?baselineSessionId=session-1`);
    expect(res.status).toBe(400);
  });
});

describe('without buildReportBundle configured', () => {
  it('503s /reports and /compare', async () => {
    const app = express();
    app.use('/api/benchmark', createBenchmarkRouter({ store }));
    const s = await new Promise<Server>((resolve) => {
      const inst = app.listen(0, () => resolve(inst));
    });
    const address = s.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const url = `http://127.0.0.1:${port}`;
    const reportsRes = await fetch(`${url}/api/benchmark/reports?sessionId=session-1`);
    expect(reportsRes.status).toBe(503);
    const compareRes = await fetch(`${url}/api/benchmark/compare?baselineSessionId=session-1&currentSessionId=session-2`);
    expect(compareRes.status).toBe(503);
    await new Promise((resolve) => s.close(resolve));
  });
});
