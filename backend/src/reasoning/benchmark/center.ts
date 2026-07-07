// Benchmark Center (Phase 7): compares reasoning models by replaying the same scenario(s)
// against each one through the existing, frozen pipeline (Pipeline Composition, Phase 13, which
// itself only wires the frozen Phase 1-12 engines) using the Replay execution target (Phase 4) —
// no engine changes, no AI changes, this module only reads what the frozen pipeline already
// produces. Every metric is a direct aggregation of already-recorded, real fields; whenever a
// pipeline run never reached the stage a metric depends on, that run contributes nothing to it
// (never a fabricated 0/false).
import { createPipelineRunner } from '../../runtime/pipelineComposition/index.js';
import { PIPELINE_STAGE_NAMES } from '../../runtime/pipelineRunner/index.js';
import type { PipelineResult, PipelineStageName } from '../../runtime/pipelineRunner/index.js';
import { getDecisionIntelligenceMetrics } from '../decisionIntelligence/metrics.js';
import type { GenerateDecisionIntelligenceResult } from '../decisionIntelligence/orchestrator.js';
import type { DecisionIntelligenceProviderConfig } from '../decisionIntelligence/requestClient.js';
import type { OutcomeRecord } from '../outcomeRecorder/index.js';
import { maxDrawdown, mean, percentile, sharpeRatio } from './analytics.js';
import type {
  BenchmarkCenterConfig,
  BenchmarkModel,
  BenchmarkReport,
  BenchmarkRunRecord,
  ModelReport,
} from './report.js';

const STAGE_INDEX = new Map<PipelineStageName, number>(PIPELINE_STAGE_NAMES.map((name, i) => [name, i]));

/** A stage "completed" when the pipeline never failed, or failed at a strictly later stage. */
function completedStage(failureStage: PipelineStageName | undefined, stage: PipelineStageName): boolean {
  if (failureStage === undefined) return true;
  return (STAGE_INDEX.get(failureStage) as number) > (STAGE_INDEX.get(stage) as number);
}

/** A stage was "attempted" when it completed, or the pipeline failed at that exact stage. */
function attemptedStage(failureStage: PipelineStageName | undefined, stage: PipelineStageName): boolean {
  if (failureStage === undefined) return true;
  return (STAGE_INDEX.get(failureStage) as number) >= (STAGE_INDEX.get(stage) as number);
}

interface TokenAggregateSnapshot {
  calls: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
}

const EMPTY_TOKEN_SNAPSHOT: TokenAggregateSnapshot = { calls: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0 };

/** Reads Decision Intelligence's own per-(provider,model) token aggregate (keyed exactly as
 *  `recordDecisionIntelligenceCall` keys it — see `decisionIntelligence/metrics.ts`). Benchmark
 *  Center never accumulates tokens itself; it only snapshots this real, already-recorded
 *  aggregate before and after a model's runs and reports the delta, so token usage is never
 *  fabricated and never leaks across models sharing the global metrics map (each model's
 *  provider:model key is disjoint from every other model's). */
function snapshotTokens(config: DecisionIntelligenceProviderConfig): TokenAggregateSnapshot {
  const key = `${config.provider}:${config.model}`;
  const all = getDecisionIntelligenceMetrics();
  const agg = all[key];
  if (!agg) return { ...EMPTY_TOKEN_SNAPSHOT };
  return {
    calls: agg.calls,
    totalPromptTokens: agg.totalPromptTokens,
    totalCompletionTokens: agg.totalCompletionTokens,
    totalTokens: agg.totalTokens,
  };
}

function buildRunRecord(
  modelLabel: string,
  scenarioId: string,
  runIndex: number,
  result: PipelineResult
): BenchmarkRunRecord {
  const failureStage = result.failureStage;

  let jsonValid: boolean | null = null;
  let confidence: number | null = null;
  if (completedStage(failureStage, 'decision')) {
    const decisionResult = result.decision as GenerateDecisionIntelligenceResult;
    jsonValid = true;
    confidence = decisionResult.decision.confidence.overall;
  } else if (attemptedStage(failureStage, 'decision')) {
    jsonValid = false;
  }

  let outcome: BenchmarkRunRecord['outcome'] = null;
  if (completedStage(failureStage, 'outcome')) {
    const outcomeRecord = result.outcome as OutcomeRecord;
    const amountRequested = Number(outcomeRecord.amountRequested);
    const amountExecuted = Number(outcomeRecord.amountExecuted);
    const fees = Number(outcomeRecord.fees);
    const pnl = outcomeRecord.executionStatus === 'success' ? amountExecuted - amountRequested - fees : -fees;
    outcome = {
      executionStatus: outcomeRecord.executionStatus,
      amountRequested: outcomeRecord.amountRequested,
      amountExecuted: outcomeRecord.amountExecuted,
      fees: outcomeRecord.fees,
      pnl,
    };
  }

  return {
    modelLabel,
    scenarioId,
    runIndex,
    success: result.success,
    ...(failureStage !== undefined ? { failureStage } : {}),
    ...(result.error !== undefined ? { error: result.error } : {}),
    totalDurationMs: result.totalDurationMs,
    jsonValid,
    confidence,
    outcome,
  };
}

