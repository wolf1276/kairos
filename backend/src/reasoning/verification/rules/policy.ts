// Stage 2: Policy. Allowed assets/protocols, allocation limits, objectives, permissions.
// Independent of (and more granular than) Phase 3's own policy check — each concern is its own
// named rule here rather than one joined error string.
import { deriveAllowedPolicy } from '../../validation.js';
import type { ReasoningContext } from '../../types.js';
import type { DecisionIntelligence } from '../../decisionIntelligence/types.js';
import type { RuleResult } from '../types.js';

function pass(rule: string, message: string): RuleResult {
  return { rule, stage: 'policy', passed: true, severity: 'error', message };
}
function fail(rule: string, message: string, severity: RuleResult['severity'] = 'error'): RuleResult {
  return { rule, stage: 'policy', passed: false, severity, message };
}

export function runPolicyRules(decision: DecisionIntelligence, context: ReasoningContext): RuleResult[] {
  const results: RuleResult[] = [];
  const allowed = deriveAllowedPolicy(context);
  const { primaryDecision, alternatives } = decision;
  const { userPolicy } = context;

  const protocolOk = allowed.allowedProtocols.some((p) => p.toLowerCase() === primaryDecision.protocol.toLowerCase());
  results.push(protocolOk
    ? pass('policy.protocol_allowed', `Protocol '${primaryDecision.protocol}' is within the allowed intersection.`)
    : fail('policy.protocol_allowed', `Protocol '${primaryDecision.protocol}' is not in the allowed protocol intersection: [${allowed.allowedProtocols.join(', ')}].`));

  const assetOk = allowed.allowedAssets.some((a) => a.toLowerCase() === primaryDecision.asset.toLowerCase());
  results.push(assetOk
    ? pass('policy.asset_allowed', `Asset '${primaryDecision.asset}' is within the allowed intersection.`)
    : fail('policy.asset_allowed', `Asset '${primaryDecision.asset}' is not in the allowed asset intersection: [${allowed.allowedAssets.join(', ')}].`));

  const ceilingFraction = userPolicy.maxAllocationPct / 100;
  const allocationOk = primaryDecision.allocation <= ceilingFraction;
  results.push(allocationOk
    ? pass('policy.allocation_ceiling', `Allocation ${primaryDecision.allocation} is within the ${userPolicy.maxAllocationPct}% ceiling.`)
    : fail('policy.allocation_ceiling', `Allocation ${primaryDecision.allocation} exceeds the ${userPolicy.maxAllocationPct}% policy ceiling.`));

  const objectivesOk = Array.isArray(userPolicy.objectives) && userPolicy.objectives.length > 0;
  results.push(objectivesOk
    ? pass('policy.objectives_present', 'UserPolicy declares at least one objective to verify against.')
    : fail('policy.objectives_present', 'UserPolicy has no objectives — cannot verify decision alignment against an empty objective set.'));

  const delegationOk = context.agentContext.policy.delegationActive === true;
  results.push(delegationOk
    ? pass('policy.delegation_permission', 'Delegation is active for this agent.')
    : fail('policy.delegation_permission', 'Delegation is not active — the agent has no permission to act.'));

  const confidenceOk = decision.confidence.overall >= userPolicy.minConfidence;
  results.push(confidenceOk
    ? pass('policy.min_confidence', `Overall confidence ${decision.confidence.overall} meets the policy minimum ${userPolicy.minConfidence}.`)
    : fail('policy.min_confidence', `Overall confidence ${decision.confidence.overall} is below the policy minimum ${userPolicy.minConfidence}.`));

  const badAlternatives = alternatives.filter(
    (alt) =>
      !allowed.allowedProtocols.some((p) => p.toLowerCase() === alt.protocol.toLowerCase()) ||
      !allowed.allowedAssets.some((a) => a.toLowerCase() === alt.asset.toLowerCase()) ||
      alt.allocation > ceilingFraction
  );
  results.push(badAlternatives.length === 0
    ? pass('policy.alternatives_compliant', 'Every alternative uses an allowed protocol/asset and respects the allocation ceiling.')
    : fail('policy.alternatives_compliant', `${badAlternatives.length} alternative(s) violate protocol/asset allowlist or the allocation ceiling.`, 'warning'));

  return results;
}
