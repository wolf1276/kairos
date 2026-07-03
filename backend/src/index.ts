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
import { requireAuth } from './authMiddleware.js';
import { startScheduler } from './runner.js';
import { getPriceFeedService } from './priceFeed.js';
import { getAllowedOrigin, getPort } from './config.js';

const app = express();
app.use(cors({ origin: getAllowedOrigin() }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
// Public — must be registered before the broad `/api` requireAuth mount below, otherwise that
// middleware runs first and 401s every unauthenticated strategies fetch (the frontend's
// listStrategies sends no bearer token).
app.use('/api/strategies', strategiesRouter);
// statsRouter's GET /agents/summary must be reachable before agentsRouter's GET /:id — otherwise
// that catch-all treats "summary" as an agent id and 404s (see agentStatsRouter/etc. below,
// which are safe since their patterns need an extra /:id/segment that "summary" alone can't match).
app.use('/api', requireAuth, statsRouter);
// Owner-scoped autonomous routes (/api/decisions, /api/portfolio). Registered before the broad
// nothing-else here needs it, but keep it above the catch-alls for clarity.
app.use('/api', requireAuth, autonomousRouter);
app.use('/api/agents', requireAuth, agentStatsRouter);
app.use('/api/agents', requireAuth, agentPositionsRouter);
app.use('/api/agents', requireAuth, agentAuditRouter);
// Autonomous agent-scoped routes (/provision, /:id/decisions, /:id/performance) must precede
// agentsRouter's GET /:id catch-all.
app.use('/api/agents', requireAuth, autonomousAgentRouter);
app.use('/api/agents', requireAuth, agentsRouter);
app.use('/api/trades', requireAuth, tradesRouter);
app.use('/api/positions', requireAuth, positionsRouter);
app.use('/api/audit', requireAuth, auditRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  res.status(500).json({ error: message });
});

const port = getPort();
app.listen(port, () => {
  console.log(`kairos-agent-backend listening on :${port}`);
  startScheduler();
  getPriceFeedService().start();
});
