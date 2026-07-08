// Benchmark Core (Phase 1). Passive recorder, decoupled from every frozen engine — it never
// imports Context/Memory/Reasoning/DecisionIntelligence/Verification/Planner/RouteEngine/
// ExecutionEngine/OutcomeRecorder/MemoryWriter/LearningEngine. Callers (Pipeline Runner, e2e
// harnesses, etc.) pass in whatever each stage already produced; this module only records,
// persists, and returns it — it never inspects, revalidates, or mutates engine output.
export const BENCHMARK_CORE_VERSION = '1.0.0';

/** One pipeline run's worth of data to record. Every field beyond identifiers/timestamp is
 *  `unknown` deliberately — Benchmark Core does not know or care about any engine's internal
 *  shape, only that a value was produced for that slot (same philosophy as
 *  `runtime/pipelineRunner/types.ts::PipelineAccumulator`). */
export interface BenchmarkExecutionInput {
  /** Caller-supplied id for this execution; auto-generated (UUID) if omitted. */
  executionId?: string;
  /** Caller-supplied timestamp (ms epoch); defaults to Date.now() if omitted. */
  timestamp?: number;
  /** Total pipeline wall-clock duration, in ms. */
  pipelineDurationMs: number;
  /** Per-stage duration, in ms, keyed by stage name. */
  stageDurations: Record<string, number>;
  provider: string;
  model: string;
  /** Whether the pipeline run this record covers completed all stages successfully. Mirrors
   *  `PipelineResult.success` (runtime/pipelineRunner/types.ts) verbatim — never inferred.
   *  Defaults to `true` if omitted, for callers recording outside a Pipeline Runner run (e.g.
   *  e2e harnesses) that have no failure concept of their own. */
  success?: boolean;
  /** Stage that threw, if `success` is false. Mirrors `PipelineResult.failureStage` verbatim. */
  failureStage?: string;
  /** Error message, if `success` is false. Mirrors `PipelineResult.error` verbatim. */
  error?: string;
  strategySignals?: unknown;
  decision?: unknown;
  verification?: unknown;
  executionResult?: unknown;
  outcome?: unknown;
  learningSnapshot?: unknown;
}

/** Immutable record of one pipeline execution within a BenchmarkSession. Deep-frozen at
 *  construction — see session.ts::deepFreeze. */
export interface BenchmarkExecutionRecord {
  readonly sessionId: string;
  readonly executionId: string;
  readonly timestamp: number;
  readonly recordedAt: number;
  readonly pipelineDurationMs: number;
  readonly stageDurations: Readonly<Record<string, number>>;
  readonly provider: string;
  readonly model: string;
  readonly success: boolean;
  readonly failureStage?: string;
  readonly error?: string;
  readonly strategySignals?: unknown;
  readonly decision?: unknown;
  readonly verification?: unknown;
  readonly executionResult?: unknown;
  readonly outcome?: unknown;
  readonly learningSnapshot?: unknown;
}

/** Persistence boundary Benchmark Core depends on — see store.ts for the real (SQLite-backed)
 *  implementation. Kept as an interface so tests can swap in an in-memory double without a real
 *  DB file, same technique as `WriteMemoryProviders` in `reasoning/memoryWriter/writer.ts`. */
export interface BenchmarkStore {
  /** Append-only insert. No update/delete method exists on this interface by design — a
   *  BenchmarkExecutionRecord, once persisted, is never changed or removed. */
  insert(record: BenchmarkExecutionRecord): void;
  listBySession(sessionId: string): BenchmarkExecutionRecord[];
  listAll(): BenchmarkExecutionRecord[];
}
