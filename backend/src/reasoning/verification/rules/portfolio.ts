// Stage 6: Portfolio. Concentration, diversification, duplicate exposure.
import type { ReasoningContext } from '../../types.js';
import type { DecisionIntelligence } from '../../decisionIntelligence/types.js';
import type { RuleResult } from '../types.js';

function pass(rule: string, message: string): RuleResult {
  return { rule, stage: 'portfolio', passed: true, severity: 'error', message };
}
function fail(rule: string, message: string, severity: RuleResult['severity'] = 'error'): RuleResult {
  return { rule, stage: 'portfolio', passed: false, severity, message };
}

/** A single decision pushing more than this fraction of capital into one asset is a
 *  concentration-risk safety rail, independent of the policy allocation ceiling. */
export const MAX_CONCENTRATION_FRACTION = 0.8;

export function runPortfolioRules(decision: DecisionIntelligence, context: ReasoningContext): RuleResult[] {
  const results: RuleResult[] = [];
  const { primaryDecision, alternatives } = decision;

  results.push(primaryDecision.allocation <= MAX_CONCENTRATION_FRACTION
    ? pass('portfolio.concentration_limit', `Allocation ${primaryDecision.allocation} is within the ${MAX_CONCENTRATION_FRACTION} concentration limit.`)
    : fail('portfolio.concentration_limit', `Allocation ${primaryDecision.allocation} exceeds the ${MAX_CONCENTRATION_FRACTION} concentration limit — over-concentrated in one position.`));

  const existingExposureCount = context.agentContext.capital.protocolExposure.length;
  const proposesNewProtocol = existingExposureCount > 0 && !context.agentContext.capital.protocolExposure.some((e) => e.protocolId === primaryDecision.protocol);
  results.push({
    rule: 'portfolio.diversification_check',
    stage: 'portfolio',
    passed: true,
    severity: 'warning',
    message: proposesNewProtocol
      ? `Decision introduces exposure to a new protocol ('${primaryDecision.protocol}') beyond the ${existingExposureCount} already held.`
      : 'Decision does not introduce a new, undiversified protocol concentration.',
  });

  const seen = new Set<string>();
  let duplicates = 0;
  for (const alt of [{ action: primaryDecision.action, protocol: primaryDecision.protocol, asset: primaryDecision.asset, allocation: primaryDecision.allocation }, ...alternatives]) {
    const key = `${alt.action}:${alt.protocol}:${alt.asset}:${alt.allocation.toFixed(4)}`;
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
  }
  results.push(duplicates === 0
    ? pass('portfolio.no_duplicate_exposure', 'Primary decision and alternatives propose no duplicate (action, protocol, asset, allocation) exposures.')
    : fail('portfolio.no_duplicate_exposure', `${duplicates} duplicate exposure tuple(s) found across primary decision and alternatives.`, 'warning'));

  return results;
}
