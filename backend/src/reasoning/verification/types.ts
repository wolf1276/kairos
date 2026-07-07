// Types for Reasoning Engine Phase 4 (Decision Verification). Deterministic, rule-based — no AI,
// no LLM call, no execution, no memory writes. Consumes a DecisionIntelligence (Phase 3, frozen)
// + ReasoningContext (Phase 1, frozen) and produces VerifiedDecision | RejectedDecision. Every
// rule is a pure function of its inputs — identical inputs always produce identical output.
import type { DecisionIntelligence } from '../decisionIntelligence/types.js';

export const VERIFICATION_ENGINE_VERSION = '1.0.0';

export const VERIFICATION_STAGES = [
  'schema',
  'policy',
  'capital',
  'protocol',
  'market',
  'portfolio',
  'evidence',
  'consistency',
  'risk',
  'execution_feasibility',
] as const;
export type VerificationStage = (typeof VERIFICATION_STAGES)[number];

export type RuleSeverity = 'error' | 'warning';

/** One rule's outcome. `rule` is a stable, namespaced id (e.g. "policy.allocation_ceiling") —
 *  stable across runs so regression tooling and dashboards can key off it. */
export interface RuleResult {
  rule: string;
  stage: VerificationStage;
  passed: boolean;
  severity: RuleSeverity;
  message: string;
}

export interface VerificationReportBase {
  passedRules: string[];
  failedRules: string[];
  warnings: string[];
  verificationHash: string;
  verificationVersion: string;
  verifiedAt: number;
  stagesRun: VerificationStage[];
  ruleResults: RuleResult[];
}

export interface VerifiedDecision extends VerificationReportBase {
  status: 'verified';
  decision: DecisionIntelligence;
}

export interface RejectedDecision extends VerificationReportBase {
  status: 'rejected';
  decision: DecisionIntelligence;
  /** The first stage (in pipeline order) that produced an error-severity failure. */
  rejectionStage: VerificationStage;
}

export type VerificationResult = VerifiedDecision | RejectedDecision;
