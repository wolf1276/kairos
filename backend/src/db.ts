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
  mode: 'paper' | 'live';
}

export type AgentMode = 'paper' | 'live';

/** Autonomous role of an agent. `null` = a legacy/manual agent (strategy/intent launcher),
 *  kept working unchanged. The three fixed roles are auto-provisioned per wallet. */
export type AgentRole = 'yield' | 'strategic' | 'balancer';

export interface AgentRow {
  id: string;
  owner: string;
  public_key: string;
  /** null for legacy manual agents; one of the three roles for autonomous agents. */
  role: AgentRole | null;
  // Exactly one of these two identifies how to sign for this agent. New agents are always
  // Turnkey-backed (turnkey_private_key_id set, encrypted_secret ''); encrypted_secret is
  // kept only so agents created before Turnkey integration keep working — see
  // agentService.getAgentSigner.
  encrypted_secret: string;
  turnkey_private_key_id: string | null;
  status: AgentStatus;
  delegator: string | null;
  strategy: string | null;
  strategy_config_json: string | null;
  last_tick_at: number | null;
  last_result: string | null;
  last_error: string | null;
  created_at: number;
  mode: AgentMode;
  capital: string | null;
  risk_level: string | null;
  started_at: number | null;
}

export interface UserRow {
  public_key: string;
  created_at: number;
  last_login_at: number | null;
}

export interface AuthChallengeRow {
  public_key: string;
  nonce: string;
  expires_at: number;
}

export type PositionSide = 'long';

export interface PositionRow {
  id: string;
  agent_id: string;
  pair: string;
  side: PositionSide;
  open_amount: string;
  avg_cost: string;
  realized_pnl_total: string;
  updated_at: number;
}

export type AuditEventType =
  | 'strategy_started'
  | 'strategy_stopped'
  | 'strategy_error'
  | 'signal_generated'
  | 'policy_violation'
  | 'delegation_invalid'
  | 'trade_executed'
  | 'position_updated'
  // Autonomous multi-agent lifecycle events (see roleTick.ts).
  | 'agent_provisioned'
  | 'market_analysis'
  | 'decision_made'
  | 'strategy_selected'
  | 'yield_opportunity'
  | 'portfolio_rebalanced'
  | 'policy_check'
  | 'delegation_check'
  | 'risk_check'
  | 'trade_opened'
  | 'trade_closed';

