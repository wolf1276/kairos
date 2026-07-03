// Persisted open-position snapshot per agent+pair — upserted after every trade fill using the
// same weighted-average-cost math pnl.ts already uses to compute PnL on read, so there's a
// single source of truth for the cost-basis algorithm; this table just caches its result so
// positions survive without replaying full trade history on every dashboard/API read.
import { randomUUID } from 'crypto';
import { getDb, type PositionRow } from './db.js';
import { listTradesForAgent } from './tradeService.js';

interface CostBasisState {
  avgCost: number;
  openAmount: number;
  realizedPnlTotal: number;
}

function replay(agentId: string, pair: string): CostBasisState {
  const trades = listTradesForAgent(agentId).filter((t) => t.pair === pair && t.status === 'success');
  let avgCost = 0;
  let openAmount = 0;
  let realizedPnlTotal = 0;
  for (const t of trades) {
    const amount = parseFloat(t.amount);
    const price = parseFloat(t.price);
    if (t.side === 'buy') {
      const newOpen = openAmount + amount;
      avgCost = newOpen === 0 ? 0 : (avgCost * openAmount + price * amount) / newOpen;
      openAmount = newOpen;
    } else {
      openAmount = Math.max(0, openAmount - amount);
      if (t.realized_pnl) realizedPnlTotal += parseFloat(t.realized_pnl);
      if (openAmount === 0) avgCost = 0;
    }
  }
  return { avgCost, openAmount, realizedPnlTotal };
}

/** Recomputes and upserts an agent's position row for a pair — call right after every insertTrade. */
export function upsertPosition(agentId: string, pair: string): PositionRow {
  const { avgCost, openAmount, realizedPnlTotal } = replay(agentId, pair);
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO positions (id, agent_id, pair, side, open_amount, avg_cost, realized_pnl_total, updated_at)
       VALUES (@id, @agentId, @pair, 'long', @openAmount, @avgCost, @realizedPnlTotal, @now)
       ON CONFLICT(agent_id, pair) DO UPDATE SET open_amount = @openAmount, avg_cost = @avgCost, realized_pnl_total = @realizedPnlTotal, updated_at = @now`
    )
    .run({ id: randomUUID(), agentId, pair, openAmount: String(openAmount), avgCost: String(avgCost), realizedPnlTotal: String(realizedPnlTotal), now });
  return getPosition(agentId, pair)!;
}

export function getPosition(agentId: string, pair: string): PositionRow | undefined {
  return getDb().prepare('SELECT * FROM positions WHERE agent_id = ? AND pair = ?').get(agentId, pair) as PositionRow | undefined;
}

export function listPositionsForAgent(agentId: string): PositionRow[] {
  return getDb().prepare('SELECT * FROM positions WHERE agent_id = ?').all(agentId) as PositionRow[];
}

export function listPositionsForOwner(owner: string): (PositionRow & { agentId: string })[] {
  const rows = getDb()
    .prepare(
      `SELECT p.*, a.owner as owner FROM positions p JOIN agents a ON a.id = p.agent_id WHERE a.owner = ?`
    )
    .all(owner) as (PositionRow & { owner: string })[];
  return rows.map((r) => ({ ...r, agentId: r.agent_id }));
}
