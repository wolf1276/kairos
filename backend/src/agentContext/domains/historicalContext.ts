// Historical Context domain — immediate operational history only (last execution, last decision,
// recent failures, cooldown). Explicitly NOT long-term memory or RAG — bounded lookback over
// existing tables, reused as-is.
import { getRoleIntervalSeconds } from '../../config.js';
import { listRecentTradesForAgent } from '../../tradeService.js';
import { listDecisionsForAgent } from '../../decisionService.js';
import { listAuditForAgent } from '../../auditService.js';
import type { AgentRow } from '../../db.js';

const RECENT_FAILURE_LOOKBACK = 20;
const FAILURE_EVENT_TYPES = new Set(['strategy_error', 'policy_violation', 'delegation_invalid']);

export interface HistoricalContextView {
  lastExecution: {
    side: 'buy' | 'sell';
    pair: string;
    status: 'success' | 'failed';
    createdAt: number;
  } | null;
  lastDecision: {
    action: string;
    confidence: number;
    createdAt: number;
  } | null;
  recentFailureCount: number;
  cooldown: {
    active: boolean;
    remainingSeconds: number;
  };
  recentExecutionSummary: {
    tradeCount: number;
    successCount: number;
    failureCount: number;
  };
  /** 0-1 — degrades with recent failure density; a clean recent history is fully trusted, a
   *  string of recent failures means this agent's operational track record should be trusted
   *  less right now. */
  confidence: number;
}

/** Each recent failure (of RECENT_FAILURE_LOOKBACK) shaves confidence, capped at a 0.4 floor —
 *  failures are a signal to be cautious, not proof the domain's data itself is wrong. */
function historicalConfidence(recentFailureCount: number, lookback: number): number {
  return 1 - Math.min(recentFailureCount / lookback, 1) * 0.6;
}

export function buildHistoricalContextView(agentRow: AgentRow, now = Date.now()): HistoricalContextView {
  // Bounded to the same lookback as the failure/audit scan below — the Historical domain is
  // "immediate operational history only," never the agent's full trade history, so this is a
  // SQL LIMIT, not an in-memory slice of every trade the agent has ever made.
  const trades = listRecentTradesForAgent(agentRow.id, RECENT_FAILURE_LOOKBACK);
  const lastTrade = trades[trades.length - 1] ?? null;
  const decisions = listDecisionsForAgent(agentRow.id, 1);
  const lastDecision = decisions[0] ?? null;
  const recentAudit = listAuditForAgent(agentRow.id, RECENT_FAILURE_LOOKBACK);
  const recentFailureCount = recentAudit.filter((e) => FAILURE_EVENT_TYPES.has(e.event_type)).length;

  const intervalMs = (getRoleIntervalSeconds() || 120) * 1000;
  const dueAt = (agentRow.last_tick_at ?? 0) + intervalMs;
  const remainingMs = Math.max(0, dueAt - now);

  const recentTrades = trades.slice(-RECENT_FAILURE_LOOKBACK);

  return {
    lastExecution: lastTrade
      ? { side: lastTrade.side, pair: lastTrade.pair, status: lastTrade.status, createdAt: lastTrade.created_at }
      : null,
    lastDecision: lastDecision
      ? { action: lastDecision.action, confidence: lastDecision.confidence, createdAt: lastDecision.created_at }
      : null,
    recentFailureCount,
    cooldown: {
      active: remainingMs > 0,
      remainingSeconds: Math.round(remainingMs / 1000),
    },
    recentExecutionSummary: {
      tradeCount: recentTrades.length,
      successCount: recentTrades.filter((t) => t.status === 'success').length,
      failureCount: recentTrades.filter((t) => t.status === 'failed').length,
    },
    confidence: historicalConfidence(recentFailureCount, RECENT_FAILURE_LOOKBACK),
  };
}
