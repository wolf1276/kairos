// Public surface of Decision Verification (Phase 4). Callers import only from here.
export { verifyDecision } from './verify.js';
export { hashVerification } from './hashing.js';
export { getVerificationMetrics, resetVerificationMetrics } from './metrics.js';
export { VERIFICATION_ENGINE_VERSION, VERIFICATION_STAGES } from './types.js';

export type {
  VerificationStage,
  RuleSeverity,
  RuleResult,
  VerificationReportBase,
  VerifiedDecision,
  RejectedDecision,
  VerificationResult,
} from './types.js';
export type { VerifyOptions } from './verify.js';
