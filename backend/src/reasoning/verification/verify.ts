// Decision Verification pipeline: Schema -> Policy -> Capital -> Protocol -> Market -> Portfolio
// -> Evidence -> Consistency -> Risk -> Execution Feasibility -> Verification Report.
//
// Deterministic and pure: no AI, no LLM call, no execution, no memory writes. Every stage is a
// pure function of (decision, context) [+ an injectable `now` for the Market stage's staleness
// checks] — identical inputs always produce an identical VerificationResult, including
// `verificationHash`.
//
// The Schema stage is a hard gate: a structurally invalid DecisionIntelligence can't be safely
// read by later stages (e.g. accessing `.primaryDecision.allocation` on a malformed object), so a
// Schema failure short-circuits the pipeline and rejects immediately. Every other stage always
// runs and contributes to the full rule-result set, even if an earlier stage already failed —
// this gives a complete diagnostic picture rather than stopping at the first problem.
import { runSchemaRules } from './rules/schema.js';
import { runPolicyRules } from './rules/policy.js';
import { runCapitalRules } from './rules/capital.js';
import { runProtocolRules } from './rules/protocol.js';
import { runMarketRules } from './rules/market.js';
import { runPortfolioRules } from './rules/portfolio.js';
import { runEvidenceRules } from './rules/evidence.js';
import { runConsistencyRules } from './rules/consistency.js';
import { runRiskRules } from './rules/risk.js';
import { runExecutionRules } from './rules/execution.js';
import { hashVerification } from './hashing.js';
import { recordVerification } from './metrics.js';
import { VERIFICATION_ENGINE_VERSION, VERIFICATION_STAGES } from './types.js';
import type { ReasoningContext } from '../types.js';
import type { DecisionIntelligence } from '../decisionIntelligence/types.js';
import type { RuleResult, VerificationResult, VerificationStage } from './types.js';

export interface VerifyOptions {
  /** Injectable clock for the Market stage's staleness checks — defaults to the real clock, but
   *  tests pass a fixed value for full determinism. */
  now?: number;
}

function buildResult(status: 'verified' | 'rejected', decision: DecisionIntelligence, ruleResults: RuleResult[], stagesRun: VerificationStage[], verifiedAt: number): VerificationResult {
  const passedRules = ruleResults.filter((r) => r.passed).map((r) => r.rule);
  const failedRules = ruleResults.filter((r) => !r.passed && r.severity === 'error').map((r) => r.rule);
  const warnings = ruleResults.filter((r) => !r.passed && r.severity === 'warning').map((r) => `${r.rule}: ${r.message}`);
  const verificationHash = hashVerification(decision, ruleResults, VERIFICATION_ENGINE_VERSION);

  const base = {
    passedRules,
    failedRules,
    warnings,
    verificationHash,
    verificationVersion: VERIFICATION_ENGINE_VERSION,
    verifiedAt,
    stagesRun,
    ruleResults,
  };

  if (status === 'rejected') {
    const firstFailedStage = ruleResults.find((r) => !r.passed && r.severity === 'error')?.stage ?? stagesRun[stagesRun.length - 1];
    return { ...base, status: 'rejected', decision, rejectionStage: firstFailedStage };
  }
  return { ...base, status: 'verified', decision };
}

/** Runs the full Decision Verification pipeline. Synchronous and pure aside from the metrics
 *  side-effect (structured log + in-memory counters, mirroring every other Reasoning Engine phase). */
export function verifyDecision(decision: DecisionIntelligence, context: ReasoningContext, options: VerifyOptions = {}): VerificationResult {
  const start = performance.now();
  const now = options.now ?? Date.now();

  const schemaResults = runSchemaRules(decision);
  const schemaFailed = schemaResults.some((r) => !r.passed && r.severity === 'error');

  if (schemaFailed) {
    const result = buildResult('rejected', decision, schemaResults, ['schema'], now);
    recordVerification(result, performance.now() - start);
    return result;
  }

  const allResults: RuleResult[] = [
    ...schemaResults,
    ...runPolicyRules(decision, context),
    ...runCapitalRules(decision, context),
    ...runProtocolRules(decision, context),
    ...runMarketRules(decision, context, now),
    ...runPortfolioRules(decision, context),
    ...runEvidenceRules(decision),
    ...runConsistencyRules(decision),
    ...runRiskRules(decision, context),
    ...runExecutionRules(decision, context),
  ];

  const anyErrorFailed = allResults.some((r) => !r.passed && r.severity === 'error');
  const result = buildResult(anyErrorFailed ? 'rejected' : 'verified', decision, allResults, [...VERIFICATION_STAGES], now);
  recordVerification(result, performance.now() - start);
  return result;
}
