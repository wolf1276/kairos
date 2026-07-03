import { Router } from 'express';
import { getAgentRow } from '../agentService.js';
import { listAuditForAgent, listAuditForOwner, auditEvents } from '../auditService.js';

export const auditRouter = Router();

function parseLimit(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 500 ? n : 100;
}

function parseBefore(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

auditRouter.get('/', (req, res) => {
  const events = listAuditForOwner(req.auth!.publicKey, parseLimit(req.query.limit), parseBefore(req.query.before));
  res.json({ success: true, events });
});

// Server-sent events stream of new audit entries for the authenticated owner — used by the
// Live Activity feed instead of polling once latency matters.
auditRouter.get('/stream', (req, res) => {
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

export const agentAuditRouter = Router();

agentAuditRouter.get('/:id/audit', (req, res) => {
  const row = getAgentRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Agent not found' });
  if (row.owner !== req.auth!.publicKey) return res.status(403).json({ error: 'Not authorized for this agent' });
  const events = listAuditForAgent(req.params.id, parseLimit(req.query.limit), parseBefore(req.query.before));
  res.json({ success: true, events });
});