export interface AuditLogRow {
  id: string;
  agent_id: string;
  owner: string;
  event_type: AuditEventType;
  mode: string | null;
  strategy_id: string | null;
  mpc_account: string | null;
  pair: string | null;
  market_snapshot_json: string | null;
  indicators_json: string | null;
  signal: string | null;
  policy_validation_json: string | null;
  delegation_validation_json: string | null;
  execution_status: string | null;
  tx_hash: string | null;
  position_after_json: string | null;
  pnl_after_json: string | null;
  message: string | null;
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

/** One persisted LLM/heuristic decision — the full replayable reasoning record for a role tick.
 *  Superset of what audit_log captures: stores the prompt/response and structured action. */
export interface DecisionRow {
  id: string;
  agent_id: string;
  owner: string;
  role: AgentRole;
  mode: string;
  pair: string;
  market_snapshot_json: string | null;
  oracle_json: string | null;
  indicators_json: string | null;
  regime_json: string | null;
  llm_model: string | null;
  llm_prompt_summary: string | null;
  llm_response_json: string | null;
  action: string;
  selected_strategy: string | null;
  confidence: number;
  reasoning: string;
  policy_validation_json: string | null;
  delegation_validation_json: string | null;
  risk_json: string | null;
  execution_result: string | null;
  trade_id: string | null;
  position_before_json: string | null;
  position_after_json: string | null;
  pnl_before_json: string | null;
  pnl_after_json: string | null;
  created_at: number;
}

export interface PerformanceSnapshotRow {
  id: string;
  agent_id: string;
  owner: string;
  realized_pnl: string;
  unrealized_pnl: string;
  open_position: string;
  trade_count: number;
  win_rate: number;
  capital_managed: string | null;
  created_at: number;
}

/** Per-owner portfolio target + last-known allocation. One row per owner. */
export interface PortfolioStateRow {
  owner: string;
  target_xlm_pct: number;
  target_usdc_pct: number;
  drift_threshold_pct: number;
  last_allocation_json: string | null;
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
    CREATE TABLE IF NOT EXISTS users (
      public_key TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      last_login_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS auth_challenges (
      public_key TEXT PRIMARY KEY,
      nonce TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      pair TEXT NOT NULL,
      side TEXT NOT NULL,
      open_amount TEXT NOT NULL,
      avg_cost TEXT NOT NULL,
      realized_pnl_total TEXT NOT NULL DEFAULT '0',
      updated_at INTEGER NOT NULL,
      UNIQUE(agent_id, pair)
    );
    CREATE INDEX IF NOT EXISTS idx_positions_agent ON positions(agent_id);
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      event_type TEXT NOT NULL,
      mode TEXT,
      strategy_id TEXT,
      mpc_account TEXT,
      pair TEXT,
      market_snapshot_json TEXT,
      indicators_json TEXT,
      signal TEXT,
      policy_validation_json TEXT,
      delegation_validation_json TEXT,
      execution_status TEXT,
      tx_hash TEXT,
      position_after_json TEXT,
      pnl_after_json TEXT,
      message TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log(agent_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_owner ON audit_log(owner, created_at);
    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      role TEXT NOT NULL,
      mode TEXT NOT NULL,
      pair TEXT NOT NULL,
      market_snapshot_json TEXT,
      oracle_json TEXT,
      indicators_json TEXT,
      regime_json TEXT,
      llm_model TEXT,
      llm_prompt_summary TEXT,
      llm_response_json TEXT,
      action TEXT NOT NULL,
      selected_strategy TEXT,
      confidence REAL NOT NULL DEFAULT 0,
      reasoning TEXT NOT NULL DEFAULT '',
      policy_validation_json TEXT,
      delegation_validation_json TEXT,
      risk_json TEXT,
      execution_result TEXT,
      trade_id TEXT,
      position_before_json TEXT,
      position_after_json TEXT,
      pnl_before_json TEXT,
      pnl_after_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_decisions_agent ON decisions(agent_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_decisions_owner ON decisions(owner, created_at);
    CREATE TABLE IF NOT EXISTS performance_snapshots (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      realized_pnl TEXT NOT NULL,
      unrealized_pnl TEXT NOT NULL,
      open_position TEXT NOT NULL,
      trade_count INTEGER NOT NULL,
      win_rate REAL NOT NULL,
      capital_managed TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_perf_agent ON performance_snapshots(agent_id, created_at);
    CREATE TABLE IF NOT EXISTS portfolio_state (
      owner TEXT PRIMARY KEY,
      target_xlm_pct REAL NOT NULL DEFAULT 50,
      target_usdc_pct REAL NOT NULL DEFAULT 50,
      drift_threshold_pct REAL NOT NULL DEFAULT 10,
      last_allocation_json TEXT,
      updated_at INTEGER NOT NULL
    );
  `);

  const agentCols0 = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
  if (!agentCols0.some((c) => c.name === 'role')) {
    db.exec('ALTER TABLE agents ADD COLUMN role TEXT');
  }

  // Pre-existing databases (created before the shared wallet_delegations table) won't have
  // this column from CREATE TABLE IF NOT EXISTS alone — add it if missing. Old
  // delegation_hash/delegation_json columns, if present, are left in place; see
  // scripts/migrate-wallet-delegations.ts for backfilling them into wallet_delegations.
  const columns = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
  if (!columns.some((c) => c.name === 'delegator')) {
    db.exec('ALTER TABLE agents ADD COLUMN delegator TEXT');
  }
  if (!columns.some((c) => c.name === 'turnkey_private_key_id')) {
    db.exec('ALTER TABLE agents ADD COLUMN turnkey_private_key_id TEXT');
  }
  if (!columns.some((c) => c.name === 'mode')) {
    db.exec("ALTER TABLE agents ADD COLUMN mode TEXT NOT NULL DEFAULT 'live'");
  }
  if (!columns.some((c) => c.name === 'capital')) {
    db.exec('ALTER TABLE agents ADD COLUMN capital TEXT');
  }
  if (!columns.some((c) => c.name === 'risk_level')) {
    db.exec('ALTER TABLE agents ADD COLUMN risk_level TEXT');
  }
  if (!columns.some((c) => c.name === 'started_at')) {
    db.exec('ALTER TABLE agents ADD COLUMN started_at INTEGER');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_agents_delegator ON agents(delegator)');

  const tradeColumns = db.prepare("PRAGMA table_info(trades)").all() as { name: string }[];
  if (!tradeColumns.some((c) => c.name === 'mode')) {
    db.exec("ALTER TABLE trades ADD COLUMN mode TEXT NOT NULL DEFAULT 'live'");
  }

  return db;
}

export function upsertUser(publicKey: string): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO users (public_key, created_at, last_login_at) VALUES (@publicKey, @now, @now)
       ON CONFLICT(public_key) DO UPDATE SET last_login_at = @now`
    )
    .run({ publicKey, now });
}

export function setAuthChallenge(publicKey: string, nonce: string, expiresAt: number): void {
  getDb()
    .prepare(
      `INSERT INTO auth_challenges (public_key, nonce, expires_at) VALUES (@publicKey, @nonce, @expiresAt)
       ON CONFLICT(public_key) DO UPDATE SET nonce = @nonce, expires_at = @expiresAt`
    )
    .run({ publicKey, nonce, expiresAt });
}

export function getAuthChallenge(publicKey: string): AuthChallengeRow | undefined {
  return getDb().prepare('SELECT * FROM auth_challenges WHERE public_key = ?').get(publicKey) as
    | AuthChallengeRow
    | undefined;
}

export function deleteAuthChallenge(publicKey: string): void {
  getDb().prepare('DELETE FROM auth_challenges WHERE public_key = ?').run(publicKey);
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

export function getPortfolioState(owner: string): PortfolioStateRow | undefined {
  return getDb().prepare('SELECT * FROM portfolio_state WHERE owner = ?').get(owner) as PortfolioStateRow | undefined;
}

export function upsertPortfolioState(
  owner: string,
  fields: { targetXlmPct?: number; targetUsdcPct?: number; driftThresholdPct?: number; lastAllocationJson?: string }
): void {
  const existing = getPortfolioState(owner);
  const targetXlmPct = fields.targetXlmPct ?? existing?.target_xlm_pct ?? 50;
  const targetUsdcPct = fields.targetUsdcPct ?? existing?.target_usdc_pct ?? 50;
  const driftThresholdPct = fields.driftThresholdPct ?? existing?.drift_threshold_pct ?? 10;
  const lastAllocationJson = fields.lastAllocationJson ?? existing?.last_allocation_json ?? null;
  getDb()
    .prepare(
      `INSERT INTO portfolio_state (owner, target_xlm_pct, target_usdc_pct, drift_threshold_pct, last_allocation_json, updated_at)
       VALUES (@owner, @targetXlmPct, @targetUsdcPct, @driftThresholdPct, @lastAllocationJson, @now)
       ON CONFLICT(owner) DO UPDATE SET target_xlm_pct = @targetXlmPct, target_usdc_pct = @targetUsdcPct,
         drift_threshold_pct = @driftThresholdPct, last_allocation_json = @lastAllocationJson, updated_at = @now`
    )
    .run({ owner, targetXlmPct, targetUsdcPct, driftThresholdPct, lastAllocationJson, now: Date.now() });
}
