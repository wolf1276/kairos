// Outbox pattern for live/paper trade execution — see db.ts's ExecutionJournalRow doc for why
// this exists. A journal row is opened before broadcasting, updated once broadcast succeeds,
// and closed once the trade is durably recorded. On process start, `reconcilePendingExecutions`
// replays any row left at 'broadcast' (crash after on-chain success, before the DB write) into
// `trades`/`positions` via the same `recordCompletedTrade` path a normal tick uses, so the fill
// isn't lost and the next tick doesn't double-execute against a position that doesn't yet
// reflect it.
import { randomUUID } from 'crypto';
import { getDb, type AgentRow, type ExecutionJournalRow, type ExecutionJournalStatus, type TradeSide } from './db.js';
import { recordCompletedTrade } from './executionEngine.js';
import { logEvent } from './auditService.js';
import { verifyTransactionOnHorizon, findBroadcastAfter } from './horizonReconciliation.js';

export interface OpenExecutionInput {
  row: AgentRow;
  role: string | null;
  pair: string;
  side: TradeSide;
  amount: string;
  price: string;
  strategyId: string;
}

export function openExecution(input: OpenExecutionInput): ExecutionJournalRow {
  const now = Date.now();
  const journal: ExecutionJournalRow = {
    id: randomUUID(),
    agent_id: input.row.id,
    owner: input.row.owner,
    role: input.role,
    pair: input.pair,
    side: input.side,
    amount: input.amount,
    price: input.price,
    strategy_id: input.strategyId,
    mode: input.row.mode,
    status: 'pending',
    tx_hash: null,
    trade_id: null,
    error: null,
    created_at: now,
    updated_at: now,
  };
  getDb()
    .prepare(
      `INSERT INTO execution_journal (id, agent_id, owner, role, pair, side, amount, price, strategy_id, mode, status, tx_hash, trade_id, error, created_at, updated_at)
       VALUES (@id, @agent_id, @owner, @role, @pair, @side, @amount, @price, @strategy_id, @mode, @status, @tx_hash, @trade_id, @error, @created_at, @updated_at)`
    )
    .run(journal);
  return journal;
}

function updateJournal(id: string, fields: Partial<Pick<ExecutionJournalRow, 'status' | 'tx_hash' | 'trade_id' | 'error'>>): void {
  const current = getDb().prepare('SELECT * FROM execution_journal WHERE id = ?').get(id) as ExecutionJournalRow | undefined;
  if (!current) return;
  getDb()
    .prepare('UPDATE execution_journal SET status = ?, tx_hash = ?, trade_id = ?, error = ?, updated_at = ? WHERE id = ?')
    .run(
      fields.status ?? current.status,
      fields.tx_hash ?? current.tx_hash,
      fields.trade_id ?? current.trade_id,
      fields.error ?? current.error,
      Date.now(),
      id
    );
}

export function markBroadcast(id: string, txHash: string): void {
  updateJournal(id, { status: 'broadcast', tx_hash: txHash });
}

export function markRecorded(id: string, tradeId: string): void {
  updateJournal(id, { status: 'recorded', trade_id: tradeId });
}

function setJournalStatus(id: string, status: ExecutionJournalStatus, error?: string): void {
  updateJournal(id, { status, error });
}

