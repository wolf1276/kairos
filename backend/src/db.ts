import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { getDbPath } from './config.js';
import type { ProtocolId, ProtocolPositionKind } from '@wolf1276/kairos-sdk';

export type { ProtocolId, ProtocolPositionKind };

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
  lock_token: string | null;
  lock_expires_at: number | null;
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

/** One delegation per (delegator wallet, delegate agent) pair — each agent tied to a wallet
 *  holds its own independent spend delegation, so multiple agents (e.g. the 3 autonomous role
 *  agents) can each have live spend authority from the same smart wallet simultaneously. */
export interface SmartWalletRow {
  owner: string;
  address: string;
  label: string | null;
  /** Stellar network this smart wallet was deployed on (e.g. "testnet") — null for rows
   *  registered before this column existed. */
  network: string | null;
  created_at: number;
  updated_at: number;
}

export interface WalletDelegationRow {
  delegator: string;
  delegate: string;
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

export type ExecutionJournalStatus = 'pending' | 'broadcast' | 'recorded' | 'failed';

/**
 * Execution journal (outbox pattern) — one row per intended trade, written *before* the
 * on-chain/paper broadcast and updated after. Closes the "broadcast succeeded but DB write
 * failed" gap: if the process crashes between a successful Horizon submission and
 * `recordCompletedTrade`'s insert into `trades`, the journal row is left at 'broadcast' with
 * the real `tx_hash` already captured, and `reconcilePendingExecutions()` (run at scheduler
 * start) replays it into `trades`/`positions` instead of losing it or letting the next tick
 * blindly resubmit. Rows still at 'pending' after a crash never reached broadcast confirmation
 * (or genuinely never sent) — recorded as 'failed' since there is no tx_hash to reconcile
 * against, surfaced via audit log for manual review rather than silently retried (a blind
 * resubmit could double-spend if the original broadcast actually landed).
 */
export interface ExecutionJournalRow {
  id: string;
  agent_id: string;
  owner: string;
  role: string | null;
  pair: string;
  side: TradeSide;
  amount: string;
  price: string;
  strategy_id: string;
  mode: 'paper' | 'live';
  status: ExecutionJournalStatus;
  tx_hash: string | null;
  trade_id: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
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

/** One open position an agent holds in an external protocol (Blend, Soroswap, ...), reached via
 *  the delegation/redemption execution path (see protocolExecutionService.ts) rather than the
 *  legacy direct-custody trading loop. Upserted after every protocol execution. */
export interface ProtocolPositionRow {
  id: string;
  agent_id: string;
  owner: string;
  protocol_id: ProtocolId;
  kind: ProtocolPositionKind;
  asset: string;
  amount: string;
  updated_at: number;
  created_at: number;
}

export type ProtocolExecutionJournalStatus = 'pending' | 'broadcast' | 'recorded' | 'failed';

/**
 * Outbox pattern for protocol executions (Blend/Soroswap via delegation redemption), mirroring
 * `ExecutionJournalRow`'s rationale for the legacy trade path. Opened as 'pending' before
 * `client.execution.execute` is submitted. Once execution confirms on-chain, `tx_hash` is
 * captured and status moves to 'broadcast' — the risk window that remains is a crash between
 * that on-chain confirmation and the local position/audit write. `applyProtocolExecutionRecord`
 * (protocolPositionService.ts) makes that transition atomic (SQLite transaction covering both
 * the `protocol_positions` delta and this row's move to 'recorded'), and
 * `reconcilePendingProtocolExecutions` (run at startup, see index.ts) replays any row still
 * stuck at 'broadcast' — since it has a captured `tx_hash`, we know the trade landed and just
 * need to finish applying it locally, exactly once (guarded by the unique index below and by
 * only ever applying a delta while the row's status is still 'broadcast').
 */
export interface ProtocolExecutionJournalRow {
  id: string;
  agent_id: string;
  owner: string;
  protocol_id: ProtocolId;
  action: string;
  asset: string;
  kind: ProtocolPositionKind;
  delta: string;
  status: ProtocolExecutionJournalStatus;
  tx_hash: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
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

/**
 * SQLite can't ALTER TABLE ADD CONSTRAINT — a table created before this migration existed has
 * no FOREIGN KEY clause and adding one requires rebuilding it (create-with-FK, copy, drop,
 * rename). Runs once per table (skipped if `PRAGMA foreign_key_list` already shows the FK),
 * so it's a no-op on every startup after the first. FK enforcement is switched off for the
 * copy — pre-existing orphaned rows (agent_id pointing at a since-deleted agent, from before
 * this migration existed) must not block startup — then back on before the process serves
 * any traffic.
 */
/**
 * `wallet_delegations` used to be keyed by `delegator` alone (one delegation per wallet, shared
 * across every agent) — that meant a second agent could never get its own live delegation from
 * the same wallet without first revoking the first agent's, breaking every other agent that
 * wallet had already delegated to. Rebuilds the table keyed by (delegator, delegate) instead,
 * backfilling `delegate` from each row's own `delegation_json.delegate` field (the delegation
 * struct always carries its own delegate address, so no data is lost). Skipped on fresh DBs —
 * the CREATE TABLE above already creates the new shape directly.
 */
function migrateWalletDelegationsToPerAgent(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(wallet_delegations)").all() as { name: string }[];
  if (columns.some((c) => c.name === 'delegate')) return; // already migrated (or fresh DB)

  const rows = db.prepare('SELECT * FROM wallet_delegations').all() as {
    delegator: string;
    delegation_hash: string;
    delegation_json: string;
    disabled: 0 | 1;
    updated_at: number;
  }[];

  db.exec(`
    CREATE TABLE wallet_delegations_new (
      delegator TEXT NOT NULL,
      delegate TEXT NOT NULL,
      delegation_hash TEXT NOT NULL,
      delegation_json TEXT NOT NULL,
      disabled INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (delegator, delegate)
    );
  `);

  const insert = db.prepare(
    `INSERT INTO wallet_delegations_new (delegator, delegate, delegation_hash, delegation_json, disabled, updated_at)
     VALUES (@delegator, @delegate, @delegation_hash, @delegation_json, @disabled, @updated_at)`
  );
  const migrate = db.transaction(() => {
    for (const row of rows) {
      let delegate: string | null = null;
      try {
        delegate = (JSON.parse(row.delegation_json) as { delegate?: string }).delegate ?? null;
      } catch {
        // malformed JSON — unrecoverable, drop this row rather than fail the whole migration.
      }
      if (!delegate) continue;
      insert.run({ ...row, delegate });
    }
    db.exec('DROP TABLE wallet_delegations');
    db.exec('ALTER TABLE wallet_delegations_new RENAME TO wallet_delegations');
  });
  migrate();
}

function addForeignKeys(db: Database.Database): void {
  const hasFk = (table: string): boolean => (db.prepare(`PRAGMA foreign_key_list(${table})`).all() as unknown[]).length > 0;

  const rebuilds: { table: string; createSql: string; columns: string }[] = [
    {
      table: 'trades',
      columns: 'id, agent_id, strategy_id, side, pair, amount, price, tx_hash, status, realized_pnl, reversed_trade_id, created_at, mode',
      createSql: `CREATE TABLE trades_new (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
        strategy_id TEXT NOT NULL,
        side TEXT NOT NULL,
        pair TEXT NOT NULL,
        amount TEXT NOT NULL,
        price TEXT NOT NULL,
        tx_hash TEXT,
        status TEXT NOT NULL,
        realized_pnl TEXT,
        reversed_trade_id TEXT REFERENCES trades(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        mode TEXT NOT NULL DEFAULT 'live'
      )`,
    },
    {
      table: 'positions',
      columns: 'id, agent_id, pair, side, open_amount, avg_cost, realized_pnl_total, updated_at',
      createSql: `CREATE TABLE positions_new (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        pair TEXT NOT NULL,
        side TEXT NOT NULL,
        open_amount TEXT NOT NULL,
        avg_cost TEXT NOT NULL,
        realized_pnl_total TEXT NOT NULL DEFAULT '0',
        updated_at INTEGER NOT NULL,
        UNIQUE(agent_id, pair)
      )`,
    },
    {
      table: 'decisions',
      columns:
        'id, agent_id, owner, role, mode, pair, market_snapshot_json, oracle_json, indicators_json, regime_json, llm_model, llm_prompt_summary, llm_response_json, action, selected_strategy, confidence, reasoning, policy_validation_json, delegation_validation_json, risk_json, execution_result, trade_id, position_before_json, position_after_json, pnl_before_json, pnl_after_json, created_at',
      createSql: `CREATE TABLE decisions_new (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
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
        trade_id TEXT REFERENCES trades(id) ON DELETE SET NULL,
        position_before_json TEXT,
        position_after_json TEXT,
        pnl_before_json TEXT,
        pnl_after_json TEXT,
        created_at INTEGER NOT NULL
      )`,
    },
    {
      table: 'audit_log',
      columns:
        'id, agent_id, owner, event_type, mode, strategy_id, mpc_account, pair, market_snapshot_json, indicators_json, signal, policy_validation_json, delegation_validation_json, execution_status, tx_hash, position_after_json, pnl_after_json, message, created_at',
      createSql: `CREATE TABLE audit_log_new (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
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
      )`,
    },
    {
      table: 'performance_snapshots',
      columns: 'id, agent_id, owner, realized_pnl, unrealized_pnl, open_position, trade_count, win_rate, capital_managed, created_at',
      createSql: `CREATE TABLE performance_snapshots_new (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        owner TEXT NOT NULL,
        realized_pnl TEXT NOT NULL,
        unrealized_pnl TEXT NOT NULL,
        open_position TEXT NOT NULL,
        trade_count INTEGER NOT NULL,
        win_rate REAL NOT NULL,
        capital_managed TEXT,
        created_at INTEGER NOT NULL
      )`,
    },
  ];

  const pending = rebuilds.filter((r) => !hasFk(r.table));
  if (pending.length === 0) return;

  db.pragma('foreign_keys = OFF');
  const migrate = db.transaction(() => {
    for (const r of pending) {
      db.exec(r.createSql);
      // Orphaned rows referencing a since-deleted agent can't satisfy the new FK — drop them
      // rather than fail the whole migration; they were already unreachable via any app query
      // (every read is scoped by a live agent/owner join).
      db.exec(`INSERT INTO ${r.table}_new (${r.columns}) SELECT ${r.columns} FROM ${r.table} WHERE agent_id IN (SELECT id FROM agents)`);
      db.exec(`DROP TABLE ${r.table}`);
      db.exec(`ALTER TABLE ${r.table}_new RENAME TO ${r.table}`);
    }
  });
  migrate();
  db.pragma('foreign_keys = ON');

  // Indexes are dropped along with the old table — recreate them.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_trades_agent ON trades(agent_id);
    CREATE INDEX IF NOT EXISTS idx_positions_agent ON positions(agent_id);
    CREATE INDEX IF NOT EXISTS idx_decisions_agent ON decisions(agent_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_decisions_owner ON decisions(owner, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log(agent_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_owner ON audit_log(owner, created_at);
    CREATE INDEX IF NOT EXISTS idx_perf_agent ON performance_snapshots(agent_id, created_at);
  `);
}

/**
 * SQLite scaling ceiling — read this before assuming this file can carry production traffic
 * indefinitely. better-sqlite3 is a single-file, single-writer database: every write (agent
 * ticks, trades, audit_log, decisions) across every user and process funnels through one file
 * lock. WAL mode lets readers proceed concurrently with a writer, but writers still serialize.
 * `claimAgentLock`/`releaseAgentLock` (agentService.ts) make concurrent *processes* correctness-
 * safe (no double-ticking), but they don't remove the throughput ceiling — they just make
 * contention safe to wait out via `busy_timeout` below instead of racing.
 * Rule of thumb for when this stops being enough: sustained write concurrency approaching
 * roughly 50-100 writes/sec (rough SQLite/WAL ceiling on typical disks) — with audit_log +
 * decisions + trades all writing per tick, that's on the order of a few hundred concurrently
 * ticking agents at a several-second tick interval. Past that, writers start queuing behind
 * `busy_timeout` and tick latency grows. At that point this needs a real migration to a
 * multi-writer database (e.g. Postgres) with connection pooling — a larger, separate effort
 * (every query here is synchronous; a pg client is async, so it's not a drop-in swap).
 */
export function getDb(): Database.Database {
  if (db) return db;
  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Under write contention (multiple processes/ticks hitting the same file), a writer that
  // can't immediately acquire the lock throws SQLITE_BUSY by default. busy_timeout makes it
  // block and retry for up to 5s instead, so a scheduler tick waits out brief contention
  // instead of hard-failing an agent's trade with a transient lock error.
  db.pragma('busy_timeout = 5000');
  // NORMAL is safe (not just fast) under WAL: the WAL file itself still fsyncs on checkpoint,
  // so a power loss can lose only the last few committed transactions, never corrupt the DB.
  db.pragma('synchronous = NORMAL');

  // Pre-existing databases from before the capital_wallets -> smart_wallets rename. Must run
  // before the CREATE TABLE IF NOT EXISTS smart_wallets below, otherwise that statement creates
  // an empty smart_wallets table first and this rename then collides with it.
  const hasLegacyCapitalWalletsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'capital_wallets'")
    .get();
  if (hasLegacyCapitalWalletsTable) {
    db.exec('ALTER TABLE capital_wallets RENAME TO smart_wallets');
  }

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
      delegator TEXT NOT NULL,
      delegate TEXT NOT NULL,
      delegation_hash TEXT NOT NULL,
      delegation_json TEXT NOT NULL,
      disabled INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (delegator, delegate)
    );
    CREATE TABLE IF NOT EXISTS smart_wallets (
      owner TEXT NOT NULL,
      address TEXT NOT NULL,
      label TEXT,
      network TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (owner, address)
    );
    CREATE INDEX IF NOT EXISTS idx_smart_wallets_owner ON smart_wallets(owner);
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
    CREATE TABLE IF NOT EXISTS execution_journal (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
      owner TEXT NOT NULL,
      role TEXT,
      pair TEXT NOT NULL,
      side TEXT NOT NULL,
      amount TEXT NOT NULL,
      price TEXT NOT NULL,
      strategy_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      tx_hash TEXT,
      trade_id TEXT REFERENCES trades(id) ON DELETE SET NULL,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_journal_agent ON execution_journal(agent_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_journal_status ON execution_journal(status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_txhash ON execution_journal(tx_hash) WHERE tx_hash IS NOT NULL;
    CREATE TABLE IF NOT EXISTS protocol_positions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      protocol_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      asset TEXT NOT NULL,
      amount TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(agent_id, protocol_id, asset)
    );
    CREATE INDEX IF NOT EXISTS idx_protocol_positions_agent ON protocol_positions(agent_id);
    CREATE INDEX IF NOT EXISTS idx_protocol_positions_owner ON protocol_positions(owner);
    CREATE TABLE IF NOT EXISTS protocol_execution_journal (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
      owner TEXT NOT NULL,
      protocol_id TEXT NOT NULL,
      action TEXT NOT NULL,
      asset TEXT NOT NULL,
      kind TEXT NOT NULL,
      delta TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      tx_hash TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_protocol_journal_agent ON protocol_execution_journal(agent_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_protocol_journal_status ON protocol_execution_journal(status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_protocol_journal_txhash ON protocol_execution_journal(tx_hash) WHERE tx_hash IS NOT NULL;
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
  // Distributed tick lock: lets the scheduler claim an agent atomically via a conditional
  // UPDATE, so running >1 backend process against the same DB file can't double-tick the
  // same agent. See claimAgentLock/releaseAgentLock.
  if (!columns.some((c) => c.name === 'lock_token')) {
    db.exec('ALTER TABLE agents ADD COLUMN lock_token TEXT');
  }
  if (!columns.some((c) => c.name === 'lock_expires_at')) {
    db.exec('ALTER TABLE agents ADD COLUMN lock_expires_at INTEGER');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_agents_delegator ON agents(delegator)');

  const tradeColumns = db.prepare("PRAGMA table_info(trades)").all() as { name: string }[];
  if (!tradeColumns.some((c) => c.name === 'mode')) {
    db.exec("ALTER TABLE trades ADD COLUMN mode TEXT NOT NULL DEFAULT 'live'");
  }

  // Pre-existing databases (created before onboarding recorded a network/last-updated time)
  // won't have these from CREATE TABLE IF NOT EXISTS alone.
  const smartWalletColumns = db.prepare("PRAGMA table_info(smart_wallets)").all() as { name: string }[];
  if (!smartWalletColumns.some((c) => c.name === 'network')) {
    db.exec('ALTER TABLE smart_wallets ADD COLUMN network TEXT');
  }
  if (!smartWalletColumns.some((c) => c.name === 'updated_at')) {
    db.exec('ALTER TABLE smart_wallets ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0');
  }

  migrateWalletDelegationsToPerAgent(db);
  addForeignKeys(db);

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

export function listSmartWallets(owner: string): SmartWalletRow[] {
  return getDb().prepare('SELECT * FROM smart_wallets WHERE owner = ? ORDER BY created_at ASC').all(owner) as SmartWalletRow[];
}

/** Idempotent — re-registering an address already on file for this owner just updates its
 *  label/network and bumps updated_at. */
export function upsertSmartWallet(owner: string, address: string, label: string | null, network: string | null = null): void {
  getDb()
    .prepare(
      `INSERT INTO smart_wallets (owner, address, label, network, created_at, updated_at)
       VALUES (@owner, @address, @label, @network, @now, @now)
       ON CONFLICT(owner, address) DO UPDATE SET label = @label, network = COALESCE(@network, network), updated_at = @now`
    )
    .run({ owner, address, label, network, now: Date.now() });
}

export function getWalletDelegation(delegator: string, delegate: string): WalletDelegationRow | undefined {
  return getDb().prepare('SELECT * FROM wallet_delegations WHERE delegator = ? AND delegate = ?').get(delegator, delegate) as
    | WalletDelegationRow
    | undefined;
}

export function listWalletDelegationsForDelegator(delegator: string): WalletDelegationRow[] {
  return getDb().prepare('SELECT * FROM wallet_delegations WHERE delegator = ?').all(delegator) as WalletDelegationRow[];
}

/** Creates or replaces this agent's delegation from this wallet — independent of any other
 *  agent's delegation from the same wallet (see WalletDelegationRow's composite key doc). */
export function upsertWalletDelegation(delegator: string, delegate: string, hash: string, delegationJson: string): void {
  getDb()
    .prepare(
      `INSERT INTO wallet_delegations (delegator, delegate, delegation_hash, delegation_json, disabled, updated_at)
       VALUES (@delegator, @delegate, @hash, @delegationJson, 0, @now)
       ON CONFLICT(delegator, delegate) DO UPDATE SET delegation_hash = @hash, delegation_json = @delegationJson, disabled = 0, updated_at = @now`
    )
    .run({ delegator, delegate, hash, delegationJson, now: Date.now() });
}

export function setWalletDelegationDisabled(delegator: string, delegate: string, disabled: boolean): void {
  getDb()
    .prepare('UPDATE wallet_delegations SET disabled = ?, updated_at = ? WHERE delegator = ? AND delegate = ?')
    .run(disabled ? 1 : 0, Date.now(), delegator, delegate);
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
