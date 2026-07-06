// Correctness tests for protocol position accounting (accumulation, not overwrite) and the
// protocol execution journal's crash-recovery/idempotency guarantees — see
// protocolPositionService.ts and protocolExecutionJournal.ts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'kairos-protocol-journal-test-'));
  process.env.AGENTS_DB_PATH = path.join(tmpDir, 'agents.db');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('applyProtocolPositionDelta', () => {
  it('accumulates sequential deposits instead of overwriting', async () => {
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { applyProtocolPositionDelta } = await import('../protocolPositionService.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GOWNER' });

    applyProtocolPositionDelta({ agentId: agent.id, owner: agent.owner, protocolId: 'blend', kind: 'lend', asset: 'USDC', delta: 100n });
    const result = applyProtocolPositionDelta({ agentId: agent.id, owner: agent.owner, protocolId: 'blend', kind: 'lend', asset: 'USDC', delta: 100n });

    expect(result.amount).toBe('200');
  });

  it('subtracts on withdraw', async () => {
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { applyProtocolPositionDelta } = await import('../protocolPositionService.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GOWNER' });

    applyProtocolPositionDelta({ agentId: agent.id, owner: agent.owner, protocolId: 'blend', kind: 'lend', asset: 'USDC', delta: 300n });
    const result = applyProtocolPositionDelta({ agentId: agent.id, owner: agent.owner, protocolId: 'blend', kind: 'lend', asset: 'USDC', delta: -100n });

    expect(result.amount).toBe('200');
  });

  it('clamps at 0 rather than going negative', async () => {
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { applyProtocolPositionDelta } = await import('../protocolPositionService.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GOWNER' });

    applyProtocolPositionDelta({ agentId: agent.id, owner: agent.owner, protocolId: 'blend', kind: 'lend', asset: 'USDC', delta: 50n });
    const result = applyProtocolPositionDelta({ agentId: agent.id, owner: agent.owner, protocolId: 'blend', kind: 'lend', asset: 'USDC', delta: -500n });

    expect(result.amount).toBe('0');
  });
});

describe('protocol execution journal recovery', () => {
  it('replays a row stuck at "broadcast" into the position exactly once', async () => {
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { openProtocolExecution, markProtocolExecutionBroadcast, reconcilePendingProtocolExecutions } = await import(
      '../protocolExecutionJournal.js'
    );
    const { listProtocolPositionsForAgent } = await import('../protocolPositionService.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GOWNER' });

    // Simulates: execute() confirmed on-chain (tx_hash captured) but the process crashed before
    // the local position delta was applied.
    const journal = openProtocolExecution({ row: agent, protocolId: 'blend', action: 'deposit', asset: 'USDC', kind: 'lend', delta: 500n });
    markProtocolExecutionBroadcast(journal.id, 'deadbeef');

    const { recovered, markedFailed } = reconcilePendingProtocolExecutions();
    expect(recovered).toBe(1);
    expect(markedFailed).toBe(0);

    const positions = listProtocolPositionsForAgent(agent.id);
    expect(positions).toHaveLength(1);
    expect(positions[0].amount).toBe('500');

    // Running reconciliation again must not double-apply the delta — the row is now 'recorded'.
    const second = reconcilePendingProtocolExecutions();
    expect(second.recovered).toBe(0);
    const positionsAfter = listProtocolPositionsForAgent(agent.id);
    expect(positionsAfter[0].amount).toBe('500');
  });

  it('marks a stuck "pending" row (no tx_hash captured) as failed after the grace window, without touching positions', async () => {
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { openProtocolExecution, reconcilePendingProtocolExecutions } = await import('../protocolExecutionJournal.js');
    const { listProtocolPositionsForAgent } = await import('../protocolPositionService.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GOWNER' });

    const journal = openProtocolExecution({ row: agent, protocolId: 'blend', action: 'deposit', asset: 'USDC', kind: 'lend', delta: 500n });
    // Backdate past the grace window to simulate a crash long enough ago that this is not just
    // an in-flight request.
    db.prepare('UPDATE protocol_execution_journal SET created_at = ? WHERE id = ?').run(Date.now() - 10 * 60 * 1000, journal.id);

    const { recovered, markedFailed } = reconcilePendingProtocolExecutions();
    expect(recovered).toBe(0);
    expect(markedFailed).toBe(1);

    const row = db.prepare('SELECT status FROM protocol_execution_journal WHERE id = ?').get(journal.id) as { status: string };
    expect(row.status).toBe('failed');
    expect(listProtocolPositionsForAgent(agent.id)).toHaveLength(0);
  });

  it('applyProtocolExecutionRecord is a no-op if the row is not at "broadcast"', async () => {
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { openProtocolExecution, applyProtocolExecutionRecord } = await import('../protocolExecutionJournal.js');
    const { listProtocolPositionsForAgent } = await import('../protocolPositionService.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GOWNER' });
    const journal = openProtocolExecution({ row: agent, protocolId: 'blend', action: 'deposit', asset: 'USDC', kind: 'lend', delta: 500n });

    // Still 'pending' — never confirmed on-chain, must not apply the delta.
    const { applied } = applyProtocolExecutionRecord(journal.id);
    expect(applied).toBe(false);
    expect(listProtocolPositionsForAgent(agent.id)).toHaveLength(0);
  });
});
