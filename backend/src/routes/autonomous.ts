// Routes for the autonomous multi-agent system: provisioning the 3 role agents, the replayable
// decision log, performance history, and portfolio allocation/targets. Split into an
// agent-scoped router (mounted at /api/agents, before the catch-all agentsRouter GET /:id) and
// an owner-scoped router (mounted at /api).
import { Router } from 'express';
import { z } from 'zod';
import { getAgentRow } from '../agentService.js';
import { provisionRoleAgents, provisionSingleRoleAgent } from '../provisionService.js';
import { listDecisionsForAgent, listDecisionsForOwner, getDecision } from '../decisionService.js';
import { listPerformanceForAgent } from '../performanceService.js';
import { computeAllocation, getTargets, managedCapitalUsd } from '../portfolioService.js';
import { currentYieldVenues, buildMarketContext } from '../decisionEngine.js';
import { getLatestPrice } from '../priceHistory.js';
import { upsertPortfolioState } from '../db.js';

export const autonomousAgentRouter = Router();
export const autonomousRouter = Router();

function parseLimit(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 500 ? n : 100;
}
function parseBefore(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function ensureOwned(req: import('express').Request, res: import('express').Response): boolean {
  const row = getAgentRow(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Agent not found' });
    return false;
  }
  if (row.owner !== req.auth!.publicKey) {
    res.status(403).json({ error: 'Not authorized for this agent' });
    return false;
  }
  return true;
}

const provisionSchema = z.object({
  mode: z.enum(['paper', 'live']).optional(),
  capital: z.string().optional(),
});

// POST /api/agents/provision — idempotently create + start the 3 role agents for the caller.
autonomousAgentRouter.post('/provision', async (req, res) => {
  const parsed = provisionSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    const agents = await provisionRoleAgents(req.auth!.publicKey, parsed.data);
    res.json({ success: true, agents });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

const provisionRoleSchema = z.object({
  role: z.enum(['strategic', 'yield', 'balancer']),
  mode: z.enum(['paper', 'live']).optional(),
  capital: z.string().optional(),
});

// POST /api/agents/provision-role — idempotently create + (paper mode only) start a single
// role agent, so the UI can offer "pick one role, set its delegation" instead of minting all
// three at once with one shared capital figure.
autonomousAgentRouter.post('/provision-role', async (req, res) => {
  const parsed = provisionRoleSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    const agent = await provisionSingleRoleAgent(req.auth!.publicKey, parsed.data.role, parsed.data);
    res.json({ success: true, agent });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

autonomousAgentRouter.get('/:id/decisions', (req, res) => {
  if (!ensureOwned(req, res)) return;
  res.json({ success: true, decisions: listDecisionsForAgent(req.params.id, parseLimit(req.query.limit), parseBefore(req.query.before)) });
});

autonomousAgentRouter.get('/:id/performance', (req, res) => {
  if (!ensureOwned(req, res)) return;
  res.json({ success: true, snapshots: listPerformanceForAgent(req.params.id, parseLimit(req.query.limit)) });
});

// ── Owner-scoped (/api) ──
autonomousRouter.get('/decisions', (req, res) => {
  res.json({ success: true, decisions: listDecisionsForOwner(req.auth!.publicKey, parseLimit(req.query.limit), parseBefore(req.query.before)) });
});

// Replay: full stored decision record by id (owner-checked).
autonomousRouter.get('/decisions/:decisionId', (req, res) => {
  const decision = getDecision(req.params.decisionId);
  if (!decision) return res.status(404).json({ error: 'Decision not found' });
  if (decision.owner !== req.auth!.publicKey) return res.status(403).json({ error: 'Not authorized' });
  res.json({ success: true, decision });
});

autonomousRouter.get('/portfolio', async (req, res) => {
  const owner = req.auth!.publicKey;
  const price = (await getLatestPrice('XLM/USDC')) ?? 0;
  const allocation = computeAllocation(owner, price);
  const targets = getTargets(owner);
  const ctx = await buildMarketContext('XLM/USDC', 300).catch(() => null);
  const venues = ctx ? currentYieldVenues(ctx) : [];
  res.json({
    success: true,
    price,
    allocation,
    targets,
    managedCapital: managedCapitalUsd(owner),
    yieldVenues: venues,
  });
});

const targetSchema = z.object({
  targetXlmPct: z.number().min(0).max(100).optional(),
  driftThresholdPct: z.number().min(1).max(50).optional(),
});

autonomousRouter.post('/portfolio/target', (req, res) => {
  const parsed = targetSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { targetXlmPct, driftThresholdPct } = parsed.data;
  upsertPortfolioState(req.auth!.publicKey, {
    ...(targetXlmPct !== undefined ? { targetXlmPct, targetUsdcPct: 100 - targetXlmPct } : {}),
    ...(driftThresholdPct !== undefined ? { driftThresholdPct } : {}),
  });
  res.json({ success: true, targets: getTargets(req.auth!.publicKey) });
});
