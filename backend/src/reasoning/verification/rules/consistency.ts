// Stage 8: Consistency. Ensures reasoning, confidence, allocation, risk, and expected outcome
// all agree with each other — objective, deterministic heuristics only (no NLP/semantic judgment).
import type { DecisionIntelligence } from '../../decisionIntelligence/types.js';
import type { RuleResult } from '../types.js';

function pass(rule: string, message: string): RuleResult {
  return { rule, stage: 'consistency', passed: true, severity: 'error', message };
}
function fail(rule: string, message: string, severity: RuleResult['severity'] = 'error'): RuleResult {
  return { rule, stage: 'consistency', passed: false, severity, message };
}

/** Max allowed distance between overall confidence and the average of the five per-section
 *  confidence values before they're considered internally inconsistent. */
export const CONFIDENCE_ALIGNMENT_TOLERANCE = 0.3;
/** A decision claiming very low confidence should not simultaneously request a very large
 *  allocation — that pairing is internally inconsistent risk-taking. */
export const LOW_CONFIDENCE_THRESHOLD = 0.4;
export const HIGH_ALLOCATION_THRESHOLD = 0.5;
/** Above this uncertainty score, a decision claiming zero identified risks is inconsistent. */
export const HIGH_UNCERTAINTY_THRESHOLD = 0.7;

export function runConsistencyRules(decision: DecisionIntelligence): RuleResult[] {
  const results: RuleResult[] = [];
  const { confidence, primaryDecision, risks, uncertainty } = decision;

  const perSectionValues = Object.values(confidence.perSection);
  const avgPerSection = perSectionValues.reduce((a, b) => a + b, 0) / perSectionValues.length;
  const distance = Math.abs(confidence.overall - avgPerSection);
  results.push(distance <= CONFIDENCE_ALIGNMENT_TOLERANCE
    ? pass('consistency.confidence_alignment', `Overall confidence (${confidence.overall}) is within ${CONFIDENCE_ALIGNMENT_TOLERANCE} of the per-section average (${avgPerSection.toFixed(2)}).`)
    : fail('consistency.confidence_alignment', `Overall confidence (${confidence.overall}) diverges from the per-section average (${avgPerSection.toFixed(2)}) by more than ${CONFIDENCE_ALIGNMENT_TOLERANCE}.`, 'warning'));

  const lowConfidenceHighAllocation = confidence.overall <= LOW_CONFIDENCE_THRESHOLD && primaryDecision.allocation >= HIGH_ALLOCATION_THRESHOLD;
  results.push(!lowConfidenceHighAllocation
    ? pass('consistency.allocation_matches_confidence', 'Allocation size is consistent with stated confidence.')
    : fail('consistency.allocation_matches_confidence', `Low confidence (${confidence.overall}) paired with a large allocation (${primaryDecision.allocation}) is internally inconsistent.`));

  const highUncertaintyNoRisks = uncertainty.score >= HIGH_UNCERTAINTY_THRESHOLD && risks.length === 0;
  results.push(!highUncertaintyNoRisks
    ? pass('consistency.risk_matches_uncertainty', 'Risk assessment is consistent with the stated uncertainty level.')
    : fail('consistency.risk_matches_uncertainty', `High uncertainty (${uncertainty.score}) but zero identified risks is internally inconsistent.`));

  const { expectedOutcome } = decision;
  const bullishWithdraw = expectedOutcome.direction === 'up' && primaryDecision.action === 'WITHDRAW';
  const bearishDeposit = expectedOutcome.direction === 'down' && primaryDecision.action === 'DEPOSIT';
  results.push(!bullishWithdraw && !bearishDeposit
    ? pass('consistency.outcome_matches_action', 'Expected outcome direction is consistent with the primary action.')
    : fail(
        'consistency.outcome_matches_action',
        bullishWithdraw
          ? `Expected outcome is bullish ('up') but action is WITHDRAW — internally inconsistent.`
          : `Expected outcome is bearish ('down') but action is DEPOSIT — internally inconsistent.`
      ));

  return results;
}
