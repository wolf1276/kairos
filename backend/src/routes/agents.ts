import { Router } from 'express';
import { z } from 'zod';
import {
  attachDelegation,
  createAgent,
  deleteAgent,
  getAgent,
  getAgentRow,
  listAgents,
  revokeWalletDelegation,
  setStrategy,
  startAgent,
  stopAgent,
} from '../agentService.js';
import { getTrade, isTradeReversed, listTradesForAgent } from '../tradeService.js';
import { computePnlSummary } from '../pnl.js';
import { getLatestPrice } from '../priceHistory.js';
import { executeQuantTrade } from '../tick.js';
import { executePaperQuantTrade } from '../paperExecutor.js';
import { recordCompletedTrade } from '../executionEngine.js';
import { getWalletDelegation } from '../db.js';
import { parseIntent } from '../intentParser.js';
import type { QuantStrategyConfig } from '../types.js';

export const agentsRouter = Router();

function handleError(res: import('express').Response, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  res.status(400).json({ error: message });
}

/** Loads the agent and 403s if it isn't owned by the authenticated caller. Returns undefined (response already sent) on failure. */
function loadOwnedAgent(req: import('express').Request, res: import('express').Response) {
  const row = getAgentRow(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Agent not found' });
    return undefined;
  }
  if (row.owner !== req.auth!.publicKey) {
    res.status(403).json({ error: 'Not authorized for this agent' });
    return undefined;
  }
  return row;
}

const createAgentSchema = z.object({
  mode: z.enum(['paper', 'live']).optional(),
  capital: z.string().optional(),
  riskLevel: z.string().optional(),
});

const parseIntentSchema = z.object({
  goal: z.string(),
});

// Step 1 of Agent Creation (agentcreation.md): Natural Language -> AgentSpec only. Creates
// nothing — no agent, no Smart Wallet, no Delegation.
agentsRouter.post('/parse-intent', async (req, res) => {
  const parsed = parseIntentSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    const result = await parseIntent(parsed.data.goal);
    if (result.status === 'failed') return res.status(502).json(result);
    res.json(result);
  } catch (error) {
    handleError(res, error);
  }
});

agentsRouter.post('/', async (req, res) => {
  const parsed = createAgentSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    res.json({
      success: true,
      agent: await createAgent(req.auth!.publicKey, {
        mode: parsed.data.mode,
        capital: parsed.data.capital,
        riskLevel: parsed.data.riskLevel,
      }),
    });
  } catch (error) {
    handleError(res, error);
  }
});

agentsRouter.get('/', (req, res) => {
  res.json({ success: true, agents: listAgents(req.auth!.publicKey) });
});

