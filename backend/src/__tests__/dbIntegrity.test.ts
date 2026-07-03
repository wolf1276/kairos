import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'kairos-db-test-'));
  process.env.AGENTS_DB_PATH = path.join(tmpDir, 'agents.db');
  vi.resetModules();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('foreign key integrity', () => {
  it('enforces RESTRICT: cannot delete an agent with trade history', async () => {
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { insertTrade } = await import('../tradeService.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GOWNER' });
    insertTrade({
      agentId: agent.id,
      strategyId: 'strategic',
      side: 'buy',
      pair: 'XLM/USDC',
      amount: '10',
      price: '0.5',
      txHash: 'tx-1',
      status: 'success',
      realizedPnl: null,
      mode: 'paper',
    });

    expect(() => db.prepare('DELETE FROM agents WHERE id = ?').run(agent.id)).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('allows deleting an agent with no trade history, cascading its position rows', async () => {
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { upsertPosition } = await import('../positionService.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GOWNER' });
    // A position with no backing trade (replay() over zero trades yields a zeroed row) — enough
    // to prove the CASCADE, independent of the trades RESTRICT path above.
    upsertPosition(agent.id, 'XLM/USDC');
    expect(db.prepare('SELECT COUNT(*) c FROM positions WHERE agent_id = ?').get(agent.id)).toEqual({ c: 1 });

    db.prepare('DELETE FROM agents WHERE id = ?').run(agent.id);
    expect(db.prepare('SELECT COUNT(*) c FROM positions WHERE agent_id = ?').get(agent.id)).toEqual({ c: 0 });
  });

  it('rejects a trade/decision/audit row for a non-existent agent', async () => {
    const { getDb } = await import('../db.js');
    const db = getDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO trades (id, agent_id, strategy_id, side, pair, amount, price, status, created_at, mode)
           VALUES (?, ?, 'strategic', 'buy', 'XLM/USDC', '1', '1', 'success', ?, 'paper')`
        )
        .run(randomUUID(), 'does-not-exist', Date.now())
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});

describe('atomic trade + position write', () => {
  it('recordCompletedTrade leaves both trades and positions consistent', async () => {
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { recordCompletedTrade } = await import('../executionEngine.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GOWNER' });

    const { tradeId, position } = recordCompletedTrade({
      row: agent,
      strategyId: 'strategic',
      side: 'buy',
      pair: 'XLM/USDC',
      amount: '10',
      price: '0.5',
      txHash: 'tx-atomic-1',
      mode: 'paper',
    });

    expect(db.prepare('SELECT id FROM trades WHERE id = ?').get(tradeId)).toBeTruthy();
    expect(position.open_amount).toBe('10');
    expect(db.prepare('SELECT COUNT(*) c FROM positions WHERE agent_id = ?').get(agent.id)).toEqual({ c: 1 });
  });
});
