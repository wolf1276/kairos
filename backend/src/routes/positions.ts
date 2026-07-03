import { Router } from 'express';
import { getAgentRow } from '../agentService.js';
import { listPositionsForAgent, listPositionsForOwner } from '../positionService.js';

export const positionsRouter = Router();

positionsRouter.get('/', (req, res) => {
  res.json({ success: true, positions: listPositionsForOwner(req.auth!.publicKey) });
});

export const agentPositionsRouter = Router();

agentPositionsRouter.get('/:id/positions', (req, res) => {
  const row = getAgentRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Agent not found' });
  if (row.owner !== req.auth!.publicKey) return res.status(403).json({ error: 'Not authorized for this agent' });
  res.json({ success: true, positions: listPositionsForAgent(req.params.id) });
});