function buildModelReport(model: BenchmarkModel, runs: BenchmarkRunRecord[], before: TokenAggregateSnapshot, after: TokenAggregateSnapshot): ModelReport {
  const outcomes = runs.map((r) => r.outcome).filter((o): o is NonNullable<BenchmarkRunRecord['outcome']> => o !== null);
  const pnlSeries = outcomes.map((o) => o.pnl);
  const wins = outcomes.filter((o) => o.executionStatus === 'success').length;
  const losses = outcomes.length - wins;

  const latencies = runs.map((r) => r.totalDurationMs);

  const jsonAttempted = runs.filter((r) => r.jsonValid !== null);
  const jsonValidCount = jsonAttempted.filter((r) => r.jsonValid === true).length;

  const confidences = runs.map((r) => r.confidence).filter((c): c is number => c !== null);

  const deltaCalls = after.calls - before.calls;
  const deltaPrompt = after.totalPromptTokens - before.totalPromptTokens;
  const deltaCompletion = after.totalCompletionTokens - before.totalCompletionTokens;
  const deltaTotal = after.totalTokens - before.totalTokens;

  return {
    label: model.label,
    provider: model.decisionIntelligenceConfig.provider,
    model: model.decisionIntelligenceConfig.model,
    totalRuns: runs.length,
    outcomeCount: outcomes.length,
    pnl: pnlSeries.length === 0 ? null : { value: mean(pnlSeries) as number, sampleCount: pnlSeries.length },
    totalPnl: pnlSeries.length === 0 ? null : pnlSeries.reduce((acc, v) => acc + v, 0),
    winRate: outcomes.length === 0 ? null : { wins, losses, total: outcomes.length, rate: wins / outcomes.length },
    drawdown: maxDrawdown(pnlSeries),
    sharpe: sharpeRatio(pnlSeries),
    latency: {
      avgMs: mean(latencies) as number,
      p95Ms: percentile(latencies, 95) as number,
      sampleCount: latencies.length,
    },
    tokenUsage:
      deltaCalls === 0
        ? null
        : {
            avgPromptTokens: deltaPrompt / deltaCalls,
            avgCompletionTokens: deltaCompletion / deltaCalls,
            avgTotalTokens: deltaTotal / deltaCalls,
            totalTokens: deltaTotal,
            sampleCount: deltaCalls,
          },
    jsonValidity:
      jsonAttempted.length === 0
        ? null
        : {
            validCount: jsonValidCount,
            invalidCount: jsonAttempted.length - jsonValidCount,
            attemptedCount: jsonAttempted.length,
            rate: jsonValidCount / jsonAttempted.length,
          },
    confidence: confidences.length === 0 ? null : { value: mean(confidences) as number, sampleCount: confidences.length },
  };
}

/**
 * Replays every scenario against every model under test (via the existing frozen pipeline +
 * Replay execution target), then reports PnL/Win Rate/Drawdown/Sharpe/Latency/Token
 * Usage/JSON validity/Confidence per model — purely aggregated from what each replay run actually
 * produced. Runs are executed sequentially per model (scenario order, then repeat count) so that
 * token-usage snapshots taken before/after a model's runs cannot straddle another model's calls.
 */
export async function runBenchmark(config: BenchmarkCenterConfig): Promise<BenchmarkReport> {
  const runsPerScenario = config.runsPerScenario ?? 1;
  const allRuns: BenchmarkRunRecord[] = [];
  const modelReports: ModelReport[] = [];

  for (const model of config.models) {
    const before = snapshotTokens(model.decisionIntelligenceConfig);
    const modelRuns: BenchmarkRunRecord[] = [];

    for (const scenario of config.scenarios) {
      for (let runIndex = 0; runIndex < runsPerScenario; runIndex++) {
        const pipelineConfig = scenario.buildConfig(model.decisionIntelligenceConfig);
        const runner = createPipelineRunner(pipelineConfig);
        const result = await runner.run();
        const record = buildRunRecord(model.label, scenario.id, runIndex, result);
        modelRuns.push(record);
        allRuns.push(record);
      }
    }

    const after = snapshotTokens(model.decisionIntelligenceConfig);
    modelReports.push(buildModelReport(model, modelRuns, before, after));
  }

  return {
    generatedAt: Date.now(),
    scenarioIds: config.scenarios.map((s) => s.id),
    models: modelReports,
    runs: allRuns,
  };
}
