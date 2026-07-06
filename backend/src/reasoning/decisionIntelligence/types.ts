// Types for Reasoning Engine Phase 3 (Decision Intelligence). This is a distinct schema from
// Phase 1/2's CandidateDecision — it is never sent through the frozen LLM provider layer
// (providers/), because providers/schema.ts's structured-output JSON Schema hardcodes
// CandidateDecision's action enum and cannot express PrimaryAction's vocabulary. Decision
// Intelligence has its own request pipeline (requestClient.ts) that reuses provider
// configuration/error-classification/hashing utilities but never modifies providers/.
import type { AllowedPolicy } from '../validation.js';

export const DECISION_INTELLIGENCE_SCHEMA_VERSION = '1.0.0';
export const DECISION_PROMPT_TEMPLATE_VERSION = 'v2';

/** The only five actions Decision Intelligence may ever propose as a primary decision or
 *  alternative — the model must never invent a sixth. */
export const PRIMARY_ACTIONS = ['HOLD', 'DEPOSIT', 'WITHDRAW', 'SWAP', 'REBALANCE'] as const;
export type PrimaryAction = (typeof PRIMARY_ACTIONS)[number];

export const EVIDENCE_TYPES = [
  'market_indicator',
  'historical_statistic',
  'historical_pattern',
  'historical_conflict',
  'policy_rule',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export interface EvidenceItem {
  type: EvidenceType;
  source: string;
  detail: string;
  /** In [0, 1]. */
  weight: number;
}

/** One conclusion in the reasoning chain. `evidenceRefs` are indices into `evidence[]` — every
 *  reasoning step must cite at least one evidence item, and every ref must resolve to a real
 *  item (fail-closed "broken reference" rejection lives in validation.ts). */
export interface ReasoningStep {
  step: string;
  evidenceRefs: number[];
}

export interface PrimaryDecision {
  action: PrimaryAction;
  protocol: string;
  asset: string;
  /** Fraction of managed capital, in [0, 1]. */
  allocation: number;
  /** In [0, 1]. */
  confidence: number;
}

export interface AlternativeDecision {
  action: PrimaryAction;
  protocol: string;
  asset: string;
  allocation: number;
  confidence: number;
  tradeoffs: string;
}

export interface RiskItem {
  description: string;
  /** In [0, 1]. */
  probability: number;
  severity: 'low' | 'medium' | 'high';
  mitigation: string;
}

export interface UncertaintyAssessment {
  missingInformation: string[];
  conflictingEvidence: string[];
  lowConfidenceSignals: string[];
  /** In [0, 1] — overall uncertainty, independent of confidence. */
  score: number;
}

export type ExpectedDirection = 'up' | 'down' | 'flat' | 'uncertain';

/** Deliberately qualitative — "do not fabricate precision" means no invented percentage returns
 *  or price targets, only directional/qualitative language. */
export interface ExpectedOutcome {
  direction: ExpectedDirection;
  expectedBenefit: string;
  expectedDownside: string;
}

export interface ConfidenceBreakdown {
  overall: number;
  perSection: {
    primaryDecision: number;
    alternatives: number;
    evidence: number;
    risk: number;
    expectedOutcome: number;
  };
}

export interface DecisionIntelligenceMetadata {
  reasoningVersion: string;
  decisionVersion: string;
  promptVersion: string;
  providerVersion: string;
  reasoningDurationMs: number;
  evidenceCount: number;
  alternativeCount: number;
  uncertaintyScore: number;
  decisionHash: string;
  promptHash: string;
}

/** Immutable, structured Decision Intelligence output — still a proposal, never an execution
 *  instruction. No execution fields, no blockchain interaction, no memory writes. */
export interface DecisionIntelligence {
  decisionId: string;
  timestamp: number;
  primaryDecision: PrimaryDecision;
  alternatives: AlternativeDecision[];
  reasoningChain: ReasoningStep[];
  evidence: EvidenceItem[];
  risks: RiskItem[];
  assumptions: string[];
  uncertainty: UncertaintyAssessment;
  expectedOutcome: ExpectedOutcome;
  confidence: ConfidenceBreakdown;
  summary: string;
  metadata: DecisionIntelligenceMetadata;
}

export interface DecisionIntelligenceValidationResult {
  ok: boolean;
  errors: string[];
}

export type { AllowedPolicy };
