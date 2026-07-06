// In-process observability for Decision Intelligence. Parallel to providers/metrics.ts (not a
// modification of it) since Decision Intelligence has its own request pipeline outside providers/.
export interface DecisionIntelligenceObservability {
  provider: string;
  model: string;
  reasoningDurationMs: number;
  validationDurationMs: number;
  confidence: number;
  alternativeCount: number;
  evidenceCount: number;
  uncertaintyScore: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  providerLatencyMs: number;
  retryCount: number;
  failed: boolean;
  errorKind?: string;
}

interface DecisionIntelligenceAggregate {
  calls: number;
  failures: number;
  totalReasoningDurationMs: number;
  totalValidationDurationMs: number;
  totalProviderLatencyMs: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalRetries: number;
  lastConfidence: number | null;
}

function emptyAggregate(): DecisionIntelligenceAggregate {
  return {
    calls: 0, failures: 0, totalReasoningDurationMs: 0, totalValidationDurationMs: 0,
    totalProviderLatencyMs: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0,
    totalRetries: 0, lastConfidence: null,
  };
}

const aggregates = new Map<string, DecisionIntelligenceAggregate>();

export function recordDecisionIntelligenceCall(obs: DecisionIntelligenceObservability): void {
  const key = `${obs.provider}:${obs.model}`;
  const agg = aggregates.get(key) ?? emptyAggregate();
  agg.calls += 1;
  if (obs.failed) agg.failures += 1;
  agg.totalReasoningDurationMs += obs.reasoningDurationMs;
  agg.totalValidationDurationMs += obs.validationDurationMs;
  agg.totalProviderLatencyMs += obs.providerLatencyMs;
  agg.totalPromptTokens += obs.promptTokens;
  agg.totalCompletionTokens += obs.completionTokens;
  agg.totalTokens += obs.totalTokens;
  agg.totalRetries += obs.retryCount;
  agg.lastConfidence = obs.confidence;
  aggregates.set(key, agg);

  console.log(
    JSON.stringify({
      component: 'reasoning-engine-decision-intelligence',
      event: 'decision_intelligence_call',
      provider: obs.provider,
      model: obs.model,
      reasoningDurationMs: obs.reasoningDurationMs,
      validationDurationMs: obs.validationDurationMs,
      confidence: obs.confidence,
      alternativeCount: obs.alternativeCount,
      evidenceCount: obs.evidenceCount,
      uncertaintyScore: obs.uncertaintyScore,
      tokens: { promptTokens: obs.promptTokens, completionTokens: obs.completionTokens, totalTokens: obs.totalTokens },
      providerLatencyMs: obs.providerLatencyMs,
      retryCount: obs.retryCount,
      failed: obs.failed,
      errorKind: obs.errorKind,
    })
  );
}

export function getDecisionIntelligenceMetrics(): Record<string, DecisionIntelligenceAggregate> {
  return Object.fromEntries(aggregates.entries());
}

/** Test-only: resets in-memory aggregates between test cases. */
export function resetDecisionIntelligenceMetrics(): void {
  aggregates.clear();
}
