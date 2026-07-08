// Benchmark Core (Phase 1) tests. Uses InMemoryBenchmarkStore exclusively — no real SQLite file,
// no frozen engine imported or mocked, since Benchmark Core depends on none of them.
import { describe, expect, it } from 'vitest';
import { BenchmarkSession } from '../benchmarkCore/session.js';
import { InMemoryBenchmarkStore } from '../benchmarkCore/store.js';
import type { BenchmarkExecutionInput } from '../benchmarkCore/types.js';

function sampleInput(overrides: Partial<BenchmarkExecutionInput> = {}): BenchmarkExecutionInput {
  return {
    pipelineDurationMs: 123.45,
    stageDurations: { context: 1, memory: 2, decision: 100 },
    provider: 'ollama',
    model: 'llama3.1:8b-instruct-q4_K_M',
    strategySignals: { signal: 'HOLD', confidence: 0.6 },
    decision: { primaryDecision: { action: 'HOLD' } },
    verification: { status: 'verified' },
    executionResult: { status: 'success' },
    outcome: { outcomeId: 'out-1' },
    learningSnapshot: { snapshotId: 'snap-1' },
    ...overrides,
  };
}

describe('BenchmarkSession', () => {
  it('records an execution with all fields present', () => {
    const store = new InMemoryBenchmarkStore();
    const session = new BenchmarkSession('session-1', store);
    const record = session.record(sampleInput());

    expect(record.sessionId).toBe('session-1');
    expect(record.executionId).toBeTruthy();
    expect(record.timestamp).toBeTypeOf('number');
    expect(record.recordedAt).toBeTypeOf('number');
    expect(record.pipelineDurationMs).toBe(123.45);
    expect(record.stageDurations).toEqual({ context: 1, memory: 2, decision: 100 });
    expect(record.provider).toBe('ollama');
    expect(record.model).toBe('llama3.1:8b-instruct-q4_K_M');
    expect(record.strategySignals).toEqual({ signal: 'HOLD', confidence: 0.6 });
    expect(record.decision).toEqual({ primaryDecision: { action: 'HOLD' } });
    expect(record.verification).toEqual({ status: 'verified' });
    expect(record.executionResult).toEqual({ status: 'success' });
    expect(record.outcome).toEqual({ outcomeId: 'out-1' });
    expect(record.learningSnapshot).toEqual({ snapshotId: 'snap-1' });
  });

  it('auto-generates a sessionId and executionId when omitted', () => {
    const session = new BenchmarkSession(undefined, new InMemoryBenchmarkStore());
    const record = session.record(sampleInput());
    expect(session.sessionId).toBeTruthy();
    expect(record.executionId).toBeTruthy();
  });

  it('defaults timestamp to now when omitted', () => {
    const before = Date.now();
    const session = new BenchmarkSession('session-2', new InMemoryBenchmarkStore());
    const record = session.record(sampleInput());
    const after = Date.now();
    expect(record.timestamp).toBeGreaterThanOrEqual(before);
    expect(record.timestamp).toBeLessThanOrEqual(after);
  });

  it('respects caller-supplied executionId and timestamp', () => {
    const session = new BenchmarkSession('session-3', new InMemoryBenchmarkStore());
    const record = session.record(sampleInput({ executionId: 'exec-fixed', timestamp: 1_700_000_000_000 }));
    expect(record.executionId).toBe('exec-fixed');
    expect(record.timestamp).toBe(1_700_000_000_000);
  });

  it('produces a deep-frozen, immutable record', () => {
    const session = new BenchmarkSession('session-4', new InMemoryBenchmarkStore());
    const record = session.record(sampleInput());
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.stageDurations)).toBe(true);
    expect(() => {
      (record as { provider: string }).provider = 'mutated';
    }).toThrow();
    expect(record.provider).toBe('ollama');
  });

  it('keeps sessions isolated — getRecords only returns records for this session', () => {
    const store = new InMemoryBenchmarkStore();
    const sessionA = new BenchmarkSession('session-A', store);
    const sessionB = new BenchmarkSession('session-B', store);
    sessionA.record(sampleInput({ executionId: 'a-1' }));
    sessionA.record(sampleInput({ executionId: 'a-2' }));
    sessionB.record(sampleInput({ executionId: 'b-1' }));

    expect(sessionA.getRecords().map((r) => r.executionId).sort()).toEqual(['a-1', 'a-2']);
    expect(sessionB.getRecords().map((r) => r.executionId)).toEqual(['b-1']);
  });

  it('preserves recording order within a session', () => {
    const session = new BenchmarkSession('session-order', new InMemoryBenchmarkStore());
    session.record(sampleInput({ executionId: 'first', timestamp: 100 }));
    session.record(sampleInput({ executionId: 'second', timestamp: 200 }));
    session.record(sampleInput({ executionId: 'third', timestamp: 300 }));
    expect(session.getRecords().map((r) => r.executionId)).toEqual(['first', 'second', 'third']);
  });

  it('records executions with missing optional fields (partial pipeline failure) without throwing', () => {
    const session = new BenchmarkSession('session-partial', new InMemoryBenchmarkStore());
    const record = session.record({
      pipelineDurationMs: 50,
      stageDurations: { context: 1, memory: 1, decision: 48 },
      provider: 'ollama',
      model: 'llama3.1:8b',
      // decision/verification/executionResult/outcome/learningSnapshot all omitted — as would
      // happen when the pipeline fails before those stages run.
    });
    expect(record.decision).toBeUndefined();
    expect(record.verification).toBeUndefined();
    expect(record.executionResult).toBeUndefined();
    expect(record.outcome).toBeUndefined();
    expect(record.learningSnapshot).toBeUndefined();
  });

  it('does not expose any update or delete method on the store interface (append-only)', () => {
    const store = new InMemoryBenchmarkStore();
    expect((store as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((store as unknown as Record<string, unknown>).delete).toBeUndefined();
  });
});

describe('SqliteBenchmarkStore', () => {
  it('persists and reloads records via a real SQLite file', async () => {
    const { SqliteBenchmarkStore, resetBenchmarkDbForTests } = await import('../benchmarkCore/store.js');
    const os = await import('os');
    const path = await import('path');
    const fs = await import('fs');
    const tmpPath = path.join(os.tmpdir(), `benchmark-core-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    const prevEnv = process.env.BENCHMARK_DB_PATH;
    process.env.BENCHMARK_DB_PATH = tmpPath;
    resetBenchmarkDbForTests();
    try {
      const session = new BenchmarkSession('sqlite-session', new SqliteBenchmarkStore());
      session.record(sampleInput({ executionId: 'sqlite-1' }));
      session.record(sampleInput({ executionId: 'sqlite-2' }));

      // Fresh store instance, same underlying file — proves data survived a new connection, not
      // just an in-process cache.
      const reloaded = new SqliteBenchmarkStore().listBySession('sqlite-session');
      expect(reloaded.map((r) => r.executionId).sort()).toEqual(['sqlite-1', 'sqlite-2']);
    } finally {
      resetBenchmarkDbForTests();
      if (prevEnv === undefined) delete process.env.BENCHMARK_DB_PATH;
      else process.env.BENCHMARK_DB_PATH = prevEnv;
      fs.rmSync(tmpPath, { force: true });
      fs.rmSync(`${tmpPath}-wal`, { force: true });
      fs.rmSync(`${tmpPath}-shm`, { force: true });
    }
  });
});
