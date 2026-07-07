// Stage 1: Schema. Reuses Phase 3's own validateDecisionIntelligence (imported, never modified)
// for shape/enum/range/evidence-reference/hash correctness — required fields, enums, allocation,
// confidence, metadata, hashes. Policy compliance is deliberately NOT checked here (no `allowed`/
// `maxAllocationPct` passed) — that's the Policy stage's job, with its own named, granular rules.
import { validateDecisionIntelligence } from '../../decisionIntelligence/validation.js';
import type { DecisionIntelligence } from '../../decisionIntelligence/types.js';
import type { RuleResult } from '../types.js';

export function runSchemaRules(decision: DecisionIntelligence): RuleResult[] {
  const result = validateDecisionIntelligence(decision);

  if (result.ok) {
    return [{ rule: 'schema.valid', stage: 'schema', passed: true, severity: 'error', message: 'DecisionIntelligence shape, enums, ranges, references, and hash are all valid.' }];
  }

  return result.errors.map((message, i) => ({
    rule: `schema.error_${i}`,
    stage: 'schema',
    passed: false,
    severity: 'error',
    message,
  }));
}
