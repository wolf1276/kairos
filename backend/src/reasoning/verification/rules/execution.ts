// Stage 10: Execution Feasibility. Verifies the decision is actually executable given current
// system/wallet/cooldown state. A HOLD action requires no execution, so it's exempted from the
// system-readiness checks below (there is nothing to execute).
import type { ReasoningContext } from '../../types.js';
import type { DecisionIntelligence } from '../../decisionIntelligence/types.js';
import type { RuleResult } from '../types.js';

function pass(rule: string, message: string): RuleResult {
  return { rule, stage: 'execution_feasibility', passed: true, severity: 'error', message };
}
function fail(rule: string, message: string): RuleResult {
  return { rule, stage: 'execution_feasibility', passed: false, severity: 'error', message };
}

export const MAX_RECENT_FAILURES = 5;

export function runExecutionRules(decision: DecisionIntelligence, context: ReasoningContext): RuleResult[] {
  if (decision.primaryDecision.action === 'HOLD') {
    return [{ rule: 'execution.hold_no_op', stage: 'execution_feasibility', passed: true, severity: 'error', message: 'HOLD requires no execution — stage trivially satisfied.' }];
  }

  const results: RuleResult[] = [];
  const { system, historical, features } = context.agentContext;

  const systemReady = system.agentRunning && system.schedulerRunning && system.executionAvailable;
  results.push(systemReady
    ? pass('execution.system_ready', 'Agent, scheduler, and execution subsystem are all running.')
    : fail('execution.system_ready', `System not ready: agentRunning=${system.agentRunning}, schedulerRunning=${system.schedulerRunning}, executionAvailable=${system.executionAvailable}.`));

  results.push(!historical.cooldown.active
    ? pass('execution.no_cooldown', 'Agent is not in a cooldown period.')
    : fail('execution.no_cooldown', `Agent is in cooldown for ${historical.cooldown.remainingSeconds}s more.`));

  results.push(historical.recentFailureCount < MAX_RECENT_FAILURES
    ? pass('execution.no_recent_failures', `Recent failure count ${historical.recentFailureCount} is below the ${MAX_RECENT_FAILURES} threshold.`)
    : fail('execution.no_recent_failures', `Recent failure count ${historical.recentFailureCount} meets or exceeds the ${MAX_RECENT_FAILURES} threshold — too unreliable to execute.`));

  results.push(features.wallet.delegationActive
    ? pass('execution.wallet_ready', 'Wallet delegation is active.')
    : fail('execution.wallet_ready', 'Wallet delegation is not active — cannot execute on behalf of the owner.'));

  return results;
}
