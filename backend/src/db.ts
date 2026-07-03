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
  delegation_hash: string | null;
  delegation_json: string | null;
  strategy: string | null;
  strategy_config_json: string | null;
  last_tick_at: number | null;
  last_result: string | null;
  last_error: string | null;
  created_at: number;
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
      delegation_hash TEXT,
      delegation_json TEXT,
      strategy TEXT,
      strategy_config_json TEXT,
      last_tick_at INTEGER,
      last_result TEXT,
      last_error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner);
    CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
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
  return db;
}
