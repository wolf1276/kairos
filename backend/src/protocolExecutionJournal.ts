// Outbox pattern for protocol executions (Blend/Soroswap via delegation redemption) — see
// db.ts's ProtocolExecutionJournalRow doc for the full rationale. Mirrors executionJournal.ts's
// pattern for the legacy trade path, adapted for Soroban (no Horizon transaction search: a
// protocol execution's tx hash is captured directly from `client.execution.execute`'s result,
// so the only crash window that needs recovering is between that confirmed on-chain result and
// the local position/audit write — not the submission itself).
import { randomUUID } from 'crypto';
import { getDb, type AgentRow, type ProtocolExecutionJournalRow, type ProtocolExecutionJournalStatus, type ProtocolId, type ProtocolPositionKind } from './db.js';
import { applyProtocolPositionDelta } from './protocolPositionService.js';
import { logEvent } from './auditService.js';

export interface OpenProtocolExecutionInput {
  row: AgentRow;
  protocolId: ProtocolId;
  action: string;
  asset: string;
  kind: ProtocolPositionKind;
  delta: bigint;
}

export function openProtocolExecution(input: OpenProtocolExecutionInput): ProtocolExecutionJournalRow {
  const now = Date.now();
  const journal: ProtocolExecutionJournalRow = {
    id: randomUUID(),
    agent_id: input.row.id,
    owner: input.row.owner,
    protocol_id: input.protocolId,
    action: input.action,
    asset: input.asset,
    kind: input.kind,
    delta: input.delta.toString(),
    status: 'pending',
    tx_hash: null,
    error: null,
    created_at: now,
    updated_at: now,
  };
  getDb()
    .prepare(
      `INSERT INTO protocol_execution_journal (id, agent_id, owner, protocol_id, action, asset, kind, delta, status, tx_hash, error, created_at, updated_at)
       VALUES (@id, @agent_id, @owner, @protocol_id, @action, @asset, @kind, @delta, @status, @tx_hash, @error, @created_at, @updated_at)`
    )
    .run(journal);
  return journal;
}

function updateJournal(id: string, fields: Partial<Pick<ProtocolExecutionJournalRow, 'status' | 'tx_hash' | 'error'>>): void {
  const current = getDb().prepare('SELECT * FROM protocol_execution_journal WHERE id = ?').get(id) as
    | ProtocolExecutionJournalRow
    | undefined;
  if (!current) return;
  getDb()
    .prepare('UPDATE protocol_execution_journal SET status = ?, tx_hash = ?, error = ?, updated_at = ? WHERE id = ?')
    .run(fields.status ?? current.status, fields.tx_hash ?? current.tx_hash, fields.error ?? current.error, Date.now(), id);
}

export function markProtocolExecutionFailed(id: string, error: string): void {
  updateJournal(id, { status: 'failed', error });
}

export function markProtocolExecutionBroadcast(id: string, txHash: string): void {
  updateJournal(id, { status: 'broadcast', tx_hash: txHash });
}

/**
 * Applies the journal row's position delta and marks it 'recorded' atomically — if the process
 * crashes mid-way, SQLite's transaction rolls the whole thing back, so the row is left exactly
 * as it was (still 'broadcast', delta not yet applied) rather than in a half-applied state.
 * A no-op if the row isn't at 'broadcast' (already 'recorded' — this is what makes replaying an
 * already-recovered row from `reconcilePendingProtocolExecutions` safe to call twice).
 */
export function applyProtocolExecutionRecord(id: string): { applied: boolean } {
  const db = getDb();
  const run = db.transaction((journalId: string) => {
    const current = db.prepare('SELECT * FROM protocol_execution_journal WHERE id = ?').get(journalId) as
      | ProtocolExecutionJournalRow
      | undefined;
    if (!current || current.status !== 'broadcast') {
      return false;
    }
    applyProtocolPositionDelta({
      agentId: current.agent_id,
      owner: current.owner,
      protocolId: current.protocol_id,
      kind: current.kind,
      asset: current.asset,
      delta: BigInt(current.delta),
    });
    db.prepare("UPDATE protocol_execution_journal SET status = 'recorded', updated_at = ? WHERE id = ?").run(
      Date.now(),
      journalId
    );
    return true;
  });
  return { applied: run(id) };
}

function setJournalStatus(id: string, status: ProtocolExecutionJournalStatus, error?: string): void {
  updateJournal(id, { status, error });
}

/**
 * Runs once at process start (see index.ts), before the scheduler starts ticking agents.
 *  - 'broadcast': tx_hash was captured, meaning `client.execution.execute` already returned a
 *    confirmed on-chain SUCCESS — the crash happened before the local position/audit write
 *    landed. Safe to replay via `applyProtocolExecutionRecord` since the on-chain effect is
 *    already final; nothing to re-verify (unlike the legacy Horizon path, there's no risk the
 *    broadcast itself never landed, since we only ever capture tx_hash after execute() confirms).
 *  - 'pending' older than a grace window: the process crashed before or during `execute()`
 *    ever returning — we have no tx_hash and therefore no way to know whether the on-chain
 *    call landed. Conservatively marked 'failed' for manual review rather than blindly retried
 *    (retrying an action that actually did land on-chain could double-execute against the
 *    delegation's spend limit).
 */
export function reconcilePendingProtocolExecutions(): { recovered: number; markedFailed: number } {
  const db = getDb();
  let recovered = 0;
  let markedFailed = 0;

  const stuckBroadcast = db
    .prepare("SELECT * FROM protocol_execution_journal WHERE status = 'broadcast'")
    .all() as ProtocolExecutionJournalRow[];

  for (const j of stuckBroadcast) {
    const { applied } = applyProtocolExecutionRecord(j.id);
    if (applied) {
      recovered++;
      logEvent({
        agentId: j.agent_id,
        owner: j.owner,
        eventType: 'position_updated',
        executionStatus: 'success',
        txHash: j.tx_hash ?? undefined,
        message: `Recovered protocol execution journal entry ${j.id} (${j.protocol_id} ${j.action}) after restart`,
      });
    }
  }

  const GRACE_MS = 5 * 60 * 1000;
  const cutoff = Date.now() - GRACE_MS;
  const stuckPending = db
    .prepare("SELECT * FROM protocol_execution_journal WHERE status = 'pending' AND created_at < ?")
    .all(cutoff) as ProtocolExecutionJournalRow[];

  for (const j of stuckPending) {
    setJournalStatus(j.id, 'failed', 'no execution result captured before restart — needs manual reconciliation');
    logEvent({
      agentId: j.agent_id,
      owner: j.owner,
      eventType: 'strategy_error',
      message: `Protocol execution journal entry ${j.id} (${j.protocol_id} ${j.action}) stuck 'pending' across restart — unresolved, manual review needed`,
    });
    markedFailed++;
  }

  return { recovered, markedFailed };
}
