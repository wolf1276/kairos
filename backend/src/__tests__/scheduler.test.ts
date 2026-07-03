// Scheduler concurrency + role-agent self-heal tests. Fault scenarios simulated:
//  - a tick that outlives the scheduler interval (Horizon/LLM slowness) must not let a second
//    cycle start concurrently and double-execute agents.
//  - a role-agent tick that throws (Horizon down, LLM timeout, oracle failure, DB error) must
//    not permanently kill the agent — it should still be picked up by the next cycle.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

let tmpDir: string;

vi.mock('../tick.js', () => ({ runAgentTick: vi.fn() }));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'kairos-scheduler-test-'));
  process.env.AGENTS_DB_PATH = path.join(tmpDir, 'agents.db');
  process.env.SCHEDULER_INTERVAL_MS = '20';
  vi.clearAllMocks();
  vi.resetModules();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe('scheduler cycle overlap guard', () => {
  it('skips a new cycle while the previous one is still in flight (slow Horizon/LLM call)', async () => {
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { runAgentTick } = await import('../tick.js');
    const { startScheduler, stopScheduler } = await import('../runner.js');

    const db = getDb();
    insertAgent(db, { owner: 'GOWNER', status: 'running' });

    let concurrentCalls = 0;
    let maxConcurrent = 0;
    vi.mocked(runAgentTick).mockImplementation(async () => {
      concurrentCalls++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
      // Longer than SCHEDULER_INTERVAL_MS (20ms) — a second setInterval fire would land mid-tick
      // if the overlap guard weren't in place.
      await new Promise((r) => setTimeout(r, 80));
      concurrentCalls--;
    });

    startScheduler();
    await new Promise((r) => setTimeout(r, 150));
    stopScheduler();

    expect(maxConcurrent).toBe(1);
  });
});

describe('role-agent transient-failure self-heal', () => {
  it('recordTick with keepRunning keeps status running so the next cycle still picks the agent up', async () => {
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { recordTick, listRunningAgents } = await import('../agentService.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GOWNER', status: 'running' });

    recordTick(agent.id, { ok: false, message: 'Horizon unavailable' }, { keepRunning: true });

    const row = db.prepare('SELECT status, last_error FROM agents WHERE id = ?').get(agent.id);
    expect(row).toEqual({ status: 'running', last_error: 'Horizon unavailable' });
    expect(listRunningAgents().map((a) => a.id)).toContain(agent.id);
  });

  it('recordTick without keepRunning halts a user-configured (non-role) agent on failure', async () => {
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { recordTick, listRunningAgents } = await import('../agentService.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GOWNER', status: 'running', role: null });

    recordTick(agent.id, { ok: false, message: 'bad strategy config' });

    const row = db.prepare('SELECT status FROM agents WHERE id = ?').get(agent.id);
    expect(row).toEqual({ status: 'error' });
    expect(listRunningAgents().map((a) => a.id)).not.toContain(agent.id);
  });
});
