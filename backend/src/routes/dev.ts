// Developer Mode API (hidden feature). Thin, read-mostly HTTP surface reusing existing engines —
// this router contains no reasoning/trading/analytics logic of its own. Every handler here is a
// passthrough to an already-published function elsewhere (monitoring snapshot, runtime
// analytics, benchmark core, audit service, agent service's start/stop transitions, pipeline
// runner's last-result accessor). Mounted at /api/dev behind `requireAuth, requireDev` in
// index.ts — requireDev already 403s unauthorized callers before any handler here runs.
//
// Honesty note (see AutonomousRuntime — runtime/autonomousRuntime/index.ts): a single, process-
// wide AutonomousRuntime instance is now wired via runtime/runtimeSingleton.ts, started from
// index.ts's app.listen callback. It runs against a 'replay' ExecutionTarget only (never real
// capital) and an empty ProtocolRegistry (no real protocol adapter is registered yet — see that
// file's header for why). GET /runtime and POST /validation/run below read `getRuntime()`/
// `runOnce()` and report `wired: false` / 503 honestly if boot-time init hasn't completed yet
// (it never blocks server boot on failure). This router still follows the same "config
// injection, report null/503 instead of fabricating" convention as routes/dashboard.ts and
// routes/monitoring.ts for the parts of Developer Mode that would depend on that runtime (e.g.
// distinct PAUSED-state pause/resume — no such state exists in the wired agent model). Paper-trading start/stop are
// implemented against the actually-wired per-agent lifecycle (`agentService.startAgent/stopAgent`
// + `provisionService`), since that is the real, persisted control surface for agents in this
// deployment. Pause/resume reuse those same two functions (no separate PAUSED state exists in
// the wired agent model) — see the file-level comment on the pause/resume handlers below.
import { Router } from 'express';
import { z } from 'zod';
import { getAgentRow, startAgent, stopAgent, listRunningAgents } from '../agentService.js';
import { provisionRoleAgents, provisionSingleRoleAgent } from '../provisionService.js';
import { buildMonitoringSnapshot } from '../monitoring/index.js';
import type { MonitoringConfig } from '../monitoring/index.js';
import { getLastPipelineResult, PIPELINE_STAGE_NAMES } from '../runtime/pipelineRunner/index.js';
import { SqliteBenchmarkStore } from '../benchmarkCore/store.js';
import { computeTradingMetrics } from '../benchmarkCore/tradingMetrics.js';
import type { BenchmarkStore, BenchmarkExecutionRecord } from '../benchmarkCore/types.js';
import { listAuditForOwner, auditEvents } from '../auditService.js';
import { computePipelineLatencyReport } from '../runtimeAnalytics/analytics.js';
import { getRuntime, runOnce } from '../runtime/runtimeSingleton.js';
import { getNetwork } from '../config.js';

