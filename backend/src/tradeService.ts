// Business-logic layer over the `trades` table — mirrors agentService.ts's split of
// schema/row-types (db.ts) from operations (this file). The trades table is append-only: a
// reversal never mutates or deletes the original row, it inserts a new one referencing it via
// `reversed_trade_id`, so the audit trail always reflects everything that actually happened.
import { randomUUID } from 'crypto';
import { getDb, type TradeRow, type TradeSide, type TradeStatus } from './db.js';

export interface InsertTradeInput {
  agentId: string;
  strategyId: string;
  side: TradeSide;
  pair: string;
  amount: string;
  price: string;
  txHash: string | null;
  status: TradeStatus;
  realizedPnl: string | null;
  reversedTradeId?: string | null;
  mode?: 'paper' | 'live';
}

export function insertTrade(input: InsertTradeInput): TradeRow {
  const row: TradeRow = {
    id: randomUUID(),
    agent_id: input.agentId,
    strategy_id: input.strategyId,
    side: input.side,
    pair: input.pair,
    amount: input.amount,
    price: input.price,
    tx_hash: input.txHash,
    status: input.status,
    realized_pnl: input.realizedPnl,
    reversed_trade_id: input.reversedTradeId ?? null,
    created_at: Date.now(),
    mode: input.mode ?? 'live',
  };
  getDb()
    .prepare(
      `INSERT INTO trades (id, agent_id, strategy_id, side, pair, amount, price, tx_hash, status, realized_pnl, reversed_trade_id, created_at, mode)
       VALUES (@id, @agent_id, @strategy_id, @side, @pair, @amount, @price, @tx_hash, @status, @realized_pnl, @reversed_trade_id, @created_at, @mode)`
    )
    .run(row);
  return row;
}

export function listTradesForAgent(agentId: string): TradeRow[] {
  return getDb()
    .prepare('SELECT * FROM trades WHERE agent_id = ? ORDER BY created_at ASC')
    .all(agentId) as TradeRow[];
}

/** Bounded variant of listTradesForAgent for callers (e.g. the Context Layer's Historical
 *  domain) that only need a recent lookback window, not the agent's entire trade history —
 *  applies the LIMIT in SQL rather than loading every row and slicing in memory. Returned in
 *  the same ascending (oldest-first) order as listTradesForAgent. */
export function listRecentTradesForAgent(agentId: string, limit = 20): TradeRow[] {
  const rows = getDb()
    .prepare('SELECT * FROM trades WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(agentId, limit) as TradeRow[];
  return rows.reverse();
}

export function getTrade(id: string): TradeRow | undefined {
  return getDb().prepare('SELECT * FROM trades WHERE id = ?').get(id) as TradeRow | undefined;
}

/** True if any later trade row already reverses this one — a trade can only be reversed once. */
export function isTradeReversed(tradeId: string): boolean {
  const row = getDb().prepare('SELECT id FROM trades WHERE reversed_trade_id = ?').get(tradeId);
  return !!row;
}