function recoverJournalEntry(j: ExecutionJournalRow, txHash: string): { recovered: boolean; error?: string } {
  const db = getDb();
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(j.agent_id) as AgentRow | undefined;
  if (!row) {
    setJournalStatus(j.id, 'failed', 'agent no longer exists');
    return { recovered: false, error: 'agent no longer exists' };
  }
  // tx_hash has a unique index — if a trade with this hash already exists (the crash happened
  // *after* the DB write but before the journal update), this is a no-op, just close the row.
  const existingTrade = db.prepare('SELECT id FROM trades WHERE tx_hash = ?').get(txHash) as { id: string } | undefined;
  if (existingTrade) {
    markRecorded(j.id, existingTrade.id);
    return { recovered: true };
  }
  try {
    const { tradeId } = recordCompletedTrade({
      row,
      strategyId: j.strategy_id,
      side: j.side,
      pair: j.pair,
      amount: j.amount,
      price: j.price,
      txHash,
      mode: j.mode,
      eventType: j.side === 'buy' ? 'trade_opened' : 'trade_closed',
      message: `Reconciled after crash: ${j.side} ${j.amount} ${j.pair} @ ${j.price}. Tx: ${txHash}`,
    });
    markRecorded(j.id, tradeId);
    logEvent({
      agentId: j.agent_id,
      owner: j.owner,
      eventType: j.side === 'buy' ? 'trade_opened' : 'trade_closed',
      mode: j.mode,
      strategyId: j.strategy_id,
      mpcAccount: row.public_key,
      pair: j.pair,
      signal: j.side,
      executionStatus: 'success',
      txHash,
      message: `Recovered execution journal entry ${j.id} after restart`,
    });
    return { recovered: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setJournalStatus(j.id, 'failed', message);
    return { recovered: false, error: message };
  }
}

/**
 * Runs once at process start (see index.ts). Two recoverable states:
 *  - 'broadcast': tx_hash was captured locally but never confirmed durable via
 *    `recordCompletedTrade`. Verified against Horizon (`verifyTransactionOnHorizon`) before
 *    replay — a locally-captured hash that Horizon doesn't confirm as successful is marked
 *    'failed' instead of trusted blindly.
 *  - 'pending' older than a grace window: no tx_hash was ever captured locally (crashed before
 *    or during submission). `findBroadcastAfter` makes one best-effort Horizon search for a
 *    transaction that landed on the agent's account after the journal opened — this recovers
 *    the case where the broadcast actually succeeded but the response never reached this
 *    process. If nothing is found, marked 'failed' and surfaced via audit log for manual
 *    review — never blindly resubmitted, which could double-spend if the original landed.
 */
export async function reconcilePendingExecutions(): Promise<{ recovered: number; markedFailed: number }> {
  const db = getDb();
  const stuckBroadcast = db
    .prepare("SELECT * FROM execution_journal WHERE status = 'broadcast'")
    .all() as ExecutionJournalRow[];

  let recovered = 0;
  let markedFailed = 0;

  for (const j of stuckBroadcast) {
    if (!j.tx_hash) {
      setJournalStatus(j.id, 'failed', "status was 'broadcast' with no tx_hash — inconsistent journal row");
      markedFailed++;
      continue;
    }
    const verified = await verifyTransactionOnHorizon(j.tx_hash);
    if (!verified) {
      setJournalStatus(j.id, 'failed', `Horizon did not confirm tx_hash ${j.tx_hash} as successful`);
      markedFailed++;
      continue;
    }
    const result = recoverJournalEntry(j, j.tx_hash);
    if (result.recovered) recovered++;
    else markedFailed++;
  }

  const GRACE_MS = 5 * 60 * 1000;
  const cutoff = Date.now() - GRACE_MS;
  const stuckPending = db
    .prepare("SELECT * FROM execution_journal WHERE status = 'pending' AND created_at < ?")
    .all(cutoff) as ExecutionJournalRow[];

  for (const j of stuckPending) {
    const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(j.agent_id) as AgentRow | undefined;
    // Paper mode never touches Horizon — nothing to search for, a stuck 'pending' paper row is
    // simply an interrupted simulation.
    const foundHash = j.mode === 'live' && row ? await findBroadcastAfter(row.public_key, j.created_at) : null;

    if (foundHash) {
      const result = recoverJournalEntry(j, foundHash);
      if (result.recovered) {
        recovered++;
        continue;
      }
    }

    setJournalStatus(j.id, 'failed', 'no broadcast confirmation before restart — needs manual reconciliation against Horizon');
    if (row) {
      logEvent({
        agentId: j.agent_id,
        owner: j.owner,
        eventType: 'strategy_error',
        mode: j.mode,
        strategyId: j.strategy_id,
        mpcAccount: row.public_key,
        pair: j.pair,
        message: `Execution journal entry ${j.id} stuck 'pending' across restart — unresolved broadcast, manual review needed`,
      });
    }
    markedFailed++;
  }

  return { recovered, markedFailed };
}
