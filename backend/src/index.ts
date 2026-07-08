import cors from 'cors';
import express from 'express';
import { agentsRouter } from './routes/agents.js';
import { strategiesRouter } from './routes/strategies.js';
import { authRouter } from './routes/auth.js';
import { positionsRouter, agentPositionsRouter } from './routes/positions.js';
import { auditRouter, agentAuditRouter } from './routes/audit.js';
import { statsRouter, agentStatsRouter } from './routes/stats.js';
import { autonomousRouter, autonomousAgentRouter } from './routes/autonomous.js';
import { tradesRouter } from './routes/trades.js';
import { smartWalletsRouter } from './routes/smartWallets.js';
import { agentContextRouter, contextMetricsRouter } from './routes/context.js';
import { createMonitoringRouter } from './routes/monitoring.js';
import { createDashboardRouter } from './routes/dashboard.js';
import { createBenchmarkRouter } from './routes/benchmark.js';
import { buildReportBundle } from './benchmarkReports/index.js';
import { createDevRouter } from './routes/dev.js';
import { requireAuth, requireDev } from './authMiddleware.js';
import { startScheduler } from './runner.js';
import { startContextMonitor } from './agentContext/monitor.js';
import { getPriceFeedService } from './priceFeed.js';
import { getAllowedOrigin, getPort } from './config.js';
import { reconcilePendingExecutions } from './executionJournal.js';
import { reconcilePendingProtocolExecutions } from './protocolExecutionJournal.js';

const app = express();
app.use(cors({ origin: getAllowedOrigin() }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));
// Fuller runtime monitoring snapshot (Phase 8) — public, read-only. No AutonomousRuntime/
// ProtocolRegistry is wired into this process yet, so `runtime`/`protocolHealth` report `null`;
// process/RAM and any recorded Decision Intelligence metrics still report real data.
app.use('/api/monitoring', createMonitoringRouter());
// Dashboard API (Phase 9) — status/health/metrics/lifecycle over the Autonomous Runtime, plus
// per-agent memory/learning/history reads. No AutonomousRuntime is wired into this process yet,
// so status/health/metrics report `null` and start/stop/pause/resume report 503.
app.use('/api/dashboard', createDashboardRouter());
// Benchmark API (Phase 10) — read-only latest/history/comparison/reports over Benchmark Core.
app.use('/api/benchmark', createBenchmarkRouter({ buildReportBundle }));
app.use('/api/auth', authRouter);
// Public — must be registered before the broad `/api` requireAuth mount below, otherwise that
// middleware runs first and 401s every unauthenticated strategies fetch (the frontend's
// listStrategies sends no bearer token).
app.use('/api/strategies', strategiesRouter);
// statsRouter's GET /agents/summary must be reachable before agentsRouter's GET /:id — otherwise
// that catch-all treats "summary" as an agent id and 404s (see agentStatsRouter/etc. below,
// which are safe since their patterns need an extra /:id/segment that "summary" alone can't match).
app.use('/api', requireAuth, statsRouter);
app.use('/api', requireAuth, contextMetricsRouter);
// Owner-scoped autonomous routes (/api/decisions, /api/portfolio). Registered before the broad
// nothing-else here needs it, but keep it above the catch-alls for clarity.
app.use('/api', requireAuth, autonomousRouter);
app.use('/api/agents', requireAuth, agentStatsRouter);
app.use('/api/agents', requireAuth, agentPositionsRouter);
app.use('/api/agents', requireAuth, agentAuditRouter);
// Autonomous agent-scoped routes (/provision, /:id/decisions, /:id/performance) must precede
// agentsRouter's GET /:id catch-all.
app.use('/api/agents', requireAuth, autonomousAgentRouter);
app.use('/api/agents', requireAuth, agentContextRouter);
app.use('/api/agents', requireAuth, agentsRouter);
app.use('/api/trades', requireAuth, tradesRouter);
app.use('/api/positions', requireAuth, positionsRouter);
app.use('/api/audit', requireAuth, auditRouter);
app.use('/api/smart-wallets', requireAuth, smartWalletsRouter);
// Hidden Developer Mode surface — requireDev 403s any caller not in DEV_ALLOWLIST (config.ts)
// before any handler in createDevRouter() runs. Empty allowlist by default (nobody has access).
app.use('/api/dev', requireAuth, requireDev, createDevRouter());

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  res.status(500).json({ error: message });
});

const port = getPort();
app.listen(port, () => {
  console.log(`kairos-agent-backend listening on :${port}`);
  // Recover any execution journal rows left mid-flight by a previous crash (verified against
  // Horizon — see executionJournal.ts) before the scheduler starts ticking agents against
  // potentially-stale positions.
  reconcilePendingExecutions()
    .then(({ recovered, markedFailed }) => {
      if (recovered > 0 || markedFailed > 0) {
        console.log(`[startup] execution journal reconciliation: recovered=${recovered} markedFailed=${markedFailed}`);
      }
    })
    .catch((error) => console.error('[startup] execution journal reconciliation failed:', error))
    .finally(() => {
      // Synchronous (SQLite-only, no Horizon lookups) — see protocolExecutionJournal.ts.
      try {
        const { recovered, markedFailed } = reconcilePendingProtocolExecutions();
        if (recovered > 0 || markedFailed > 0) {
          console.log(`[startup] protocol execution journal reconciliation: recovered=${recovered} markedFailed=${markedFailed}`);
        }
      } catch (error) {
        console.error('[startup] protocol execution journal reconciliation failed:', error);
      }
      startScheduler();
      getPriceFeedService().start();
      startContextMonitor();
    });
});