export interface DevRouterConfig {
  /** Defaults to a fresh SqliteBenchmarkStore, same DB file Benchmark Core writes to — same
   *  convention as routes/benchmark.ts. */
  benchmarkStore?: BenchmarkStore;
  monitoring?: MonitoringConfig;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarizeSessions(records: BenchmarkExecutionRecord[]) {
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

/** Loads the agent and 403s if it isn't owned by the authenticated caller — same helper shape as
 *  routes/agents.ts::loadOwnedAgent, duplicated locally rather than imported since that one isn't
 *  exported and this router deliberately stays decoupled from routes/agents.ts internals. */
function loadOwnedAgent(agentId: string, req: import('express').Request, res: import('express').Response) {
  const row = getAgentRow(agentId);
  if (!row) {
    res.status(404).json({ success: false, error: 'Agent not found' });
    return undefined;
  }
  if (row.owner !== req.auth!.publicKey) {
    res.status(403).json({ success: false, error: 'Not authorized for this agent' });
    return undefined;
  }
  return row;
}

const paperTargetSchema = z.object({
  agentId: z.string().optional(),
  role: z.enum(['strategic', 'yield', 'balancer']).optional(),
});

export function createDevRouter(config: DevRouterConfig = {}): Router {
  const router = Router();
  const store = config.benchmarkStore ?? new SqliteBenchmarkStore();

  // Used by the frontend to decide whether to render any Developer Mode UI at all. If the
  // request got this far, requireAuth + requireDev already passed.
  router.get('/status', (_req, res) => {
    res.json({ success: true, enabled: true });
  });

  // `runtime` (below) is the pre-existing monitoring snapshot (process/GPU/decision-model
  // metrics) — unrelated to the composed AutonomousRuntime. `autonomousRuntime` is the new,
  // separate field for that: null until runtime/runtimeSingleton.ts's initRuntime() has actually
  // completed in this process (see index.ts's app.listen callback). Every field below is read
  // straight off the live AutonomousRuntime/pipelineRunner — nothing here is fabricated.
  //   - executionTarget is always 'replay' (see runtimeSingleton.ts) — this process never
  //     executes against real capital.
  //   - provider/model are only populated if a decisionIntelligenceConfig override was supplied
  //     to the composition; the singleton does not set one (falls back to
  //     getProviderConfigFromEnv() inside createPipelineStages), so these report the heartbeat's
  //     own provider/model, which will be null unless AutonomousRuntimeOptions.providerName/model
  //     were set — they are not set by runtimeSingleton.ts today.
  //   - benchmarkSession is always null: no accessor exists for "the currently active benchmark
  //     session" and Benchmark Core (frozen) is never modified to add one.
  router.get('/runtime', async (_req, res) => {
    try {
      const monitoring = await buildMonitoringSnapshot(config.monitoring);
      const runtime = getRuntime();
      const autonomousRuntime = runtime
        ? {
            wired: true,
            state: runtime.getState(),
            heartbeat: runtime.getHeartbeat(),
            uptimeMs: runtime.getHeartbeat().uptimeMs,
            lastExecutionAt: runtime.getHeartbeat().lastExecutionAt,
            activeAgentCount: listRunningAgents().length,
            executionTarget: { kind: 'replay', note: 'dev/introspection runtime — never executes against real capital' },
            network: getNetwork(),
            provider: runtime.getHeartbeat().provider,
            model: runtime.getHeartbeat().model,
            benchmarkSession: null,
          }
        : { wired: false, note: 'AutonomousRuntime has not initialized in this process yet (see runtime/runtimeSingleton.ts).' };
      res.json({ success: true, runtime: monitoring, autonomousRuntime });
    } catch (error) {
      res.status(500).json({ success: false, error: errorMessage(error) });
    }
  });

  router.get('/pipeline', (_req, res) => {
    const last = getLastPipelineResult();
    if (!last) {
      res.json({ success: true, pipeline: null, stages: PIPELINE_STAGE_NAMES });
      return;
    }
    const stages = PIPELINE_STAGE_NAMES.map((name) => ({
      name,
      completed: last.stageDurations[name] !== undefined,
      durationMs: last.stageDurations[name] ?? null,
      failed: last.failureStage === name,
    }));
    res.json({
      success: true,
      pipeline: {
        success: last.success,
        startedAt: last.startedAt,
        finishedAt: last.finishedAt,
        totalDurationMs: last.totalDurationMs,
        failureStage: last.failureStage ?? null,
        error: last.error ?? null,
        stages,
      },
    });
  });

  // Reuses the same start path as POST /api/agents/provision(-role) — no copy of that logic.
  router.post('/paper/start', async (req, res) => {
    const parsed = paperTargetSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.message });
    try {
      if (parsed.data.role) {
        const agent = await provisionSingleRoleAgent(req.auth!.publicKey, parsed.data.role, { mode: 'paper' });
        return res.json({ success: true, agent });
      }
      const agents = await provisionRoleAgents(req.auth!.publicKey, { mode: 'paper' });
      res.json({ success: true, agents });
    } catch (error) {
      res.status(400).json({ success: false, error: errorMessage(error) });
    }
  });

  router.post('/paper/stop', (req, res) => {
    const parsed = paperTargetSchema.safeParse(req.body ?? {});
    if (!parsed.success || !parsed.data.agentId) {
      return res.status(400).json({ success: false, error: 'agentId is required' });
    }
    if (!loadOwnedAgent(parsed.data.agentId, req, res)) return;
    try {
      const agent = stopAgent(parsed.data.agentId);
      res.json({ success: true, agent });
    } catch (error) {
      res.status(400).json({ success: false, error: errorMessage(error) });
    }
  });

