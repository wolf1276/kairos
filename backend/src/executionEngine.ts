import type { AgentRow, PositionRow } from './db.js';
import type { PnlSummary } from './pnl.js';
import type { AuditEventType } from '@kairos/types';
import { computeAvgCostAndRealize, computePnlSummary } from './pnl.js';
import { insertTrade } from './tradeService.js';
import { upsertPosition } from './positionService.js';
import { recordTick } from './agentService.js';
import { logEvent } from './auditService.js';

export interface CompletedTrade {
  tradeId: string;
  position: PositionRow;
  pnl: PnlSummary;
}

export interface RecordTradeInput {
  row: AgentRow;
  strategyId: string;
  side: 'buy' | 'sell';
  pair: string;
  amount: string;
  price: string;
  txHash: string;
  mode: 'paper' | 'live';
  eventType?: AuditEventType;
  message?: string;
}

export function recordCompletedTrade(input: RecordTradeInput): CompletedTrade {
  const { realizedPnl } = computeAvgCostAndRealize(input.row.id, input.pair, input.side, input.amount, input.price);
  const trade = insertTrade({
    agentId: input.row.id,
    strategyId: input.strategyId,
    side: input.side,
    pair: input.pair,
    amount: input.amount,
    price: input.price,
    txHash: input.txHash,
    status: 'success',
    realizedPnl,
    mode: input.mode,
  });
  const position = upsertPosition(input.row.id, input.pair);
  const pnl = computePnlSummary(input.row.id, input.pair, Number(input.price));
  logEvent({
    agentId: input.row.id,
    owner: input.row.owner,
    eventType: (input.eventType ?? (input.side === 'buy' ? 'trade_opened' : 'trade_closed')),
    mode: input.mode,
    strategyId: input.strategyId,
    mpcAccount: input.row.public_key,
    pair: input.pair,
    signal: input.side,
    executionStatus: 'success',
    txHash: input.txHash,
    positionAfter: position,
    pnlAfter: pnl,
    message: input.message ?? `${input.side} ${input.amount} ${input.pair} @ ${input.price}. Tx: ${input.txHash}`,
  });
  recordTick(input.row.id, { ok: true, message: input.message ?? `${input.side} ${input.amount} ${input.pair} @ ${input.price}. Tx: ${input.txHash}` });
  return { tradeId: trade.id, position, pnl };
}
