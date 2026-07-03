// Simulated fills for paper-mode agents — kept in a separate file (not inlined in tick.ts) so
// every function that actually touches Turnkey signing or submits a real Horizon transaction
// stays out of here entirely; anything importing from this module never moves real funds.
// Signatures intentionally mirror executeQuantTrade/executeLimitOrder in tick.ts so the mode
// branch at each call site is a one-line ternary — everything after (insertTrade, PnL calc,
// position upsert, recordTick) is unchanged and shared between paper and live.
import { randomUUID } from 'crypto';
import type { AgentRow } from './db.js';
import type { LimitStrategyConfig } from './types.js';

export async function executePaperQuantTrade(
  _row: AgentRow,
  _strategy: { pair: string; amountPerTrade: string },
  _side: 'buy' | 'sell'
): Promise<string> {
  return `paper-${randomUUID()}`;
}

export async function executePaperLimitOrder(
  _row: AgentRow,
  _strategy: LimitStrategyConfig,
  _price: number
): Promise<string> {
  return `paper-${randomUUID()}`;
}
