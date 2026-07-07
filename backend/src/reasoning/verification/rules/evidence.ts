// Stage 7: Evidence. References exist, no hallucinated evidence, no broken references. Mostly
// defense-in-depth re-verification of what the Schema stage already checked via
// validateDecisionIntelligence — kept as its own stage per the pipeline spec, with its own named
// rules, in case the Schema stage's checks ever diverge from this one.
import { EVIDENCE_TYPES } from '../../decisionIntelligence/types.js';
import type { DecisionIntelligence } from '../../decisionIntelligence/types.js';
import type { RuleResult } from '../types.js';

function pass(rule: string, message: string): RuleResult {
  return { rule, stage: 'evidence', passed: true, severity: 'error', message };
}
function fail(rule: string, message: string): RuleResult {
  return { rule, stage: 'evidence', passed: false, severity: 'error', message };
}

const VALID_EVIDENCE_TYPES = new Set<string>(EVIDENCE_TYPES);

export function runEvidenceRules(decision: DecisionIntelligence): RuleResult[] {
  const results: RuleResult[] = [];
  const { evidence, reasoningChain } = decision;

  results.push(evidence.length > 0
    ? pass('evidence.non_empty', `${evidence.length} evidence item(s) present.`)
    : fail('evidence.non_empty', 'No evidence provided — nothing to verify the decision against.'));

  const invalidTypeCount = evidence.filter((e) => !VALID_EVIDENCE_TYPES.has(e.type)).length;
  results.push(invalidTypeCount === 0
    ? pass('evidence.valid_types', 'Every evidence item uses a canonical evidence type.')
    : fail('evidence.valid_types', `${invalidTypeCount} evidence item(s) use a non-canonical type.`));

  const brokenRefs: string[] = [];
  reasoningChain.forEach((step, i) => {
    if (step.evidenceRefs.length === 0) {
      brokenRefs.push(`reasoningChain[${i}] cites no evidence`);
      return;
    }
    for (const ref of step.evidenceRefs) {
      if (!Number.isInteger(ref) || ref < 0 || ref >= evidence.length) {
        brokenRefs.push(`reasoningChain[${i}] references evidence[${ref}], which does not exist`);
      }
    }
  });
  results.push(brokenRefs.length === 0
    ? pass('evidence.references_resolve', 'Every reasoning step cites at least one evidence item that actually exists.')
    : fail('evidence.references_resolve', `${brokenRefs.length} broken/hallucinated evidence reference(s): ${brokenRefs.join('; ')}`));

  const seen = new Set<string>();
  let duplicates = 0;
  for (const item of evidence) {
    const key = `${item.source}::${item.detail}`;
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
  }
  results.push(duplicates === 0
    ? pass('evidence.no_duplicates', 'No duplicate evidence entries.')
    : fail('evidence.no_duplicates', `${duplicates} duplicate evidence entrie(s) found.`));

  return results;
}
