import { Router } from 'express';
import { getAgent, getAgentRow, listAgents } from '../agentService.js';
import { getWalletDelegation } from '../db.js';
import { listTradesForAgent } from '../tradeService.js';
import { computePnlSummary } from '../pnl.js';
import { getPosition } from '../positionService.js';
import { getLatestPrice } from '../priceHistory.js';
import { listDecisionsForAgent } from '../decisionService.js';
import type { AgentRow } from '../db.js';
import type { StrategyConfig } from '../types.js';

const DAY_MS = 86_400_000;

export const statsRouter = Router();
export const agentStatsRouter = Router();

function strategyOf(row: AgentRow): StrategyConfig | null {
  return row.strategy_config_json ? (JSON.parse(row.strategy_config_json) as StrategyConfig) : null;
}

function pairOf(strategy: StrategyConfig | null): string {
  return strategy && strategy.type !== 'dca' ? strategy.pair : 'XLM/USDC';
}

async function buildDashboard(row: AgentRow) {
  const strategy = strategyOf(row);
  const pair = pairOf(strategy);
  const trades = listTradesForAgent(row.id).filter((t) => t.pair === pair);
  const currentPrice = (await getLatestPrice(pair)) ?? 0;
  const pnl = computePnlSummary(row.id, pair, currentPrice);
  const position = getPosition(row.id, pair) ?? null;

  const sells = trades.filter((t) => t.side === 'sell' && t.realized_pnl !== null);
  const wins = sells.filter((t) => parseFloat(t.realized_pnl as string) > 0);
  const winRate = sells.length > 0 ? wins.length / sells.length : 0;

  const capital = row.capital ? parseFloat(row.capital) : null;
  const totalPnl = parseFloat(pnl.realizedPnl) + parseFloat(pnl.unrealizedPnl);
  const totalReturn = capital && capital > 0 ? totalPnl / capital : null;

  const walletDelegation = row.delegator ? getWalletDelegation(row.delegator, row.public_key) : undefined;
  const lastTrade = trades[trades.length - 1];

  const since = Date.now() - DAY_MS;
  const todayPnl = trades
    .filter((t) => t.side === 'sell' && t.realized_pnl !== null && t.created_at >= since)
    .reduce((s, t) => s + parseFloat(t.realized_pnl as string), 0);
  const lifetimePnl = parseFloat(pnl.realizedPnl) + parseFloat(pnl.unrealizedPnl);

  // Latest decision drives the "what is this agent doing right now" fields on the ops dashboard.
  const lastDecision = row.role ? listDecisionsForAgent(row.id, 1)[0] : undefined;

  return {
    agent: getAgent(row.id),
    role: row.role,
    position,
    pnl,
    tradeCount: trades.length,
    winRate,
    totalReturn,
    runningTimeMs: row.started_at && row.status === 'running' ? Date.now() - row.started_at : null,
    lastExecution: lastTrade?.created_at ?? row.last_tick_at ?? null,
    delegationStatus: walletDelegation ? (walletDelegation.disabled ? 'disabled' : 'active') : 'none',
    mode: row.mode,
    capital: row.capital,
    riskLevel: row.risk_level,
    todayPnl: String(todayPnl),
    lifetimePnl: String(lifetimePnl),
    currentTask: row.last_result ?? row.last_error ?? (row.status === 'running' ? 'Analyzing market…' : 'Idle'),
    currentDecision: lastDecision?.action ?? null,
    currentConfidence: lastDecision?.confidence ?? null,
    currentReasoning: lastDecision?.reasoning ?? null,
    currentStrategy: lastDecision?.selected_strategy ?? (strategy?.type === 'quant' ? strategy.strategyId : null),
    lastDecisionTime: lastDecision?.created_at ?? null,
  };
}

agentStatsRouter.get('/:id/dashboard', async (req, res) => {
  const row = getAgentRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Agent not found' });
  if (row.owner !== req.auth!.publicKey) return res.status(403).json({ error: 'Not authorized for this agent' });
  res.json({ success: true, ...(await buildDashboard(row)) });
});

statsRouter.get('/agents/summary', async (req, res) => {
  const summaries = listAgents(req.auth!.publicKey);
  const dashboards = await Promise.all(
    summaries.map(async (s) => {
      const row = getAgentRow(s.id)!;
      return buildDashboard(row);
    })
  );
  res.json({ success: true, agents: dashboards });
});
