// Experience Builder (Phase 6): replays the existing frozen pipeline (Pipeline Composition,
// Phase 13 — which itself only wires the frozen Phase 1-12 engines) exactly as published, one
// run at a time, and turns each run's PipelineResult into a durable ExperienceRecord. Contains
// zero engine/business logic of its own: it never re-implements outcome recording, memory
// writing, or learning analytics — it only calls `createPipelineRunner(config).run()` and stores
// whatever that frozen chain produced. No AI changes, no engine changes.
import { randomUUID } from 'crypto';
import { createPipelineRunner } from '../pipelineComposition/index.js';
import type { KairosCompositionConfig } from '../pipelineComposition/index.js';
import type { OutcomeRecord } from '../../reasoning/outcomeRecorder/index.js';
import type { MemoryWriteResult } from '../../reasoning/memoryWriter/index.js';
import type { LearningSnapshot } from '../../reasoning/learningEngine/index.js';
import type { ExperienceHistoryStore, ExperienceRecord, ExperienceStats } from './types.js';

/** Default execution history store: a simple in-process array. Swappable via the
 *  ExperienceBuilder constructor for a durable/persisted implementation. */
export class InMemoryExperienceHistoryStore implements ExperienceHistoryStore {
  private readonly records: ExperienceRecord[] = [];

  append(record: ExperienceRecord): void {
    this.records.push(record);
  }

  list(agentId?: string): ExperienceRecord[] {
    return agentId === undefined ? [...this.records] : this.records.filter((r) => r.agentId === agentId);
  }

  clear(): void {
    this.records.length = 0;
  }
}

export class ExperienceBuilder {
  constructor(
    private readonly config: KairosCompositionConfig,
    private readonly history: ExperienceHistoryStore = new InMemoryExperienceHistoryStore(),
  ) {}

  /**
   * Runs the existing pipeline once against this builder's config (a replay-targeted
   * KairosCompositionConfig, per Phase 4's ReplayTarget) and appends the resulting
   * ExperienceRecord to history. Because the Execution Engine reports a failed execution via
   * `ExecutionResult.status === 'failed'` rather than throwing, a failed trade still flows
   * through the outcome/memoryWrite/learning stages — every replay execution that reaches
   * execution therefore still produces Outcome, Memory, and Learning output. Only a pipeline
   * failure *before* execution (context/memory/reasoning/decision/verification/plan/route)
   * leaves those fields absent, since the frozen Pipeline Runner never fabricates output for a
   * stage that never ran.
   */
  async runReplay(): Promise<ExperienceRecord> {
    const runner = createPipelineRunner(this.config);
    const result = await runner.run();

    const record: ExperienceRecord = {
      runId: randomUUID(),
      agentId: this.config.agentId,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      totalDurationMs: result.totalDurationMs,
      success: result.success,
      ...(result.failureStage !== undefined ? { failureStage: result.failureStage } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
      ...(result.outcome !== undefined ? { outcome: result.outcome as OutcomeRecord } : {}),
      ...(result.memoryWrite !== undefined ? { memoryWrite: result.memoryWrite as MemoryWriteResult } : {}),
      ...(result.learning !== undefined ? { learning: result.learning as LearningSnapshot } : {}),
    };

    this.history.append(record);
    return record;
  }

  /** Stored ExperienceRecords, most recent last — for this builder's own agent by default. */
  getHistory(agentId?: string): ExperienceRecord[] {
    return this.history.list(agentId ?? this.config.agentId);
  }

  /** Pure tally over stored history — never re-derived from AI, never fetched. */
  getStats(agentId?: string): ExperienceStats {
    const scopedAgentId = agentId ?? this.config.agentId;
    const records = this.history.list(scopedAgentId);
    const totalRuns = records.length;
    const successCount = records.filter((r) => r.success).length;
    const failureCount = totalRuns - successCount;
    const avgDurationMs = totalRuns === 0 ? 0 : records.reduce((acc, r) => acc + r.totalDurationMs, 0) / totalRuns;

    let latestLearningSnapshot: LearningSnapshot | null = null;
    for (let i = records.length - 1; i >= 0; i--) {
      if (records[i].learning !== undefined) {
        latestLearningSnapshot = records[i].learning as LearningSnapshot;
        break;
      }
    }

    return {
      agentId: scopedAgentId,
      totalRuns,
      successCount,
      failureCount,
      successRate: totalRuns === 0 ? 0 : successCount / totalRuns,
      avgDurationMs,
      latestLearningSnapshot,
    };
  }
}
