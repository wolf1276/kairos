// Benchmark module types
import type { AgentContext } from '../../agentContext/index.js';
import type { MemoryPackage } from '../../memoryLayer/index.js';
import type { UserPolicy, CandidateDecision } from '../types.js';
import type { ProviderCallConfig } from '../providers/types.js';

export interface BenchmarkConfig {
  apiKey: string;
  topK?: number;
  maxConcurrency?: number;
  runsPerScenario?: number;
  outputDir?: string;
  judgeModel?: string;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  agentContext: AgentContext;
  memoryPackage: MemoryPackage;
  userPolicy: UserPolicy;
}

export interface BenchmarkRunResult {
  scenarioId: string;
  scenarioName: string;
  runIndex: number;
  model: string;
  success: boolean;
  decision?: CandidateDecision;
  validationResult?: { ok: boolean; errors: string[] };
  errorKind?: string;
  errorMessage?: string;
  latencyMs: number;
  providerCallEvent?: unknown;
  rawResponseSize?: number;
  rawResponse?: string;
  durationMs: number;
  fallbackOccurred: boolean;
}

export interface ModelAggregate {
  model: string;
  totalCalls: number;
  successCount: number;
  successRate: number;
  jsonValidCount: number;
  jsonValidRate: number;
  schemaValidCount: number;
  schemaValidRate: number;
  validationPassCount: number;
  validationPassRate: number;
  malformedCount: number;
  timeoutCount: number;
  retryCount: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  avgPromptTokens: number;
  avgCompletionTokens: number;
  avgTotalTokens: number;
  totalTokens: number;
  avgConfidence: number;
  avgResponseSize: number;
  determinismRate: number;
  fallbackOccurred: boolean;
  policyEscapeCount: number;
  policyEscapeRate: number;
  qualityScore: number;
  latencyMsSamples: number[];
}

export interface BenchmarkResult {
  config: BenchmarkConfig;
  models: ModelAggregate[];
  rankedModels: RankedModel[];
  recommended: RankedModel | null;
  runs: BenchmarkRunResult[];
  timestamp: string;
  topKModels: string[];
}

export interface RankedModel {
  model: string;
  aggregate: ModelAggregate;
  rank: number;
  weightedScore: number;
  categories: {
    bestOverall?: boolean;
    fastest?: boolean;
    lowestTokens?: boolean;
    mostReliable?: boolean;
    bestReasoning?: boolean;
  };
}

export interface ProviderCallEvent {
  component: string;
  event: string;
  provider: string;
  model: string;
  latencyMs: number;
  tokens: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  estimatedCost: number;
  retryCount: number;
  timedOut: boolean;
  failed: boolean;
  errorKind?: string;
  requestId?: string;
}
