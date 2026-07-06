// Builds a complete DecisionIntelligence from a model's raw JSON output, stamping the fields the
// model never produces (decisionId, timestamp, metadata, decisionHash). Does not itself
// validate — callers run validateDecisionIntelligence and fail closed on any error.
import { randomUUID } from 'crypto';
import { hashDecisionIntelligence } from './hashing.js';
import { DECISION_INTELLIGENCE_SCHEMA_VERSION, DECISION_PROMPT_TEMPLATE_VERSION } from './types.js';
import type { DecisionIntelligence } from './types.js';

export interface NormalizeInput {
  modelOutput: Record<string, unknown>;
  providerVersion: string;
  reasoningDurationMs: number;
  promptHash: string;
}

export function normalizeToDecisionIntelligence(input: NormalizeInput): DecisionIntelligence {
  const { modelOutput, providerVersion, reasoningDurationMs, promptHash } = input;
  const decisionId = randomUUID();
  const timestamp = Date.now();

  const evidence = (modelOutput.evidence as DecisionIntelligence['evidence']) ?? [];
  const alternatives = (modelOutput.alternatives as DecisionIntelligence['alternatives']) ?? [];
  // Deliberately NOT defaulted: a missing `uncertainty` object must reach validateDecisionIntelligence
  // as missing (so its required-object check rejects it), not be silently papered over here.
  const uncertainty = modelOutput.uncertainty as DecisionIntelligence['uncertainty'];

  const decision: DecisionIntelligence = {
    decisionId,
    timestamp,
    primaryDecision: modelOutput.primaryDecision as DecisionIntelligence['primaryDecision'],
    alternatives,
    reasoningChain: (modelOutput.reasoningChain as DecisionIntelligence['reasoningChain']) ?? [],
    evidence,
    risks: (modelOutput.risks as DecisionIntelligence['risks']) ?? [],
    assumptions: (modelOutput.assumptions as string[]) ?? [],
    uncertainty,
    expectedOutcome: modelOutput.expectedOutcome as DecisionIntelligence['expectedOutcome'],
    confidence: modelOutput.confidence as DecisionIntelligence['confidence'],
    summary: modelOutput.summary as string,
    metadata: {
      reasoningVersion: DECISION_INTELLIGENCE_SCHEMA_VERSION,
      decisionVersion: DECISION_INTELLIGENCE_SCHEMA_VERSION,
      promptVersion: DECISION_PROMPT_TEMPLATE_VERSION,
      providerVersion,
      reasoningDurationMs,
      evidenceCount: evidence.length,
      alternativeCount: alternatives.length,
      uncertaintyScore: uncertainty?.score ?? 0,
      decisionHash: 'pending',
      promptHash,
    },
  };

  const decisionHash = hashDecisionIntelligence(decision);
  return { ...decision, metadata: { ...decision.metadata, decisionHash } };
}