agentsRouter.get('/:id', (req, res) => {
  if (!loadOwnedAgent(req, res)) return;
  res.json({ success: true, agent: getAgent(req.params.id) });
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
  if (!loadOwnedAgent(req, res)) return;
  const parsed = jsonSafeDelegationSchema.safeParse(req.body.delegation);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    const existing = getWalletDelegation(parsed.data.delegator, parsed.data.delegate);
    if (existing && !existing.disabled && !req.body.force) {
      return res.status(409).json({
        error: 'This agent already has a non-disabled delegation from this wallet. Revoke it first via POST /:id/delegation/revoke, or resubmit with { force: true, delegation: ... } to replace it.',
      });
    }
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

const limitStrategySchema = z.object({
  type: z.literal('limit'),
  pair: z.string(),
  asset: z.enum(['XLM', 'USDC']),
  side: z.enum(['buy', 'sell']),
  quantity: z.string(),
  triggerComparator: z.enum(['lte', 'gte']),
  triggerPrice: z.string(),
  intervalSeconds: z.number().int().positive(),
  destination: z.string().optional(),
});

const strategySchema = z.discriminatedUnion('type', [dcaStrategySchema, quantStrategySchema, limitStrategySchema]);

// Revokes this specific agent's delegation from its wallet in the backend's mirror only —
// other agents delegated from the same wallet keep working. This does NOT touch on-chain
// state: the caller must separately submit the on-chain `revoke_by_wallet(delegator,
// delegate)` (now keyed per-delegate, see contracts/soroban/contracts/delegation-manager)
// to actually revoke spend authority, or this agent's old signed delegation remains
// redeemable on-chain despite being marked disabled here.
agentsRouter.post('/:id/delegation/revoke', (req, res) => {
  const row = loadOwnedAgent(req, res);
  if (!row) return;
  if (!row.delegator) return res.status(400).json({ error: 'Agent has no delegation attached' });
  try {
    revokeWalletDelegation(row.delegator, row.public_key);
    res.json({ success: true, agent: getAgent(req.params.id) });
  } catch (error) {
    handleError(res, error);
  }
});

agentsRouter.post('/:id/strategy', (req, res) => {
  if (!loadOwnedAgent(req, res)) return;
  const parsed = strategySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    res.json({ success: true, agent: setStrategy(req.params.id, { ...parsed.data, destination: parsed.data.destination ?? '' }) });
  } catch (error) {
    handleError(res, error);
  }
});

agentsRouter.post('/:id/start', async (req, res) => {
  if (!loadOwnedAgent(req, res)) return;
  try {
    res.json({ success: true, agent: await startAgent(req.params.id) });
  } catch (error) {
    handleError(res, error);
  }
});

agentsRouter.post('/:id/stop', (req, res) => {
  if (!loadOwnedAgent(req, res)) return;
  try {
    res.json({ success: true, agent: stopAgent(req.params.id) });
  } catch (error) {
    handleError(res, error);
  }
});

agentsRouter.get('/:id/trades', async (req, res) => {
  const row = loadOwnedAgent(req, res);
  if (!row) return;
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
  const row = loadOwnedAgent(req, res);
  if (!row) return;
  const original = getTrade(req.params.tradeId);
  if (!original || original.agent_id !== req.params.id) return res.status(404).json({ error: 'Trade not found' });
  if (original.reversed_trade_id) return res.status(400).json({ error: 'Cannot reverse a trade that is itself a reversal' });
  if (isTradeReversed(original.id)) return res.status(400).json({ error: 'Trade has already been reversed' });

  const strategy = row.strategy_config_json ? (JSON.parse(row.strategy_config_json) as QuantStrategyConfig) : null;
  if (!strategy || strategy.type !== 'quant') return res.status(400).json({ error: 'Agent has no quant strategy configured' });
  if (original.mode !== row.mode) {
    return res.status(400).json({ error: 'Cannot reverse a trade across a paper/live mode change' });
  }

  try {
    const oppositeSide: 'buy' | 'sell' = original.side === 'buy' ? 'sell' : 'buy';
    // Price fetched once, before execution, so the same value both floors the on-chain
    // slippage check and books the trade — avoids a stale post-execution read racing a
    // concurrent tick's own price-dependent accounting for this agent.
    const price = (await getLatestPrice(original.pair)) ?? parseFloat(original.price);
    const txHash =
      row.mode === 'paper'
        ? await executePaperQuantTrade(row, { ...strategy, amountPerTrade: original.amount }, oppositeSide)
        : await executeQuantTrade(row, { ...strategy, amountPerTrade: original.amount }, oppositeSide, price);
    // recordCompletedTrade wraps the trade insert + position upsert in one DB transaction, so a
    // crash or a concurrent scheduler tick for this agent can't observe a trade recorded without
    // its matching position update (or vice versa).
    const { tradeId } = recordCompletedTrade({
      row,
      strategyId: original.strategy_id,
      side: oppositeSide,
      pair: original.pair,
      amount: original.amount,
      price: String(price),
      txHash,
      mode: row.mode,
      eventType: 'trade_closed',
      message: `Reversal of trade ${original.id}: ${oppositeSide} ${original.amount} ${original.pair} @ ${price}. Tx: ${txHash}`,
      reversedTradeId: original.id,
    });
    const reversal = getTrade(tradeId);
    res.json({ success: true, trade: reversal });
  } catch (error) {
    handleError(res, error);
  }
});

agentsRouter.delete('/:id', (req, res) => {
  const row = loadOwnedAgent(req, res);
  if (!row) return;
  if (row.status === 'running') {
    return res.status(400).json({ error: 'Stop the agent before deleting it' });
  }
  try {
    deleteAgent(req.params.id);
  } catch (error) {
    // trades/decisions/audit_log reference agents(id) ON DELETE RESTRICT — an agent with real
    // trade/decision history can't be deleted (would orphan or silently erase that history).
    if (error instanceof Error && /FOREIGN KEY constraint failed/.test(error.message)) {
      return res.status(409).json({ error: 'Cannot delete an agent with existing trade/decision history' });
    }
    return handleError(res, error);
  }
  res.json({ success: true });
});
