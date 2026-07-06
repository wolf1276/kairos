// Benchmark scoring: turns a ModelAggregate into a single 0-100 score plus its component
// sub-scores, so models/providers are comparable at a glance. Weights are deliberately explicit
// and documented here — change them in one place if priorities shift.
import type { ModelAggregate } from './aggregate.js';

export interface ModelScore {
  modelId: string;
  overall: number;
  components: {
    jsonQuality: number;
    validationPassRate: number;
    policyCompliance: number;
    evidenceQuality: number;
    reasoningQuality: number;
    latency: number;
    tokenEfficiency: number;
  };
}

const WEIGHTS = {
  validationPassRate: 0.25,
  jsonQuality: 0.15,
  policyCompliance: 0.15,
  evidenceQuality: 0.15,
  reasoningQuality: 0.1,
  latency: 0.1,
  tokenEfficiency: 0.1,
};

/** Ceilings beyond which latency/token scores bottom out at 0 — deliberately generous given
 *  Decision Intelligence's schema is verbose (observed live: 44-75s, ~3,500-3,700 tokens for
 *  NVIDIA). Tune these if the reasoning architecture changes enough to shift the baseline. */
const LATENCY_CEILING_MS = 90_000;
const TOKEN_CEILING = 8_000;
/** "Reasonable" evidence/reasoning-chain length targets — a model citing 0 evidence scores 0;
 *  hitting the target or more scores 100 (not a hard cap on going further). */
const EVIDENCE_TARGET = 8;
const REASONING_CHAIN_TARGET = 6;

function clampPct(fraction: number): number {
  return Math.max(0, Math.min(100, fraction * 100));
}

function inverseNormalize(value: number, ceiling: number): number {
  if (ceiling <= 0) return 0;
  return clampPct(1 - value / ceiling);
}

function targetNormalize(value: number, target: number): number {
  if (target <= 0) return 0;
  return clampPct(value / target);
}

export function scoreModel(agg: ModelAggregate): ModelScore {
  const jsonQuality = agg.runs > 0 ? clampPct(agg.jsonValidCount / agg.runs) : 0;
  const validationPassRate = agg.runs > 0 ? clampPct(agg.successCount / agg.runs) : 0;
  const policyCompliance = agg.runs > 0 ? clampPct(1 - agg.policyViolationCount / agg.runs) : 0;
  const evidenceQuality = agg.avgEvidenceCount !== null ? targetNormalize(agg.avgEvidenceCount, EVIDENCE_TARGET) : 0;
  const reasoningQuality = agg.avgReasoningChainLength !== null ? targetNormalize(agg.avgReasoningChainLength, REASONING_CHAIN_TARGET) : 0;
  const latency = inverseNormalize(agg.avgLatencyMs, LATENCY_CEILING_MS);
  const tokenEfficiency = inverseNormalize(agg.avgTotalTokens, TOKEN_CEILING);

  const overall =
    jsonQuality * WEIGHTS.jsonQuality +
    validationPassRate * WEIGHTS.validationPassRate +
    policyCompliance * WEIGHTS.policyCompliance +
    evidenceQuality * WEIGHTS.evidenceQuality +
    reasoningQuality * WEIGHTS.reasoningQuality +
    latency * WEIGHTS.latency +
    tokenEfficiency * WEIGHTS.tokenEfficiency;

  return {
    modelId: agg.modelId,
    overall: Math.round(overall * 10) / 10,
    components: {
      jsonQuality: Math.round(jsonQuality * 10) / 10,
      validationPassRate: Math.round(validationPassRate * 10) / 10,
      policyCompliance: Math.round(policyCompliance * 10) / 10,
      evidenceQuality: Math.round(evidenceQuality * 10) / 10,
      reasoningQuality: Math.round(reasoningQuality * 10) / 10,
      latency: Math.round(latency * 10) / 10,
      tokenEfficiency: Math.round(tokenEfficiency * 10) / 10,
    },
  };
}

export function scoreAllModels(aggregates: ModelAggregate[]): ModelScore[] {
  return aggregates.map(scoreModel);
}

export { WEIGHTS as SCORE_WEIGHTS };
