// Types for the Pipeline Runner (Phase 12). Zero business logic lives here — this is purely the
// shape of the stage-invocation contract. Every stage function is supplied by the caller via
// dependency injection; the Runner never imports or instantiates any frozen engine itself.

export const PIPELINE_STAGE_NAMES = [
  'context',
  'memory',
  'reasoning',
  'decision',
  'verification',
  'plan',
  'route',
  'execution',
  'outcome',
  'memoryWrite',
  'learning',
] as const;
export type PipelineStageName = (typeof PIPELINE_STAGE_NAMES)[number];

/** Accumulated outputs of every stage that has completed so far, keyed by stage name. Each stage
 *  function receives this (read-only) accumulator and returns only its own slice — the Runner
 *  merges it in before calling the next stage. Untyped (`unknown`) deliberately: the Runner does
 *  not know or care about Context/Memory/Reasoning/... shapes, only that a value was produced. */
export type PipelineAccumulator = {
  readonly [K in PipelineStageName]?: unknown;
};

export type StageFn<TIn = PipelineAccumulator, TOut = unknown> = (input: TIn) => Promise<TOut> | TOut;

/** One injected function per frozen stage, invoked strictly in PIPELINE_STAGE_NAMES order. */
export interface PipelineStages {
  context: StageFn;
  memory: StageFn;
  reasoning: StageFn;
  decision: StageFn;
  verification: StageFn;
  plan: StageFn;
  route: StageFn;
  execution: StageFn;
  outcome: StageFn;
  memoryWrite: StageFn;
  learning: StageFn;
}

export interface StageDurations {
  readonly context?: number;
  readonly memory?: number;
  readonly reasoning?: number;
  readonly decision?: number;
  readonly verification?: number;
  readonly plan?: number;
  readonly route?: number;
  readonly execution?: number;
  readonly outcome?: number;
  readonly memoryWrite?: number;
  readonly learning?: number;
}

/** Immutable (deep-frozen) result of a single pipeline run. On failure, every field for a stage
 *  that did not complete is left undefined — the Runner never fabricates partial output. */
export interface PipelineResult {
  readonly success: boolean;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly totalDurationMs: number;
  readonly stageDurations: StageDurations;
  readonly context?: unknown;
  readonly memory?: unknown;
  readonly reasoning?: unknown;
  readonly decision?: unknown;
  readonly verification?: unknown;
  readonly plan?: unknown;
  readonly route?: unknown;
  readonly execution?: unknown;
  readonly outcome?: unknown;
  readonly memoryWrite?: unknown;
  readonly learning?: unknown;
  readonly failureStage?: PipelineStageName;
  readonly error?: string;
}

export interface PipelineRunnerLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** Human-readable "<Stage> Complete" lifecycle labels, in stage order, per the spec. */
export const STAGE_COMPLETE_LABEL: Record<PipelineStageName, string> = {
  context: 'Context Complete',
  memory: 'Memory Complete',
  reasoning: 'Reasoning Complete',
  decision: 'Decision Complete',
  verification: 'Verification Complete',
  plan: 'Planning Complete',
  route: 'Routing Complete',
  execution: 'Execution Complete',
  outcome: 'Outcome Recorded',
  memoryWrite: 'Memory Written',
  learning: 'Learning Updated',
};
