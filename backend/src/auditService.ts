// Append-only lifecycle/execution log — the full audit trail requirement (signal generated,
// market snapshot, policy/delegation validation, execution status, position/PnL after) beyond
// what the `trades` table alone captures (it only records fills). Never throws: a logging
// failure must not break a trade or tick.
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { getDb, type AuditEventType, type AuditLogRow } from './db.js';

export const auditEvents = new EventEmitter();

export interface LogEventInput {
  agentId: string;
  owner: string;
  eventType: AuditEventType;
  mode?: string | null;
  strategyId?: string | null;
  mpcAccount?: string | null;
  pair?: string | null;
  marketSnapshot?: unknown;
  indicators?: unknown;
  signal?: string | null;
  policyValidation?: { ok: boolean; reason?: string } | null;
  delegationValidation?: { ok: boolean; reason?: string } | null;
  executionStatus?: 'success' | 'failed' | 'skipped' | null;
  txHash?: string | null;
  positionAfter?: unknown;
  pnlAfter?: unknown;
  message: string;
}

export function logEvent(input: LogEventInput): void {
  try {
    const row: AuditLogRow = {
      id: randomUUID(),
      agent_id: input.agentId,
      owner: input.owner,
      event_type: input.eventType,
      mode: input.mode ?? null,
      strategy_id: input.strategyId ?? null,
      mpc_account: input.mpcAccount ?? null,
      pair: input.pair ?? null,
      market_snapshot_json: input.marketSnapshot !== undefined ? JSON.stringify(input.marketSnapshot) : null,
      indicators_json: input.indicators !== undefined ? JSON.stringify(input.indicators) : null,
      signal: input.signal ?? null,
      policy_validation_json: input.policyValidation ? JSON.stringify(input.policyValidation) : null,
      delegation_validation_json: input.delegationValidation ? JSON.stringify(input.delegationValidation) : null,
      execution_status: input.executionStatus ?? null,
      tx_hash: input.txHash ?? null,
      position_after_json: input.positionAfter !== undefined ? JSON.stringify(input.positionAfter) : null,
      pnl_after_json: input.pnlAfter !== undefined ? JSON.stringify(input.pnlAfter) : null,
      message: input.message,
      created_at: Date.now(),
    };
    getDb()
      .prepare(
        `INSERT INTO audit_log (id, agent_id, owner, event_type, mode, strategy_id, mpc_account, pair,
          market_snapshot_json, indicators_json, signal, policy_validation_json, delegation_validation_json,
          execution_status, tx_hash, position_after_json, pnl_after_json, message, created_at)
         VALUES (@id, @agent_id, @owner, @event_type, @mode, @strategy_id, @mpc_account, @pair,
          @market_snapshot_json, @indicators_json, @signal, @policy_validation_json, @delegation_validation_json,
          @execution_status, @tx_hash, @position_after_json, @pnl_after_json, @message, @created_at)`
      )
      .run(row);
    auditEvents.emit('event', row);
  } catch (error) {
    console.error('Failed to write audit log entry:', error);
  }
}

export function listAuditForAgent(agentId: string, limit = 100, before?: number): AuditLogRow[] {
  const cutoff = before ?? Number.MAX_SAFE_INTEGER;
  return getDb()
    .prepare('SELECT * FROM audit_log WHERE agent_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?')
    .all(agentId, cutoff, limit) as AuditLogRow[];
}

export function listAuditForOwner(owner: string, limit = 100, before?: number): AuditLogRow[] {
  const cutoff = before ?? Number.MAX_SAFE_INTEGER;
  return getDb()
    .prepare('SELECT * FROM audit_log WHERE owner = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?')
    .all(owner, cutoff, limit) as AuditLogRow[];
}
