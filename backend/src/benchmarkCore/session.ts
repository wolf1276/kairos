// BenchmarkSession (Phase 1 — Benchmark Core). Records every pipeline execution passed to it,
// immutably, and persists it via an injected BenchmarkStore. Contains zero business logic about
// what a "good" execution looks like — it never judges, filters, or recomputes engine output,
// only stores it. Trading-metric computation over this recorded history is a separate concern
// (Phase 2), layered strictly on top — never inline here.
import { randomUUID } from 'crypto';
import { SqliteBenchmarkStore } from './store.js';
import type { BenchmarkExecutionInput, BenchmarkExecutionRecord, BenchmarkStore } from './types.js';

/** Same technique as `learningEngine/engine.ts::deepFreeze` / `pipelineRunner/orchestrator.ts`
 *  — duplicated locally rather than imported, since Benchmark Core must not depend on any other
 *  phase's internals. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

export class BenchmarkSession {
  readonly sessionId: string;
  private readonly store: BenchmarkStore;

  constructor(sessionId?: string, store: BenchmarkStore = new SqliteBenchmarkStore()) {
    this.sessionId = sessionId ?? randomUUID();
    this.store = store;
  }

  /** Records one pipeline execution. Returns the immutable record that was persisted. Never
   *  throws on the caller's behalf for malformed engine output — it stores whatever it's given,
   *  exactly as given (frozen, not revalidated). */
  record(input: BenchmarkExecutionInput): BenchmarkExecutionRecord {
    const record: BenchmarkExecutionRecord = deepFreeze({
      sessionId: this.sessionId,
      executionId: input.executionId ?? randomUUID(),
      timestamp: input.timestamp ?? Date.now(),
      recordedAt: Date.now(),
      pipelineDurationMs: input.pipelineDurationMs,
      stageDurations: { ...input.stageDurations },
      provider: input.provider,
      model: input.model,
      success: input.success ?? true,
      failureStage: input.failureStage,
      error: input.error,
      strategySignals: input.strategySignals,
      decision: input.decision,
      verification: input.verification,
      executionResult: input.executionResult,
      outcome: input.outcome,
      learningSnapshot: input.learningSnapshot,
    });
    this.store.insert(record);
    return record;
  }

  /** All records recorded under this session so far, in recording order. */
  getRecords(): BenchmarkExecutionRecord[] {
    return this.store.listBySession(this.sessionId);
  }
}
