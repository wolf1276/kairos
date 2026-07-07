// Dashboard API (Phase 9): thin HTTP surface over the existing, frozen Autonomous Runtime
// (Phase 11 lifecycle/health/metrics) and Memory/Learning Engines (Phase 9/10 analytics). This
// router contains NO reasoning/trading/analytics logic of its own — every field/action is a
// direct passthrough to an already-published function on those layers, never re-derived here.
// Deps are injected via `createDashboardRouter(config)`, same convention as `routes/monitoring.ts`
// — a deployment that hasn't wired up the Autonomous Runtime yet still gets a valid response
// with `status`/`health`/`metrics` reported as `null` rather than fabricated, and start/stop/
// pause/resume report 503 rather than pretending to control a runtime that doesn't exist.
import { Router } from 'express';
import { assembleMemoryPackage } from '../memoryLayer/orchestrator.js';
import { getEpisodicMemoryProvider } from '../memoryLayer/providers/index.js';
import { computeLearningSnapshot, LearningSnapshotValidationError } from '../reasoning/learningEngine/index.js';
import { InvalidStateTransitionError, type AutonomousRuntime } from '../runtime/autonomousRuntime/index.js';

export interface DashboardConfig {
  /** Autonomous Runtime instance to report status/health/metrics from and control via
   *  start/stop/pause/resume — omitted when no runtime is wired up yet. */
  runtime?: AutonomousRuntime;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireAgentId(req: { query: Record<string, unknown> }, res: { status: (code: number) => { json: (body: unknown) => void } }): string | null {
  const agentId = req.query.agentId;
  if (typeof agentId !== 'string' || agentId.length === 0) {
    res.status(400).json({ success: false, error: 'agentId query parameter is required' });
    return null;
  }
  return agentId;
}

export function createDashboardRouter(config: DashboardConfig = {}): Router {
  const router = Router();
  const { runtime } = config;

  router.get('/status', (_req, res) => {
    res.json({ success: true, status: runtime ? runtime.getState() : null });
  });

  router.get('/health', async (_req, res) => {
    if (!runtime) {
      res.json({ success: true, health: null });
      return;
    }
    res.json({ success: true, health: await runtime.getHealth() });
  });

  router.get('/metrics', (_req, res) => {
    res.json({ success: true, metrics: runtime ? runtime.getHeartbeat() : null });
  });

  router.get('/memory', async (req, res) => {
    const agentId = requireAgentId(req, res);
    if (agentId === null) return;
    try {
      const memory = await assembleMemoryPackage(agentId);
      res.json({ success: true, memory });
    } catch (error) {
      res.status(500).json({ success: false, error: errorMessage(error) });
    }
  });

  router.get('/learning', async (req, res) => {
    const agentId = requireAgentId(req, res);
    if (agentId === null) return;
    try {
      const memoryPackage = await assembleMemoryPackage(agentId);
      const learning = computeLearningSnapshot(memoryPackage);
      res.json({ success: true, learning });
    } catch (error) {
      const status = error instanceof LearningSnapshotValidationError ? 422 : 500;
      res.status(status).json({ success: false, error: errorMessage(error) });
    }
  });

  router.get('/history', async (req, res) => {
    const agentId = requireAgentId(req, res);
    if (agentId === null) return;
    try {
      const history = await getEpisodicMemoryProvider().list(agentId);
      res.json({ success: true, history });
    } catch (error) {
      res.status(500).json({ success: false, error: errorMessage(error) });
    }
  });

  router.post('/start', async (_req, res) => {
    if (!runtime) {
      res.status(503).json({ success: false, error: 'runtime not wired up' });
      return;
    }
    try {
      await runtime.start();
      res.json({ success: true, status: runtime.getState() });
    } catch (error) {
      const status = error instanceof InvalidStateTransitionError ? 409 : 500;
      res.status(status).json({ success: false, error: errorMessage(error) });
    }
  });

  router.post('/stop', async (_req, res) => {
    if (!runtime) {
      res.status(503).json({ success: false, error: 'runtime not wired up' });
      return;
    }
    try {
      await runtime.stop();
      res.json({ success: true, status: runtime.getState() });
    } catch (error) {
      const status = error instanceof InvalidStateTransitionError ? 409 : 500;
      res.status(status).json({ success: false, error: errorMessage(error) });
    }
  });

  router.post('/pause', (_req, res) => {
    if (!runtime) {
      res.status(503).json({ success: false, error: 'runtime not wired up' });
      return;
    }
    try {
      runtime.pause();
      res.json({ success: true, status: runtime.getState() });
    } catch (error) {
      const status = error instanceof InvalidStateTransitionError ? 409 : 500;
      res.status(status).json({ success: false, error: errorMessage(error) });
    }
  });

  router.post('/resume', (_req, res) => {
    if (!runtime) {
      res.status(503).json({ success: false, error: 'runtime not wired up' });
      return;
    }
    try {
      runtime.resume();
      res.json({ success: true, status: runtime.getState() });
    } catch (error) {
      const status = error instanceof InvalidStateTransitionError ? 409 : 500;
      res.status(status).json({ success: false, error: errorMessage(error) });
    }
  });

  return router;
}
