// JSON Schema for the structured decision output every provider must produce, plus the
// normalization step that turns a parsed JSON object into a full CandidateDecision. This is the
// only place a provider's raw JSON is interpreted — no provider-specific field escapes here.
import { randomUUID } from 'crypto';
import { hashCandidateDecision } from '../hashing.js';
import { buildCandidateDecisionMetadata } from '../metadata.js';
import type { CandidateDecision } from '../types.js';

/** Schema for the subset of CandidateDecision the model itself is responsible for — everything
 *  else (decisionId, timestamp, metadata) is stamped by the provider layer, never the model. */
export const CANDIDATE_DECISION_JSON_SCHEMA = {
  name: 'candidate_decision',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: { type: 'string', enum: ['open', 'close', 'increase', 'decrease', 'hold', 'rebalance'] },
      protocol: { type: 'string' },
      asset: { type: 'string' },
      allocation: { type: 'number', minimum: 0, maximum: 1 },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      reasoning: { type: 'string' },
      supportingEvidence: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            source: { type: 'string' },
            detail: { type: 'string' },
            weight: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['source', 'detail', 'weight'],
        },
      },
      risks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            description: { type: 'string' },
            severity: { type: 'string', enum: ['low', 'medium', 'high'] },
          },
          required: ['description', 'severity'],
        },
      },
      assumptions: { type: 'array', items: { type: 'string' } },
      alternatives: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: { type: 'string', enum: ['open', 'close', 'increase', 'decrease', 'hold', 'rebalance'] },
            reasoning: { type: 'string' },
          },
          required: ['action', 'reasoning'],
        },
      },
      uncertainty: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: [
      'action', 'protocol', 'asset', 'allocation', 'confidence', 'reasoning',
      'supportingEvidence', 'risks', 'assumptions', 'alternatives', 'uncertainty',
    ],
  },
} as const;

export class MalformedDecisionError extends Error {}

/** Parses a raw JSON string strictly — no partial-JSON recovery, no natural-language fallback.
 *  Throws MalformedDecisionError on anything that isn't a well-formed JSON object. */
export function parseStrictJson(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new MalformedDecisionError(`response is not valid JSON: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new MalformedDecisionError('response JSON must be an object');
  }
  return parsed as Record<string, unknown>;
}

export interface NormalizeInput {
  modelOutput: Record<string, unknown>;
  providerVersion: string;
  buildDurationMs: number;
  promptHash: string;
}

/** Builds a complete CandidateDecision from a model's raw JSON output, stamping the fields the
 *  model never produces (decisionId, timestamp, metadata, reasoningHash). Does not itself
 *  validate the result — callers run validateCandidateDecision and fail closed on any error. */
export function normalizeToCandidateDecision(input: NormalizeInput): CandidateDecision {
  const { modelOutput, providerVersion, buildDurationMs, promptHash } = input;
  const decisionId = randomUUID();
  const timestamp = Date.now();

  const metadata = buildCandidateDecisionMetadata({
    providerVersion,
    buildDurationMs,
    reasoningHash: 'pending',
    promptHash,
  });

  const decision: CandidateDecision = {
    decisionId,
    timestamp,
    action: modelOutput.action as CandidateDecision['action'],
    protocol: modelOutput.protocol as string,
    asset: modelOutput.asset as string,
    allocation: modelOutput.allocation as number,
    confidence: modelOutput.confidence as number,
    reasoning: modelOutput.reasoning as string,
    supportingEvidence: (modelOutput.supportingEvidence as CandidateDecision['supportingEvidence']) ?? [],
    risks: (modelOutput.risks as CandidateDecision['risks']) ?? [],
    assumptions: (modelOutput.assumptions as string[]) ?? [],
    alternatives: (modelOutput.alternatives as CandidateDecision['alternatives']) ?? [],
    uncertainty: modelOutput.uncertainty as number,
    metadata,
  };

  const reasoningHash = hashCandidateDecision(decision);
  return { ...decision, metadata: { ...decision.metadata, reasoningHash } };
}
