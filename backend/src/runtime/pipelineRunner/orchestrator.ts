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
export async function runPipelineOnce(stages: PipelineStages, logger: PipelineRunnerLogger = silentLogger): Promise<PipelineResult> {
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
      return deepFreeze({
        success: false,
        startedAt,
        finishedAt,
        totalDurationMs,
        stageDurations: stageDurations as StageDurations,
        ...accumulator,
        failureStage: stageName,
        error: message,
      });
    }
  }

  const finishedAt = Date.now();
  const totalDurationMs = Number(process.hrtime.bigint() - startedAtHr) / 1_000_000;
  logger.info('Pipeline Finished', { success: true });
  return deepFreeze({
    success: true,
    startedAt,
    finishedAt,
    totalDurationMs,
    stageDurations: stageDurations as StageDurations,
    ...accumulator,
  });
}

/** Adapts a full PipelineResult run to the narrow `PipelineRunner` interface the Autonomous
 *  Runtime (Phase 11, frozen) expects — `{ runPipeline(): Promise<{success, error?}> }`. Keeps
 *  the Runtime unaware of PipelineResult's richer shape, per Phase 11's contract. */
export class KairosPipelineRunner {
  constructor(
    private readonly stages: PipelineStages,
    private readonly logger: PipelineRunnerLogger = silentLogger,
  ) {}

  /** Full result for callers that want per-stage detail (metrics, replay, debugging). */
  async run(): Promise<PipelineResult> {
    return runPipelineOnce(this.stages, this.logger);
  }

  /** Narrow adapter satisfying AutonomousRuntime's `PipelineRunner` interface. */
  async runPipeline(): Promise<{ success: boolean; error?: string }> {
    const result = await this.run();
    return result.success ? { success: true } : { success: false, error: result.error };
  }
}
