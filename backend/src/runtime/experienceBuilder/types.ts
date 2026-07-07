// Types for the Experience Builder (Phase 6). Pure orchestration over the existing, frozen
// pipeline (Pipeline Composition, Phase 13) — no engine changes, no AI changes. Every replay run
// produces an ExperienceRecord capturing that run's Outcome/Memory/Learning stage output (when
// the pipeline reached that far) plus its success/failure/timing metadata, appended to a durable
// execution history that learning statistics are computed from.
import type { PipelineStageName } from '../pipelineRunner/index.js';
import type { OutcomeRecord } from '../../reasoning/outcomeRecorder/index.js';
import type { MemoryWriteResult } from '../../reasoning/memoryWriter/index.js';
import type { LearningSnapshot } from '../../reasoning/learningEngine/index.js';

export const EXPERIENCE_BUILDER_VERSION = '1.0.0';

/** One replay execution's full experience: the pipeline's success/failure/timing plus whichever
 *  of Outcome/Memory/Learning it actually produced. Fields are present only when the
 *  corresponding pipeline stage ran — never fabricated when the pipeline failed before reaching
 *  it (e.g. a rejected verification stops before outcome/memoryWrite/learning ever run). */
export interface ExperienceRecord {
  runId: string;
  agentId: string;
  startedAt: number;
  finishedAt: number;
  totalDurationMs: number;
  success: boolean;
  failureStage?: PipelineStageName;
  error?: string;
  outcome?: OutcomeRecord;
  memoryWrite?: MemoryWriteResult;
  learning?: LearningSnapshot;
}

/** Aggregate statistics over a run of replay executions for one agent (or across all agents when
 *  no agentId is given). Purely a tally over stored ExperienceRecords — never re-derived from AI
 *  or inference. */
export interface ExperienceStats {
  agentId: string | null;
  totalRuns: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgDurationMs: number;
  /** The most recent LearningSnapshot produced by any stored run, or null if none produced one. */
  latestLearningSnapshot: LearningSnapshot | null;
}

/** Storage abstraction for execution history — injected so callers can swap in a durable
 *  (e.g. database-backed) store without the Experience Builder knowing or caring. */
export interface ExperienceHistoryStore {
  append(record: ExperienceRecord): void;
  list(agentId?: string): ExperienceRecord[];
  clear(): void;
}
