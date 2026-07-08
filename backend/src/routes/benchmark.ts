// Benchmark API (Phase 10): thin, read-only HTTP surface over Benchmark Core (Phase 1) and its
// downstream analytics (Trading Metrics Phase 2, Benchmark Reports Phase 8, Benchmark Comparison
// Phase 9). This router computes no metric of its own — trading metrics come from
// `computeTradingMetrics`, full reports/comparisons come from an injected `buildReportBundle`
// (same "config injection" convention as `routes/dashboard.ts` / `routes/monitoring.ts`), since
// assembling a full six-report bundle needs strategy/runtime/memory/learning/reliability data
// that Benchmark Core's raw execution records don't carry a ready-made assembler for yet. No
// engine is called or mutated — every handler here only reads from the BenchmarkStore.
import { Router } from 'express';
import { SqliteBenchmarkStore } from '../benchmarkCore/store.js';
import { computeTradingMetrics } from '../benchmarkCore/tradingMetrics.js';
import { compareBenchmarkSessions } from '../benchmarkComparison/index.js';
import type { BenchmarkStore, BenchmarkExecutionRecord } from '../benchmarkCore/types.js';
import type { BenchmarkReportBundle } from '../benchmarkReports/types.js';

export interface BenchmarkApiConfig {
  /** Defaults to a fresh `SqliteBenchmarkStore` (the same DB file Benchmark Core writes to). */
  store?: BenchmarkStore;
  /** Builds a full six-report bundle for one session, or `null` if that session has no data.
   *  Left unconfigured, `/reports` and `/compare` report 503 rather than a partial/fabricated
   *  bundle — assembling strategy/runtime/memory/learning/reliability inputs from raw execution
   *  records is a deployment-specific concern (which fields each engine stashed in `decision`,
   *  `outcome`, `learningSnapshot`, etc.), not something this read-only router should guess at. */
  buildReportBundle?: (sessionId: string, records: BenchmarkExecutionRecord[]) => BenchmarkReportBundle | null;
}

interface SessionSummary {
  sessionId: string;
  executionCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
}

function summarizeSessions(records: BenchmarkExecutionRecord[]): SessionSummary[] {
  const bySession = new Map<string, BenchmarkExecutionRecord[]>();
  for (const r of records) {
    const list = bySession.get(r.sessionId) ?? [];
    list.push(r);
    bySession.set(r.sessionId, list);
  }
  return [...bySession.entries()]
    .map(([sessionId, recs]) => ({
      sessionId,
      executionCount: recs.length,
      firstTimestamp: Math.min(...recs.map((r) => r.timestamp)),
      lastTimestamp: Math.max(...recs.map((r) => r.timestamp)),
    }))
    .sort((a, b) => b.lastTimestamp - a.lastTimestamp);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createBenchmarkRouter(config: BenchmarkApiConfig = {}): Router {
  const router = Router();
  const store = config.store ?? new SqliteBenchmarkStore();
  const { buildReportBundle } = config;

  router.get('/sessions', (_req, res) => {
    try {
      res.json({ success: true, sessions: summarizeSessions(store.listAll()) });
    } catch (error) {
      res.status(500).json({ success: false, error: errorMessage(error) });
    }
  });

  router.get('/latest', (_req, res) => {
    try {
      const sessions = summarizeSessions(store.listAll());
      if (sessions.length === 0) {
        res.json({ success: true, session: null });
        return;
      }
      const latest = sessions[0];
      const records = store.listBySession(latest.sessionId);
      res.json({ success: true, session: latest, trading: computeTradingMetrics(records) });
    } catch (error) {
      res.status(500).json({ success: false, error: errorMessage(error) });
    }
  });

  router.get('/history', (req, res) => {
    try {
      const sessionId = req.query.sessionId;
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        res.json({ success: true, sessions: summarizeSessions(store.listAll()) });
        return;
      }
      const records = store.listBySession(sessionId);
      res.json({ success: true, sessionId, executions: records, trading: computeTradingMetrics(records) });
    } catch (error) {
      res.status(500).json({ success: false, error: errorMessage(error) });
    }
  });

  router.get('/reports', (req, res) => {
    try {
      const sessionId = req.query.sessionId;
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        res.status(400).json({ success: false, error: 'sessionId query parameter is required' });
        return;
      }
      if (!buildReportBundle) {
        res.status(503).json({ success: false, error: 'report bundling is not configured for this deployment' });
        return;
      }
      const records = store.listBySession(sessionId);
      const bundle = buildReportBundle(sessionId, records);
      if (!bundle) {
        res.status(404).json({ success: false, error: `no data for session ${sessionId}` });
        return;
      }
      res.json({ success: true, report: bundle });
    } catch (error) {
      res.status(500).json({ success: false, error: errorMessage(error) });
    }
  });

  router.get('/compare', (req, res) => {
    try {
      const baselineSessionId = req.query.baselineSessionId;
      const currentSessionId = req.query.currentSessionId;
      if (typeof baselineSessionId !== 'string' || baselineSessionId.length === 0 ||
          typeof currentSessionId !== 'string' || currentSessionId.length === 0) {
        res.status(400).json({ success: false, error: 'baselineSessionId and currentSessionId query parameters are required' });
        return;
      }
      if (!buildReportBundle) {
        res.status(503).json({ success: false, error: 'report bundling is not configured for this deployment' });
        return;
      }
      const baseline = buildReportBundle(baselineSessionId, store.listBySession(baselineSessionId));
      const current = buildReportBundle(currentSessionId, store.listBySession(currentSessionId));
      if (!baseline || !current) {
        res.status(404).json({ success: false, error: 'no data for one or both sessions' });
        return;
      }
      const comparison = compareBenchmarkSessions({ generatedAt: Date.now(), baseline, current });
      res.json({ success: true, comparison });
    } catch (error) {
      res.status(500).json({ success: false, error: errorMessage(error) });
    }
  });

  return router;
}
