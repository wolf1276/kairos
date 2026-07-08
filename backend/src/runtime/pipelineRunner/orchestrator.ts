// Pipeline Runner (Phase 12): the only orchestrator allowed to call the frozen engines, and it
// contains zero business logic of its own. It invokes injected stage functions strictly in order,
// passes each stage's output into the next, measures durations, and fails closed on the first
// stage that throws. Every engine call is dependency-injected — this module never imports or
// instantiates Context/Memory/Reasoning/DecisionIntelligence/Verification/Planner/RouteEngine/
// ExecutionEngine/OutcomeRecorder/MemoryWriter/LearningEngine directly.
import {
  PIPELINE_STAGE_NAMES,
  STAGE_COMPLETE_LABEL,
  type PipelineAccumulator,
  type PipelineResult,
  type PipelineRunnerLogger,
  type PipelineStageName,
  type PipelineStages,
  type StageDurations,
} from './types.js';
import type { BenchmarkSession } from '../../benchmarkCore/index.js';

/** Caller-supplied Benchmark Core (Phase 1) wiring — optional so every existing caller of
 *  runPipelineOnce/KairosPipelineRunner keeps working unchanged. `provider`/`model` are supplied
 *  by the caller (e.g. Pipeline Composition already has these from its own
 *  decisionIntelligenceConfig) rather than parsed out of the accumulator's `unknown`-typed
 *  `decision` slot, since the Pipeline Runner does not and must not know any stage's shape. */
export interface PipelineBenchmarkOptions {
  session: BenchmarkSession;
  provider: string;
  model: string;
}

/** Converts PipelineResult.stageDurations (each field optional — a stage that never ran has no
 *  entry) into a plain Record<string, number> containing only the stages that actually
 *  completed. Never fills in a 0 or fabricated duration for a stage that didn't run. */
function toStageDurationsRecord(stageDurations: StageDurations): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [stage, durationMs] of Object.entries(stageDurations)) {
    if (typeof durationMs === 'number') out[stage] = durationMs;
  }
  return out;
}

/** Records one PipelineResult into a BenchmarkSession using only data the run itself actually
 *  produced — see PipelineBenchmarkOptions for why provider/model come from the caller. Every
 *  other field is taken verbatim from the accumulator slot of the same name; a stage that never
 *  ran (failed pipeline) simply leaves that slot undefined, exactly as PipelineResult already
 *  represents it. */
function recordBenchmark(result: PipelineResult, benchmark: PipelineBenchmarkOptions): void {
  benchmark.session.record({
    timestamp: result.startedAt,
    pipelineDurationMs: result.totalDurationMs,
    stageDurations: toStageDurationsRecord(result.stageDurations),
    provider: benchmark.provider,
    model: benchmark.model,
    success: result.success,
    failureStage: result.failureStage,
    error: result.error,
    decision: result.decision,
    verification: result.verification,
    executionResult: result.execution,
    outcome: result.outcome,
    learningSnapshot: result.learning,
  });
}

/** Same technique as learningEngine/engine.ts::deepFreeze — duplicated locally rather than
 *  imported from another phase, since phases must not depend on each other's internals. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

const silentLogger: PipelineRunnerLogger = { info: () => {}, error: () => {} };

/** Runs the full frozen pipeline once, in order, against a fresh local accumulator. Every value
 *  used (accumulator, durations, timers) is a local variable scoped to this single call, so
 *  concurrent invocations never share mutable state (thread safe) and each call is fully
 *  reproducible given deterministic stage functions (idempotent, deterministic). Never mutates
 *  or reuses state across calls. */
export async function runPipelineOnce(
  stages: PipelineStages,
  logger: PipelineRunnerLogger = silentLogger,
  benchmark?: PipelineBenchmarkOptions
): Promise<PipelineResult> {
  const startedAt = Date.now();
  const startedAtHr = process.hrtime.bigint();
  logger.info('Pipeline Started');

  let accumulator: PipelineAccumulator = {};
  const stageDurations: Partial<Record<PipelineStageName, number>> = {};

  for (const stageName of PIPELINE_STAGE_NAMES) {
    const stageFn = stages[stageName];
    const stageStartHr = process.hrtime.bigint();
    try {
      const output = await stageFn(accumulator);
      const stageDurationMs = Number(process.hrtime.bigint() - stageStartHr) / 1_000_000;
      stageDurations[stageName] = stageDurationMs;
      accumulator = { ...accumulator, [stageName]: output };
      logger.info(STAGE_COMPLETE_LABEL[stageName]);
    } catch (error) {
      const stageDurationMs = Number(process.hrtime.bigint() - stageStartHr) / 1_000_000;
      stageDurations[stageName] = stageDurationMs;
      const finishedAt = Date.now();
      const totalDurationMs = Number(process.hrtime.bigint() - startedAtHr) / 1_000_000;
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Pipeline Finished', { success: false, failureStage: stageName, error: message });
      const failureResult = deepFreeze({
        success: false,
        startedAt,
        finishedAt,
        totalDurationMs,
        stageDurations: stageDurations as StageDurations,
        ...accumulator,
        failureStage: stageName,
        error: message,
      });
      if (benchmark) recordBenchmark(failureResult, benchmark);
      return failureResult;
    }
  }

  const finishedAt = Date.now();
  const totalDurationMs = Number(process.hrtime.bigint() - startedAtHr) / 1_000_000;
  logger.info('Pipeline Finished', { success: true });
  const successResult = deepFreeze({
    success: true,
    startedAt,
    finishedAt,
    totalDurationMs,
    stageDurations: stageDurations as StageDurations,
    ...accumulator,
  });
  if (benchmark) recordBenchmark(successResult, benchmark);
  return successResult;
}

/** Adapts a full PipelineResult run to the narrow `PipelineRunner` interface the Autonomous
 *  Runtime (Phase 11, frozen) expects — `{ runPipeline(): Promise<{success, error?}> }`. Keeps
 *  the Runtime unaware of PipelineResult's richer shape, per Phase 11's contract. */
export class KairosPipelineRunner {
  constructor(
    private readonly stages: PipelineStages,
    private readonly logger: PipelineRunnerLogger = silentLogger,
    private readonly benchmark?: PipelineBenchmarkOptions,
  ) {}

  /** Full result for callers that want per-stage detail (metrics, replay, debugging). Records
   *  this run into the injected BenchmarkSession (Phase 1), if one was supplied. */
  async run(): Promise<PipelineResult> {
    return runPipelineOnce(this.stages, this.logger, this.benchmark);
  }

  /** Narrow adapter satisfying AutonomousRuntime's `PipelineRunner` interface. */
  async runPipeline(): Promise<{ success: boolean; error?: string }> {
    const result = await this.run();
    return result.success ? { success: true } : { success: false, error: result.error };
  }
}
