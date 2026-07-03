// Periodic performance snapshots per agent (performance_snapshots table) — a time series backing
// the dashboard's PnL/win-rate history so charts survive restarts without replaying trades.
import { randomUUID } from 'crypto';
import { getDb, type PerformanceSnapshotRow, type AgentRow } from './db.js';
import { listTradesForAgent } from './tradeService.js';
import { computePnlSummary } from './pnl.js';

export function snapshotPerformance(row: AgentRow, pair: string, currentPrice: number): PerformanceSnapshotRow {
  const pnl = computePnlSummary(row.id, pair, currentPrice);
  const trades = listTradesForAgent(row.id).filter((t) => t.pair === pair);
  const sells = trades.filter((t) => t.side === 'sell' && t.realized_pnl !== null);
  const wins = sells.filter((t) => parseFloat(t.realized_pnl as string) > 0);
  const winRate = sells.length > 0 ? wins.length / sells.length : 0;

  const snap: PerformanceSnapshotRow = {
    id: randomUUID(),
    agent_id: row.id,
    owner: row.owner,
    realized_pnl: pnl.realizedPnl,
    unrealized_pnl: pnl.unrealizedPnl,
    open_position: pnl.openPosition,
    trade_count: trades.length,
    win_rate: winRate,
    capital_managed: row.capital,
    created_at: Date.now(),
  };
  getDb()
    .prepare(
      `INSERT INTO performance_snapshots (id, agent_id, owner, realized_pnl, unrealized_pnl, open_position,
        trade_count, win_rate, capital_managed, created_at)
       VALUES (@id, @agent_id, @owner, @realized_pnl, @unrealized_pnl, @open_position, @trade_count, @win_rate, @capital_managed, @created_at)`
    )
    .run(snap);
  return snap;
}

export function listPerformanceForAgent(agentId: string, limit = 200): PerformanceSnapshotRow[] {
  return getDb()
    .prepare('SELECT * FROM performance_snapshots WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(agentId, limit) as PerformanceSnapshotRow[];
}
