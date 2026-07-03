// Crash/fault recovery tests for the execution journal (outbox pattern) — see
// executionJournal.ts. Each test simulates a specific crash point by hand-crafting a journal
// row in the state a real crash would leave it in, then runs reconcilePendingExecutions() and
// asserts the DB converges to the correct, non-duplicated end state. Horizon is mocked (no
// network in tests) — the fixtures decide what "Horizon says" so each crash scenario is
// deterministic.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

let tmpDir: string;

vi.mock('../horizonReconciliation.js', () => ({
  verifyTransactionOnHorizon: vi.fn(),
  findBroadcastAfter: vi.fn(),
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'kairos-journal-test-'));
  process.env.AGENTS_DB_PATH = path.join(tmpDir, 'agents.db');
  vi.clearAllMocks();
  vi.resetModules();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function insertJournalRow(db: import('better-sqlite3').Database, overrides: Record<string, unknown>) {
  const now = Date.now();
  const row = {
    id: randomUUID(),
    agent_id: overrides.agent_id,
    owner: overrides.owner ?? 'GOWNER',
    role: overrides.role ?? 'strategic',
    pair: overrides.pair ?? 'XLM/USDC',
    side: overrides.side ?? 'buy',
    amount: overrides.amount ?? '10',
    price: overrides.price ?? '0.5',
    strategy_id: overrides.strategy_id ?? 'strategic',
    mode: overrides.mode ?? 'live',
    status: overrides.status ?? 'pending',
    tx_hash: overrides.tx_hash ?? null,
    trade_id: overrides.trade_id ?? null,
    error: overrides.error ?? null,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
  };
  db.prepare(
    `INSERT INTO execution_journal (id, agent_id, owner, role, pair, side, amount, price, strategy_id, mode, status, tx_hash, trade_id, error, created_at, updated_at)
     VALUES (@id, @agent_id, @owner, @role, @pair, @side, @amount, @price, @strategy_id, @mode, @status, @tx_hash, @trade_id, @error, @created_at, @updated_at)`
  ).run(row);
  return row;
}

describe('reconcilePendingExecutions', () => {
  it('replays a broadcast row Horizon confirms into trades (crash after broadcast, before DB write)', async () => {
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { reconcilePendingExecutions } = await import('../executionJournal.js');
    const { verifyTransactionOnHorizon } = await import('../horizonReconciliation.js');
    vi.mocked(verifyTransactionOnHorizon).mockResolvedValue(true);

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GOWNER', mode: 'live' });
    const journal = insertJournalRow(db, { agent_id: agent.id, mode: 'live', status: 'broadcast', tx_hash: 'tx-crash-1' });

    const result = await reconcilePendingExecutions();

    expect(result).toEqual({ recovered: 1, markedFailed: 0 });
    expect(db.prepare('SELECT status, trade_id FROM execution_journal WHERE id = ?').get(journal.id)).toMatchObject({ status: 'recorded' });
    const trade = db.prepare('SELECT * FROM trades WHERE tx_hash = ?').get('tx-crash-1') as { agent_id: string } | undefined;
    expect(trade?.agent_id).toBe(agent.id);
  });

  it('marks a broadcast row Horizon cannot confirm as failed instead of trusting the local hash blindly', async () => {
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { reconcilePendingExecutions } = await import('../executionJournal.js');
    const { verifyTransactionOnHorizon } = await import('../horizonReconciliation.js');
    vi.mocked(verifyTransactionOnHorizon).mockResolvedValue(false);

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GOWNER', mode: 'live' });
    insertJournalRow(db, { agent_id: agent.id, mode: 'live', status: 'broadcast', tx_hash: 'tx-unconfirmed' });

    const result = await reconcilePendingExecutions();

    expect(result).toEqual({ recovered: 0, markedFailed: 1 });
    expect(db.prepare('SELECT COUNT(*) c FROM trades').get()).toEqual({ c: 0 });
  });

  it('is idempotent: reconciling the same broadcast row twice never creates a duplicate trade', async () => {
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { reconcilePendingExecutions } = await import('../executionJournal.js');
    const { verifyTransactionOnHorizon } = await import('../horizonReconciliation.js');
    vi.mocked(verifyTransactionOnHorizon).mockResolvedValue(true);

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GOWNER', mode: 'live' });
    insertJournalRow(db, { agent_id: agent.id, mode: 'live', status: 'broadcast', tx_hash: 'tx-dupe-check' });

    await reconcilePendingExecutions();
    // Simulate a second restart before the journal row's status write is what's re-read —
    // re-run reconciliation against the now-'recorded' state.
    const second = await reconcilePendingExecutions();

    expect(second).toEqual({ recovered: 0, markedFailed: 0 });
    expect(db.prepare('SELECT COUNT(*) c FROM trades WHERE tx_hash = ?').get('tx-dupe-check')).toEqual({ c: 1 });
  });

  it('recovers a pending row via Horizon search when a matching post-crash transaction is found', async () => {
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { reconcilePendingExecutions } = await import('../executionJournal.js');
    const { findBroadcastAfter } = await import('../horizonReconciliation.js');
    vi.mocked(findBroadcastAfter).mockResolvedValue('tx-found-on-horizon');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GOWNER', mode: 'live' });
    const staleCreatedAt = Date.now() - 10 * 60 * 1000; // past the 5-minute grace window
    insertJournalRow(db, { agent_id: agent.id, mode: 'live', status: 'pending', tx_hash: null, created_at: staleCreatedAt });

    const result = await reconcilePendingExecutions();

    expect(result).toEqual({ recovered: 1, markedFailed: 0 });
    expect(db.prepare('SELECT COUNT(*) c FROM trades WHERE tx_hash = ?').get('tx-found-on-horizon')).toEqual({ c: 1 });
  });

  it('marks a stale pending row failed (not resubmitted) when Horizon has no matching transaction', async () => {
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { reconcilePendingExecutions } = await import('../executionJournal.js');
    const { findBroadcastAfter } = await import('../horizonReconciliation.js');
    vi.mocked(findBroadcastAfter).mockResolvedValue(null);

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GOWNER', mode: 'live' });
    const staleCreatedAt = Date.now() - 10 * 60 * 1000;
    const journal = insertJournalRow(db, { agent_id: agent.id, mode: 'live', status: 'pending', tx_hash: null, created_at: staleCreatedAt });

    const result = await reconcilePendingExecutions();

    expect(result).toEqual({ recovered: 0, markedFailed: 1 });
    expect(db.prepare('SELECT status FROM execution_journal WHERE id = ?').get(journal.id)).toEqual({ status: 'failed' });
    expect(db.prepare('SELECT COUNT(*) c FROM trades').get()).toEqual({ c: 0 });
  });

  it('never calls Horizon for a stale paper-mode pending row', async () => {
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { reconcilePendingExecutions } = await import('../executionJournal.js');
    const { findBroadcastAfter } = await import('../horizonReconciliation.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GOWNER', mode: 'paper' });
    const staleCreatedAt = Date.now() - 10 * 60 * 1000;
    insertJournalRow(db, { agent_id: agent.id, mode: 'paper', status: 'pending', tx_hash: null, created_at: staleCreatedAt });

    const result = await reconcilePendingExecutions();

    expect(findBroadcastAfter).not.toHaveBeenCalled();
    expect(result).toEqual({ recovered: 0, markedFailed: 1 });
  });

  it('leaves a fresh pending row (within grace window) untouched', async () => {
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { reconcilePendingExecutions } = await import('../executionJournal.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GOWNER', mode: 'live' });
    const journal = insertJournalRow(db, { agent_id: agent.id, mode: 'live', status: 'pending', tx_hash: null, created_at: Date.now() });

    const result = await reconcilePendingExecutions();

    expect(result).toEqual({ recovered: 0, markedFailed: 0 });
    expect(db.prepare('SELECT status FROM execution_journal WHERE id = ?').get(journal.id)).toEqual({ status: 'pending' });
  });
});
