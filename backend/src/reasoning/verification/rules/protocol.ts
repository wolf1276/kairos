// Stage 4: Protocol. Protocol execution enabled, supported action, protocol-level restrictions
// (agent's own position limit — distinct from the user policy allocation ceiling checked in the
// Policy stage).
import { PRIMARY_ACTIONS } from '../../decisionIntelligence/types.js';
import type { ReasoningContext } from '../../types.js';
import type { DecisionIntelligence } from '../../decisionIntelligence/types.js';
import type { RuleResult } from '../types.js';

function pass(rule: string, message: string): RuleResult {
  return { rule, stage: 'protocol', passed: true, severity: 'error', message };
}
function fail(rule: string, message: string): RuleResult {
  return { rule, stage: 'protocol', passed: false, severity: 'error', message };
}

const VALID_ACTIONS = new Set<string>(PRIMARY_ACTIONS);

export function runProtocolRules(decision: DecisionIntelligence, context: ReasoningContext): RuleResult[] {
  const results: RuleResult[] = [];
  const { system, policy } = context.agentContext;
  const { primaryDecision } = decision;

  results.push(system.protocolExecutionAvailable
    ? pass('protocol.enabled', 'Protocol execution is currently available for this agent.')
    : fail('protocol.enabled', 'Protocol execution is not available — the agent cannot act on any protocol right now.'));

  const actionOk = VALID_ACTIONS.has(primaryDecision.action);
  results.push(actionOk
    ? pass('protocol.supported_action', `Action '${primaryDecision.action}' is a supported action.`)
    : fail('protocol.supported_action', `Action '${primaryDecision.action}' is not one of the supported actions: ${PRIMARY_ACTIONS.join(', ')}.`));

  const maxCapital = Number(policy.positionLimit?.maxCapital);
  const requestedCapital = primaryDecision.allocation * context.agentContext.capital.totalManagedCapital;
  const withinPositionLimit = !Number.isFinite(maxCapital) || requestedCapital <= maxCapital;
  results.push(withinPositionLimit
    ? pass('protocol.position_limit', `Requested capital ${requestedCapital.toFixed(2)} is within the agent's position limit.`)
    : fail('protocol.position_limit', `Requested capital ${requestedCapital.toFixed(2)} exceeds the agent's position limit of ${maxCapital}.`));

  return results;
}