  // NOTE: the wired per-agent lifecycle (agentService.ts) only models running/stopped/error/new
  // — there is no distinct PAUSED state today (that concept exists only on the separate,
  // not-yet-wired AutonomousRuntime state machine — runtime/autonomousRuntime/stateMachine.ts).
  // Rather than fabricate a fake PAUSED status, pause/resume are implemented as thin aliases over
  // the same real stopAgent/startAgent transitions used above and by routes/agents.ts.
  router.post('/paper/pause', (req, res) => {
    const parsed = paperTargetSchema.safeParse(req.body ?? {});
    if (!parsed.success || !parsed.data.agentId) {
      return res.status(400).json({ success: false, error: 'agentId is required' });
    }
    if (!loadOwnedAgent(parsed.data.agentId, req, res)) return;
    try {
      const agent = stopAgent(parsed.data.agentId);
      res.json({ success: true, agent, note: 'paused via stop — no distinct PAUSED state exists in the wired agent model' });
    } catch (error) {
      res.status(400).json({ success: false, error: errorMessage(error) });
    }
  });

  router.post('/paper/resume', (req, res) => {
    const parsed = paperTargetSchema.safeParse(req.body ?? {});
    if (!parsed.success || !parsed.data.agentId) {
      return res.status(400).json({ success: false, error: 'agentId is required' });
    }
    if (!loadOwnedAgent(parsed.data.agentId, req, res)) return;
    try {
      const agent = startAgent(parsed.data.agentId);
      res.json({ success: true, agent });
    } catch (error) {
      res.status(400).json({ success: false, error: errorMessage(error) });
    }
  });

  // Kicks off a fresh pipeline run and records it into a Benchmark session, exactly the same
  // mechanism Benchmark Core already uses (KairosPipelineRunner + BenchmarkSession, see
  // runtime/pipelineRunner/orchestrator.ts::recordBenchmark). Requires the caller to already have
  // a composed KairosPipelineRunner wired for their agent; since no runtime/composition is wired
  // into this process (see file-level note), this reports 503 rather than fabricating a result —
  // same convention as routes/benchmark.ts's /reports and /compare when buildReportBundle is
  // unconfigured.
  router.post('/validation/run', async (_req, res) => {
    if (!getRuntime()) {
      res.status(503).json({
        success: false,
        error: 'No PipelineRunner/BenchmarkSession is wired into this process yet — validation runs must be triggered through the composed runtime (runtime/pipelineComposition) once a deployment wires one up.',
      });
      return;
    }
    try {
      const result = await runOnce();
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ success: false, error: errorMessage(error) });
    }
  });

  router.get('/benchmark', (_req, res) => {
    try {
      const sessions = summarizeSessions(store.listAll());
      if (sessions.length === 0) {
        res.json({ success: true, session: null, trading: null, pipelineLatency: null });
        return;
      }
      const latest = sessions[0];
      const records = store.listBySession(latest.sessionId);
      res.json({
        success: true,
        session: latest,
        trading: computeTradingMetrics(records),
        pipelineLatency: computePipelineLatencyReport([]),
      });
    } catch (error) {
      res.status(500).json({ success: false, error: errorMessage(error) });
    }
  });

  router.get('/export/logs', (req, res) => {
    try {
      const events = listAuditForOwner(req.auth!.publicKey, 500);
      res.setHeader('Content-Disposition', 'attachment; filename="kairos-audit-log.json"');
      res.json({ success: true, exportedAt: Date.now(), events });
    } catch (error) {
      res.status(500).json({ success: false, error: errorMessage(error) });
    }
  });

  router.get('/export/benchmark', (_req, res) => {
    try {
      const records = store.listAll();
      res.setHeader('Content-Disposition', 'attachment; filename="kairos-benchmark.json"');
      res.json({ success: true, exportedAt: Date.now(), records });
    } catch (error) {
      res.status(500).json({ success: false, error: errorMessage(error) });
    }
  });

  // SSE stream of live audit events for the authenticated owner — same mechanism/EventEmitter as
  // routes/audit.ts's GET /api/audit/stream (auditService.ts::auditEvents), not a new event bus.
  router.get('/stream', (req, res) => {
    const owner = req.auth!.publicKey;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const onEvent = (row: { owner: string }) => {
      if (row.owner !== owner) return;
      res.write(`data: ${JSON.stringify(row)}\n\n`);
    };
    auditEvents.on('event', onEvent);

    req.on('close', () => {
      auditEvents.off('event', onEvent);
    });
  });

  return router;
}
