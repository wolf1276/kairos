// Weighted-average-cost-basis P&L accounting over an agent's trade history for a given pair.
// Buys accumulate into a running average cost; a sell realizes (sellPrice - avgCost) * amount
// against that basis. This is computed on read (not stored as running state) by replaying the
// full trade history each time — fine at the trade volumes a single scheduler-driven agent
// produces, and it keeps the ledger itself as the single source of truth.
import { listTradesForAgent } from './tradeService.js';
import type { TradeRow } from './db.js';

interface CostBasisState {
  avgCost: number;
  openAmount: number;
}

function replayCostBasis(trades: TradeRow[], pair: string, uptoCreatedAt?: number): CostBasisState {
  let avgCost = 0;
  let openAmount = 0;
  for (const t of trades) {
    if (t.pair !== pair || t.status !== 'success') continue;
    if (uptoCreatedAt !== undefined && t.created_at > uptoCreatedAt) continue;
    const amount = parseFloat(t.amount);
    const price = parseFloat(t.price);
    if (t.side === 'buy') {
      const newOpen = openAmount + amount;
      avgCost = newOpen === 0 ? 0 : (avgCost * openAmount + price * amount) / newOpen;
      openAmount = newOpen;
    } else {
      openAmount = Math.max(0, openAmount - amount);
      if (openAmount === 0) avgCost = 0;
    }
  }
  return { avgCost, openAmount };
}

/**
 * Computes realized P&L for a single new trade (side/amount/price) given the agent's prior
 * trade history for this pair — buys return null (no realization event), sells realize
 * (sellPrice - avgCost) * amountSold against the running weighted-average cost basis.
 */
export function computeAvgCostAndRealize(
  agentId: string,
  pair: string,
  side: 'buy' | 'sell',
  amount: string,
  price: string
): { realizedPnl: string | null } {
  if (side === 'buy') return { realizedPnl: null };

  const priorTrades = listTradesForAgent(agentId);
  const { avgCost } = replayCostBasis(priorTrades, pair);
  const sellPrice = parseFloat(price);
  const sellAmount = parseFloat(amount);
  const realized = (sellPrice - avgCost) * sellAmount;
  return { realizedPnl: String(realized) };
}

export interface PnlSummary {
  realizedPnl: string;
  unrealizedPnl: string;
  openPosition: string;
}

/** Full P&L summary for an agent+pair: sums realized P&L across all sell trades, and computes
 *  unrealized P&L on the current open position (if any) against `currentPrice`. */
export function computePnlSummary(agentId: string, pair: string, currentPrice: number): PnlSummary {
  const trades = listTradesForAgent(agentId).filter((t) => t.pair === pair && t.status === 'success');

  let realizedPnl = 0;
  for (const t of trades) {
    if (t.side === 'sell' && t.realized_pnl) {
      realizedPnl += parseFloat(t.realized_pnl);
    }
  }

  const { avgCost, openAmount } = replayCostBasis(trades, pair);
  const unrealizedPnl = openAmount > 0 ? (currentPrice - avgCost) * openAmount : 0;

  return {
    realizedPnl: String(realizedPnl),
    unrealizedPnl: String(unrealizedPnl),
    openPosition: String(openAmount),
  };
}
