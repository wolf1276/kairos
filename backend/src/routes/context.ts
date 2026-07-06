// Context Layer API — exposes the read-only AgentContext snapshot (Market/Managed Capital/
// Policy/System/Historical) for one agent. Never triggers reasoning, decisions, or execution —
// this is purely "what does the Context Layer currently see for this agent".
import { Router } from 'express';
import { getAgentRow } from '../agentService.js';
import { logEvent } from '../auditService.js';
import { buildAgentContext, refreshAgentContext } from '../agentContext/contextBuilder.js';
import { getContextMetricsSnapshot } from '../agentContext/metrics.js';
import { getContextHealthSummary } from '../agentContext/monitor.js';

const CONTEXT_BUILD_TIMEOUT_MS = 15_000;

export const agentContextRouter = Router();

// Aggregate, cross-agent telemetry — not agent-scoped, so it lives on its own router (mounted
// under /api, still behind requireAuth) rather than agentContextRouter's /:id/context path.
// Read-only counters; exposing it changes nothing about how any context is built.
export const contextMetricsRouter = Router();
contextMetricsRouter.get('/context-metrics', (_req, res) => {
  res.json({ success: true, metrics: getContextMetricsSnapshot() });
});
// Health/monitoring summary — thresholds + warnings computed fresh on every request (not just
// on the periodic self-check's cadence), so this is always as current as metrics.ts allows.
contextMetricsRouter.get('/context-health', (_req, res) => {
  res.json({ success: true, health: getContextHealthSummary() });
});

// Base/counter asset codes are Stellar asset codes (alphanumeric, max 12 chars per SEP-11)
// joined by '/'. Rejecting anything else here — before `pair` ever reaches a cache key, a
// downstream service call, or an error message reflected back to the caller — closes off:
// (1) cache-key collisions with another agent's/pair's cached feature result (context leakage),
// (2) unbounded-length/binary input reaching downstream string handling, and (3) arbitrary
// caller-controlled content being echoed back in a 500 error message.
const PAIR_PATTERN = /^[A-Z0-9]{1,12}\/[A-Z0-9]{1,12}$/;

function parsePair(raw: unknown): { ok: true; pair: string | undefined } | { ok: false } {
  if (raw === undefined) return { ok: true, pair: undefined };
  if (typeof raw !== 'string' || !PAIR_PATTERN.test(raw)) return { ok: false };
  return { ok: true, pair: raw };
}

agentContextRouter.get('/:id/context', async (req, res) => {
  const row = getAgentRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Agent not found' });
  if (row.owner !== req.auth!.publicKey) return res.status(403).json({ error: 'Not authorized for this agent' });

  const forceRefresh = req.query.refresh === 'true';
  const parsedPair = parsePair(req.query.pair);
  if (!parsedPair.ok) {
    return res.status(400).json({ error: 'Invalid pair — expected "<BASE>/<COUNTER>" asset codes (e.g. XLM/USDC)' });
  }
  const pair = parsedPair.pair;

  // Enforce a maximum wall-clock duration so a stuck oracle call doesn't
  // hang the request (and its connection/socket) indefinitely.
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const context = await Promise.race([
      forceRefresh
        ? refreshAgentContext(req.params.id, { pair })
        : buildAgentContext(req.params.id, { pair }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Context build timed out')), CONTEXT_BUILD_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timeout);

    if (!context) {
      return res.status(503).json({ error: 'Context not available yet — oracle has insufficient candle history' });
    }

    // Audit log: record every successful context access for operational forensics.
    try {
      logEvent({
        agentId: req.params.id,
        owner: row.owner,
        eventType: 'context_access',
        pair: context.pair,
        message: `Context accessed by ${req.auth!.publicKey} (status=${context.status}, snapshot=${context.meta.snapshotId}, refresh=${forceRefresh})`,
      });
    } catch {
      // Audit write failure must never break the response — the context was
      // built successfully; the audit trail is a secondary concern.
    }

    res.json({ success: true, context });
  } catch (error) {
    clearTimeout(timeout);
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'Context build timed out') {
      console.error(`Context build timed out for agent ${req.params.id}`);
      return res.status(504).json({ error: 'Context build timed out' });
    }
    // Log the real error server-side, but never reflect an arbitrary internal error message
    // (RPC/Horizon URLs, adapter internals, stack fragments) back to the caller — an unhandled
    // build failure is a platform detail, not something the client's request caused.
    console.error(`Context build failed for agent ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to build agent context' });
  }
});
