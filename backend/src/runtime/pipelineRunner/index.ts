// Public surface of the Pipeline Runner (Phase 12). Callers import only from here.
export { runPipelineOnce, KairosPipelineRunner } from './orchestrator.js';
export { PIPELINE_STAGE_NAMES, STAGE_COMPLETE_LABEL } from './types.js';
export type {
  PipelineStageName,
  PipelineAccumulator,
  PipelineStages,
  PipelineResult,
  StageDurations,
  StageFn,
  PipelineRunnerLogger,
} from './types.js';
