import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { getDbPath } from './config.js';

export type AgentStatus = 'new' | 'running' | 'stopped' | 'error';

export type TradeSide = 'buy' | 'sell';
export type TradeStatus = 'success' | 'failed';

export interface TradeRow {
  id: string;
  agent_id: string;
  strategy_id: string;
  side: TradeSide;
  pair: string;
  amount: string;
  price: string;
  tx_hash: string | null;
  status: TradeStatus;
  realized_pnl: string | null;
  reversed_trade_id: string | null;
  created_at: number;
}

export interface AgentRow {
  id: string;
  owner: string;
  public_key: string;
  encrypted_secret: string;
  status: AgentStatus;
  delegator: string | null;
  strategy: string | null;
  strategy_config_json: string | null;
  last_tick_at: number | null;
  last_result: string | null;
  last_error: string | null;
  created_at: number;
}

/** One delegation per wallet, shared across every agent (autonomous/strategy/intent) for that wallet. */
export interface WalletDelegationRow {
  delegator: string;
  delegation_hash: string;
  delegation_json: string;
  disabled: 0 | 1;
  updated_at: number;
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      public_key TEXT NOT NULL UNIQUE,
      encrypted_secret TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      delegator TEXT,
      strategy TEXT,
      strategy_config_json TEXT,
      last_tick_at INTEGER,
      last_result TEXT,
      last_error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner);
    CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
    CREATE TABLE IF NOT EXISTS wallet_delegations (
      delegator TEXT PRIMARY KEY,
      delegation_hash TEXT NOT NULL,
      delegation_json TEXT NOT NULL,
      disabled INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      strategy_id TEXT NOT NULL,
      side TEXT NOT NULL,
      pair TEXT NOT NULL,
      amount TEXT NOT NULL,
      price TEXT NOT NULL,
      tx_hash TEXT,
      status TEXT NOT NULL,
      realized_pnl TEXT,
      reversed_trade_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trades_agent ON trades(agent_id);
  `);

  // Pre-existing databases (created before the shared wallet_delegations table) won't have
  // this column from CREATE TABLE IF NOT EXISTS alone — add it if missing. Old
  // delegation_hash/delegation_json columns, if present, are left in place; see
  // scripts/migrate-wallet-delegations.ts for backfilling them into wallet_delegations.
  const columns = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
  if (!columns.some((c) => c.name === 'delegator')) {
    db.exec('ALTER TABLE agents ADD COLUMN delegator TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_agents_delegator ON agents(delegator)');

  return db;
}

export function getWalletDelegation(delegator: string): WalletDelegationRow | undefined {
  return getDb().prepare('SELECT * FROM wallet_delegations WHERE delegator = ?').get(delegator) as WalletDelegationRow | undefined;
}

/** Creates or replaces the single active delegation for a wallet (one per wallet, shared by all agents). */
export function upsertWalletDelegation(delegator: string, hash: string, delegationJson: string): void {
  getDb()
    .prepare(
      `INSERT INTO wallet_delegations (delegator, delegation_hash, delegation_json, disabled, updated_at)
       VALUES (@delegator, @hash, @delegationJson, 0, @now)
       ON CONFLICT(delegator) DO UPDATE SET delegation_hash = @hash, delegation_json = @delegationJson, disabled = 0, updated_at = @now`
    )
    .run({ delegator, hash, delegationJson, now: Date.now() });
}

export function setWalletDelegationDisabled(delegator: string, disabled: boolean): void {
  getDb()
    .prepare('UPDATE wallet_delegations SET disabled = ?, updated_at = ? WHERE delegator = ?')
    .run(disabled ? 1 : 0, Date.now(), delegator);
}
