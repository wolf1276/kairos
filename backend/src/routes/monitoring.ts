// Health API for Runtime Monitoring (Phase 8). Public, read-only, no auth required — same
// convention as the existing bare `/health` liveness check in index.ts, just with the fuller
// uptime/provider/model/GPU/RAM/latency/retries/failures/protocol-health snapshot. Deps
// (AutonomousRuntime/ProtocolRegistry) are injected via `createMonitoringRouter(config)` so this
// router never reaches for a hidden singleton — a deployment that hasn't wired up the Phase 11
// runtime or a ProtocolRegistry yet still gets a valid response with `runtime`/`protocolHealth`
// reported as `null` rather than fabricated.
import { Router } from 'express';
import { buildMonitoringSnapshot } from '../monitoring/index.js';
import type { MonitoringConfig } from '../monitoring/index.js';

export function createMonitoringRouter(config: MonitoringConfig = {}): Router {
  const router = Router();

  router.get('/health', async (_req, res) => {
    try {
      const monitoring = await buildMonitoringSnapshot(config);
      res.json({ success: true, monitoring });
    } catch (error) {
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
