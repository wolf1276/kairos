// Types for the Benchmark Center (Phase 7). Pure data shapes — no logic lives here. Every
// optional/nullable field is `null`/absent rather than a fabricated `0` whenever the underlying
// pipeline run never produced that data (e.g. a run that fails before the decision stage yields
// no JSON-validity/confidence sample at all, not a "0% valid" data point).
import type { PipelineStageName } from '../../runtime/pipelineRunner/index.js';
import type { KairosCompositionConfig } from '../../runtime/pipelineComposition/index.js';
import type { DecisionIntelligenceProviderConfig } from '../decisionIntelligence/requestClient.js';

export const BENCHMARK_CENTER_VERSION = '1.0.0';

/** One reasoning model under comparison. `label` is the caller-chosen display id used to key
 *  reports/runs (e.g. `"openai-mini"`); `decisionIntelligenceConfig.provider`/`.model` is what
 *  actually gets called and what Decision Intelligence's own metrics are keyed by. */
export interface BenchmarkModel {
  label: string;
  decisionIntelligenceConfig: DecisionIntelligenceProviderConfig;
}

/** One replay scenario: a factory that builds the full pipeline config (agent, policy, protocol
 *  registry, Replay execution target, telemetry) for a given model's decisionIntelligenceConfig.
 *  A factory rather than a static config so the same scenario can be replayed against every
 *  model under test while only the reasoning model varies. */
export interface BenchmarkScenario {
  id: string;
  buildConfig: (decisionIntelligenceConfig: DecisionIntelligenceProviderConfig) => KairosCompositionConfig;
}

export interface BenchmarkCenterConfig {
  scenarios: BenchmarkScenario[];
  models: BenchmarkModel[];
  /** Replays per (model, scenario) pair — defaults to 1. */
  runsPerScenario?: number;
}

/** Raw, per-run observation — the audit trail every aggregate in a ModelReport is computed from.
 *  Exposed on `BenchmarkReport.runs` so callers can verify no metric was fabricated. */
export interface BenchmarkRunRecord {
  modelLabel: string;
  scenarioId: string;
  runIndex: number;
  success: boolean;
  failureStage?: PipelineStageName;
  error?: string;
  totalDurationMs: number;
  /** `true`/`false` when the decision stage was attempted (produced valid JSON or didn't);
   *  `null` when the pipeline never reached the decision stage at all — not a data point. */
  jsonValid: boolean | null;
  /** Decision Intelligence's own overall confidence — only present alongside `jsonValid: true`. */
  confidence: number | null;
  /** Present only once the pipeline reached the outcome stage. `pnl` is a direct arithmetic
   *  transcription of the OutcomeRecord's own recorded fields (never inferred from balances):
   *  `amountExecuted - amountRequested - fees` for a successful execution, `-fees` for a failed
   *  one (a submitted-and-failed transaction still pays its network fee). */
  outcome: {
    executionStatus: 'success' | 'failed';
    amountRequested: string;
    amountExecuted: string;
    fees: string;
    pnl: number;
  } | null;
}

export interface MetricSummary {
  value: number;
  sampleCount: number;
}

export interface WinRateSummary {
  wins: number;
  losses: number;
  total: number;
  rate: number;
}

export interface LatencySummary {
  avgMs: number;
  p95Ms: number;
  sampleCount: number;
}

export interface TokenUsageSummary {
  avgPromptTokens: number;
  avgCompletionTokens: number;
  avgTotalTokens: number;
  totalTokens: number;
  sampleCount: number;
}

export interface JsonValiditySummary {
  validCount: number;
  invalidCount: number;
  attemptedCount: number;
  rate: number;
}

export interface ModelReport {
  label: string;
  provider: string;
  model: string;
  totalRuns: number;
  /** Runs that reached the outcome stage — the denominator for pnl/winRate/drawdown/sharpe. */
  outcomeCount: number;
  pnl: MetricSummary | null;
  totalPnl: number | null;
  winRate: WinRateSummary | null;
  drawdown: number | null;
  sharpe: number | null;
  latency: LatencySummary;
  tokenUsage: TokenUsageSummary | null;
  jsonValidity: JsonValiditySummary | null;
  confidence: MetricSummary | null;
}

export interface BenchmarkReport {
  generatedAt: number;
  scenarioIds: string[];
  models: ModelReport[];
  runs: BenchmarkRunRecord[];
}
