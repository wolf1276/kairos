import { Router } from 'express';
import { z } from 'zod';
import {
  attachDelegation,
  createAgent,
  deleteAgent,
  getAgent,
  getAgentRow,
  listAgents,
  setStrategy,
  startAgent,
  stopAgent,
} from '../agentService.js';
import { getTrade, insertTrade, isTradeReversed, listTradesForAgent } from '../tradeService.js';
import { computeAvgCostAndRealize, computePnlSummary } from '../pnl.js';
import { getLatestPrice } from '../priceHistory.js';
import { executeQuantTrade } from '../tick.js';
import type { QuantStrategyConfig } from '../types.js';

export const agentsRouter = Router();

function handleError(res: import('express').Response, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  res.status(400).json({ error: message });
}

agentsRouter.post('/', async (req, res) => {
  const schema = z.object({ owner: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    res.json({ success: true, agent: await createAgent(parsed.data.owner) });
  } catch (error) {
    handleError(res, error);
  }
});

agentsRouter.get('/', (req, res) => {
  const owner = req.query.owner;
  if (typeof owner !== 'string' || !owner) return res.status(400).json({ error: 'owner query param is required' });
  res.json({ success: true, agents: listAgents(owner) });
});

agentsRouter.get('/:id', (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json({ success: true, agent });
});

const jsonSafeDelegationSchema = z.object({
  delegate: z.string(),
  delegator: z.string(),
  authority: z.string(),
  caveats: z.array(z.object({ enforcer: z.string(), terms: z.array(z.number()) })),
  salt: z.string(),
  nonce: z.string(),
  signature: z.string(),
});

agentsRouter.post('/:id/delegation', async (req, res) => {
  const parsed = jsonSafeDelegationSchema.safeParse(req.body.delegation);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    res.json({ success: true, agent: await attachDelegation(req.params.id, parsed.data) });
  } catch (error) {
    handleError(res, error);
  }
});

const dcaStrategySchema = z.object({
  type: z.literal('dca'),
  token: z.string(),
  amountPerTick: z.string(),
  intervalSeconds: z.number().int().positive(),
  // Ignored server-side (see agentService.setStrategy) — always forced to the attached
  // delegation's delegator — but kept optional here so older/simpler clients can omit it.
  destination: z.string().optional(),
});

const quantStrategySchema = z.object({
  type: z.literal('quant'),
  strategyId: z.string(),
  pair: z.string(),
  amountPerTrade: z.string(),
  intervalSeconds: z.number().int().positive(),
  destination: z.string().optional(),
});

const strategySchema = z.discriminatedUnion('type', [dcaStrategySchema, quantStrategySchema]);

agentsRouter.post('/:id/strategy', (req, res) => {
  const parsed = strategySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    res.json({ success: true, agent: setStrategy(req.params.id, { ...parsed.data, destination: parsed.data.destination ?? '' }) });
  } catch (error) {
    handleError(res, error);
  }
});

agentsRouter.post('/:id/start', (req, res) => {
  try {
    res.json({ success: true, agent: startAgent(req.params.id) });
  } catch (error) {
    handleError(res, error);
  }
});

agentsRouter.post('/:id/stop', (req, res) => {
  try {
    res.json({ success: true, agent: stopAgent(req.params.id) });
  } catch (error) {
    handleError(res, error);
  }
});

agentsRouter.get('/:id/trades', async (req, res) => {
  const row = getAgentRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Agent not found' });
  try {
    const trades = listTradesForAgent(req.params.id);
    const strategy = row.strategy_config_json ? (JSON.parse(row.strategy_config_json) as QuantStrategyConfig) : null;
    const pair = strategy?.type === 'quant' ? strategy.pair : 'XLM/USDC';
    const currentPrice = (await getLatestPrice(pair)) ?? 0;
    const pnl = computePnlSummary(req.params.id, pair, currentPrice);
    res.json({ success: true, trades, pnl });
  } catch (error) {
    handleError(res, error);
  }
});

agentsRouter.post('/:id/trades/:tradeId/reverse', async (req, res) => {
  const row = getAgentRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Agent not found' });
  const original = getTrade(req.params.tradeId);
  if (!original || original.agent_id !== req.params.id) return res.status(404).json({ error: 'Trade not found' });
  if (original.reversed_trade_id) return res.status(400).json({ error: 'Cannot reverse a trade that is itself a reversal' });
  if (isTradeReversed(original.id)) return res.status(400).json({ error: 'Trade has already been reversed' });

  const strategy = row.strategy_config_json ? (JSON.parse(row.strategy_config_json) as QuantStrategyConfig) : null;
  if (!strategy || strategy.type !== 'quant') return res.status(400).json({ error: 'Agent has no quant strategy configured' });

  try {
    const oppositeSide: 'buy' | 'sell' = original.side === 'buy' ? 'sell' : 'buy';
    const txHash = await executeQuantTrade(
      row,
      { ...strategy, amountPerTrade: original.amount },
      oppositeSide
    );
    const price = (await getLatestPrice(original.pair)) ?? parseFloat(original.price);
    const { realizedPnl } = computeAvgCostAndRealize(req.params.id, original.pair, oppositeSide, original.amount, String(price));
    const reversal = insertTrade({
      agentId: req.params.id,
      strategyId: original.strategy_id,
      side: oppositeSide,
      pair: original.pair,
      amount: original.amount,
      price: String(price),
      txHash,
      status: 'success',
      realizedPnl,
      reversedTradeId: original.id,
    });
    res.json({ success: true, trade: reversal });
  } catch (error) {
    handleError(res, error);
  }
});

agentsRouter.delete('/:id', (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  if (agent.status === 'running') {
    return res.status(400).json({ error: 'Stop the agent before deleting it' });
  }
  deleteAgent(req.params.id);
  res.json({ success: true });
});
