// Shared test fixtures — inserts agent rows directly via SQL rather than agentService.createAgent,
// which calls out to Turnkey + Friendbot over the network. Every field mirrors db.ts's AgentRow
// shape exactly, so the rows these tests exercise are indistinguishable from ones a real
// createAgent() call would have produced.
import { randomUUID } from 'crypto';
import type { Database } from 'better-sqlite3';
import type { AgentRow, AgentMode, AgentRole } from '../db.js';

export function insertAgent(
  db: Database,
  overrides: Partial<AgentRow> & { owner: string }
): AgentRow {
  const row: AgentRow = {
    id: overrides.id ?? randomUUID(),
    owner: overrides.owner,
    public_key: overrides.public_key ?? `G${randomUUID().replace(/-/g, '').slice(0, 55).toUpperCase()}`,
    role: overrides.role ?? null,
    encrypted_secret: overrides.encrypted_secret ?? '',
    turnkey_private_key_id: overrides.turnkey_private_key_id ?? 'test-key-id',
    status: overrides.status ?? 'running',
    delegator: overrides.delegator ?? null,
    strategy: overrides.strategy ?? 'role',
    strategy_config_json: overrides.strategy_config_json ?? null,
    last_tick_at: overrides.last_tick_at ?? null,
    last_result: overrides.last_result ?? null,
    last_error: overrides.last_error ?? null,
    created_at: overrides.created_at ?? Date.now(),
    mode: overrides.mode ?? ('paper' as AgentMode),
    capital: overrides.capital ?? '1000',
    risk_level: overrides.risk_level ?? null,
    started_at: overrides.started_at ?? Date.now(),
    lock_token: overrides.lock_token ?? null,
    lock_expires_at: overrides.lock_expires_at ?? null,
    policy_json: overrides.policy_json ?? null,
  };
  db.prepare(
    `INSERT INTO agents (id, owner, public_key, role, encrypted_secret, turnkey_private_key_id, status, delegator, strategy, strategy_config_json, last_tick_at, last_result, last_error, created_at, mode, capital, risk_level, started_at, policy_json)
     VALUES (@id, @owner, @public_key, @role, @encrypted_secret, @turnkey_private_key_id, @status, @delegator, @strategy, @strategy_config_json, @last_tick_at, @last_result, @last_error, @created_at, @mode, @capital, @risk_level, @started_at, @policy_json)`
  ).run(row);
  return row;
}

export type { AgentRole };
