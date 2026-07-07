// Stage 3: Capital. Available capital, negative balances, allocation totals.
import type { ReasoningContext } from '../../types.js';
import type { DecisionIntelligence } from '../../decisionIntelligence/types.js';
import type { RuleResult } from '../types.js';

function pass(rule: string, message: string): RuleResult {
  return { rule, stage: 'capital', passed: true, severity: 'error', message };
}
function fail(rule: string, message: string): RuleResult {
  return { rule, stage: 'capital', passed: false, severity: 'error', message };
}

export function runCapitalRules(decision: DecisionIntelligence, context: ReasoningContext): RuleResult[] {
  const results: RuleResult[] = [];
  const { capital } = context.agentContext;
  const { primaryDecision } = decision;

  // Number.isFinite rejects NaN AND +/-Infinity — a bare `>= 0` check alone lets Infinity through
  // (Infinity >= 0 is true), which then makes every downstream "requestedCapital <= X" comparison
  // vacuously true once X is also Infinity. Found during the Phase 4 final production audit.
  const allFinite = Number.isFinite(capital.totalManagedCapital) && Number.isFinite(capital.idleCapital) && Number.isFinite(capital.deployableCapital);
  const noNegativeBalances = allFinite && capital.totalManagedCapital >= 0 && capital.idleCapital >= 0 && capital.deployableCapital >= 0;
  results.push(noNegativeBalances
    ? pass('capital.no_negative_balances', 'Total managed, idle, and deployable capital are all non-negative, finite numbers.')
    : fail('capital.no_negative_balances', `Invalid capital balance detected (total=${capital.totalManagedCapital}, idle=${capital.idleCapital}, deployable=${capital.deployableCapital}) — must be finite and non-negative.`));

  const requestedCapital = primaryDecision.allocation * capital.totalManagedCapital;
  const sufficientDeployable = allFinite && Number.isFinite(requestedCapital) && requestedCapital <= capital.deployableCapital;
  results.push(sufficientDeployable
    ? pass('capital.available_capital', `Requested capital ${requestedCapital.toFixed(2)} is within deployable capital ${capital.deployableCapital}.`)
    : fail('capital.available_capital', `Requested capital ${requestedCapital} exceeds deployable capital ${capital.deployableCapital}, or one of the values is non-finite.`));

  const withinTotal = allFinite && Number.isFinite(requestedCapital) && requestedCapital <= capital.totalManagedCapital;
  results.push(withinTotal
    ? pass('capital.allocation_totals', `Requested capital ${requestedCapital.toFixed(2)} does not exceed total managed capital ${capital.totalManagedCapital}.`)
    : fail('capital.allocation_totals', `Requested capital ${requestedCapital} exceeds total managed capital ${capital.totalManagedCapital}, or one of the values is non-finite — impossible allocation.`));

  return results;
}
