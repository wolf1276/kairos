// Aggregates raw per-run BenchmarkRunResults into one summary per model. Pure data
// transformation — no calls to Reasoning/Provider code here.
import type { BenchmarkRunResult } from '../runners/executeScenario.js';

const NON_JSON_KINDS = new Set(['invalid_json', 'empty_response', 'timeout', 'network', 'rate_limit', 'provider_unavailable', 'model_unavailable', 'authentication']);

export interface ModelAggregate {
  modelId: string;
  provider: string;
  model: string;
  runs: number;
  successCount: number;
  jsonValidCount: number;
  validationFailedCount: number;
  policyViolationCount: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  avgPromptTokens: number;
  avgCompletionTokens: number;
  avgTotalTokens: number;
  avgResponseSizeBytes: number;
  totalRetries: number;
  avgConfidence: number | null;
  confidenceStdDev: number | null;
  avgEvidenceCount: number | null;
  avgReasoningChainLength: number | null;
  avgAlternativeCount: number | null;
  actionDistribution: Record<string, number>;
  errorKindCounts: Record<string, number>;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** A validation failure counts as a "policy violation" if any of its error strings mention the
 *  policy-enforcement checks validateDecisionIntelligence performs (protocol/asset allowlist,
 *  allocation ceiling) — distinct from schema-shape failures (missing fields, broken evidence
 *  references, etc). */
function isPolicyViolation(errors: string[]): boolean {
  return errors.some((e) => e.includes('not an allowed/supported') || e.includes('exceeds policy'));
}

export function aggregateByModel(results: BenchmarkRunResult[]): ModelAggregate[] {
  const byModel = new Map<string, BenchmarkRunResult[]>();
  for (const r of results) {
    const list = byModel.get(r.modelId) ?? [];
    list.push(r);
    byModel.set(r.modelId, list);
  }

  const aggregates: ModelAggregate[] = [];
  for (const [modelId, runs] of byModel.entries()) {
    const latencies = runs.map((r) => r.latencyMs).sort((a, b) => a - b);
    const successes = runs.filter((r) => r.success);
    const jsonValid = runs.filter((r) => r.success || r.errorKind === 'validation_failed');
    const validationFailed = runs.filter((r) => r.errorKind === 'validation_failed' || (r.success && !r.validationOk));
    const policyViolations = runs.filter((r) => isPolicyViolation(r.validationErrors));

    const confidences = successes.map((r) => r.decision!.confidence);
    const evidenceCounts = successes.map((r) => r.decision!.evidenceCount);
    const reasoningLengths = successes.map((r) => r.decision!.reasoningChainLength);
    const alternativeCounts = successes.map((r) => r.decision!.alternativeCount);

    const actionDistribution: Record<string, number> = {};
    for (const r of successes) {
      const action = r.decision!.action;
      actionDistribution[action] = (actionDistribution[action] ?? 0) + 1;
    }

    const errorKindCounts: Record<string, number> = {};
    for (const r of runs) {
      if (!r.success && r.errorKind) errorKindCounts[r.errorKind] = (errorKindCounts[r.errorKind] ?? 0) + 1;
    }

    aggregates.push({
      modelId,
      provider: runs[0].provider,
      model: runs[0].model,
      runs: runs.length,
      successCount: successes.length,
      jsonValidCount: jsonValid.length,
      validationFailedCount: validationFailed.length,
      policyViolationCount: policyViolations.length,
      avgLatencyMs: mean(latencies) ?? 0,
      p95LatencyMs: percentile(latencies, 95),
      p99LatencyMs: percentile(latencies, 99),
      avgPromptTokens: mean(runs.map((r) => r.promptTokens)) ?? 0,
      avgCompletionTokens: mean(runs.map((r) => r.completionTokens)) ?? 0,
      avgTotalTokens: mean(runs.map((r) => r.totalTokens)) ?? 0,
      avgResponseSizeBytes: mean(runs.map((r) => r.responseSizeBytes)) ?? 0,
      totalRetries: runs.reduce((sum, r) => sum + r.retryCount, 0),
      avgConfidence: mean(confidences),
      confidenceStdDev: stdDev(confidences),
      avgEvidenceCount: mean(evidenceCounts),
      avgReasoningChainLength: mean(reasoningLengths),
      avgAlternativeCount: mean(alternativeCounts),
      actionDistribution,
      errorKindCounts,
    });
  }

  return aggregates.sort((a, b) => a.modelId.localeCompare(b.modelId));
}

export { NON_JSON_KINDS, isPolicyViolation };
