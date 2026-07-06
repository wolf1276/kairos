// JSON Schema for Decision Intelligence's structured output, plus strict parsing. Independent of
// providers/schema.ts's CANDIDATE_DECISION_JSON_SCHEMA — that schema's action enum cannot express
// PrimaryAction's vocabulary (HOLD/DEPOSIT/WITHDRAW/SWAP/REBALANCE), so this is a parallel schema,
// not a modification of the frozen one.
export class MalformedDecisionIntelligenceError extends Error {}

const ACTION_ENUM = ['HOLD', 'DEPOSIT', 'WITHDRAW', 'SWAP', 'REBALANCE'];
const EVIDENCE_TYPE_ENUM = ['market_indicator', 'historical_statistic', 'historical_pattern', 'historical_conflict', 'policy_rule'];
const SEVERITY_ENUM = ['low', 'medium', 'high'];
const DIRECTION_ENUM = ['up', 'down', 'flat', 'uncertain'];

export const DECISION_INTELLIGENCE_JSON_SCHEMA = {
  name: 'decision_intelligence',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      primaryDecision: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ACTION_ENUM },
          protocol: { type: 'string' },
          asset: { type: 'string' },
          allocation: { type: 'number', minimum: 0, maximum: 1 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['action', 'protocol', 'asset', 'allocation', 'confidence'],
      },
      alternatives: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: { type: 'string', enum: ACTION_ENUM },
            protocol: { type: 'string' },
            asset: { type: 'string' },
            allocation: { type: 'number', minimum: 0, maximum: 1 },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            tradeoffs: { type: 'string' },
          },
          required: ['action', 'protocol', 'asset', 'allocation', 'confidence', 'tradeoffs'],
        },
      },
      reasoningChain: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            step: { type: 'string' },
            evidenceRefs: { type: 'array', items: { type: 'integer' } },
          },
          required: ['step', 'evidenceRefs'],
        },
      },
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { type: 'string', enum: EVIDENCE_TYPE_ENUM },
            source: { type: 'string' },
            detail: { type: 'string' },
            weight: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['type', 'source', 'detail', 'weight'],
        },
      },
      risks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            description: { type: 'string' },
            probability: { type: 'number', minimum: 0, maximum: 1 },
            severity: { type: 'string', enum: SEVERITY_ENUM },
            mitigation: { type: 'string' },
          },
          required: ['description', 'probability', 'severity', 'mitigation'],
        },
      },
      assumptions: { type: 'array', items: { type: 'string' } },
      uncertainty: {
        type: 'object',
        additionalProperties: false,
        properties: {
          missingInformation: { type: 'array', items: { type: 'string' } },
          conflictingEvidence: { type: 'array', items: { type: 'string' } },
          lowConfidenceSignals: { type: 'array', items: { type: 'string' } },
          score: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['missingInformation', 'conflictingEvidence', 'lowConfidenceSignals', 'score'],
      },
      expectedOutcome: {
        type: 'object',
        additionalProperties: false,
        properties: {
          direction: { type: 'string', enum: DIRECTION_ENUM },
          expectedBenefit: { type: 'string' },
          expectedDownside: { type: 'string' },
        },
        required: ['direction', 'expectedBenefit', 'expectedDownside'],
      },
      confidence: {
        type: 'object',
        additionalProperties: false,
        properties: {
          overall: { type: 'number', minimum: 0, maximum: 1 },
          perSection: {
            type: 'object',
            additionalProperties: false,
            properties: {
              primaryDecision: { type: 'number', minimum: 0, maximum: 1 },
              alternatives: { type: 'number', minimum: 0, maximum: 1 },
              evidence: { type: 'number', minimum: 0, maximum: 1 },
              risk: { type: 'number', minimum: 0, maximum: 1 },
              expectedOutcome: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['primaryDecision', 'alternatives', 'evidence', 'risk', 'expectedOutcome'],
          },
        },
        required: ['overall', 'perSection'],
      },
      summary: { type: 'string' },
    },
    required: [
      'primaryDecision', 'alternatives', 'reasoningChain', 'evidence', 'risks', 'assumptions',
      'uncertainty', 'expectedOutcome', 'confidence', 'summary',
    ],
  },
} as const;

/** Parses a raw JSON string strictly — no partial-JSON recovery, no natural-language fallback,
 *  same fail-closed contract as providers/schema.ts::parseStrictJson. */
export function parseStrictJson(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new MalformedDecisionIntelligenceError(`response is not valid JSON: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new MalformedDecisionIntelligenceError('response JSON must be an object');
  }
  return parsed as Record<string, unknown>;
}
