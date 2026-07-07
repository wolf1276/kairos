// Prerequisite checks: supported protocol, supported action, asset exists, balances sufficient.
// Pure functions, read-only reuse of frozen Reasoning Foundation/Decision Intelligence exports —
// no modification of validation.ts or decisionIntelligence/types.ts.
import { deriveAllowedPolicy } from '../validation.js';
import { PRIMARY_ACTIONS } from '../decisionIntelligence/types.js';
import type { ReasoningContext } from '../types.js';
import type { PrimaryDecision } from '../decisionIntelligence/types.js';
import type { PrerequisiteCheck } from './types.js';

const VALID_ACTIONS = new Set<string>(PRIMARY_ACTIONS);

export function runPrerequisiteChecks(primaryDecision: PrimaryDecision, context: ReasoningContext): PrerequisiteCheck[] {
  const checks: PrerequisiteCheck[] = [];
  const allowed = deriveAllowedPolicy(context);

  const protocolOk = allowed.allowedProtocols.some((p) => p.toLowerCase() === primaryDecision.protocol.toLowerCase());
  checks.push({
    check: 'supported_protocol',
    passed: protocolOk,
    message: protocolOk ? `Protocol '${primaryDecision.protocol}' is supported.` : `Protocol '${primaryDecision.protocol}' is not in the allowed intersection: [${allowed.allowedProtocols.join(', ')}].`,
  });

  const actionOk = VALID_ACTIONS.has(primaryDecision.action);
  checks.push({
    check: 'supported_action',
    passed: actionOk,
    message: actionOk ? `Action '${primaryDecision.action}' is supported.` : `Action '${primaryDecision.action}' is not one of: ${PRIMARY_ACTIONS.join(', ')}.`,
  });

  const assetOk = allowed.allowedAssets.some((a) => a.toLowerCase() === primaryDecision.asset.toLowerCase());
  checks.push({
    check: 'asset_exists',
    passed: assetOk,
    message: assetOk ? `Asset '${primaryDecision.asset}' is supported.` : `Asset '${primaryDecision.asset}' is not in the allowed intersection: [${allowed.allowedAssets.join(', ')}].`,
  });

  // A HOLD moves no capital and calls no protocol, so a disabled protocol subsystem doesn't
  // block it — every other action requires protocolExecutionAvailable.
  const protocolEnabled = primaryDecision.action === 'HOLD' || context.agentContext.system.protocolExecutionAvailable === true;
  checks.push({
    check: 'protocol_enabled',
    passed: protocolEnabled,
    message: protocolEnabled ? 'Protocol execution is currently available.' : 'Protocol execution is disabled for this agent — cannot plan any protocol-calling action.',
  });

  // Defense-in-depth: the type system says PrimaryDecision.allocation is a validated [0,1]
  // fraction (guaranteed by Decision Intelligence's schema stage for anything that actually went
  // through verifyDecision), but nothing at runtime prevents a caller from constructing/forging a
  // VerifiedDecision-shaped object directly. The planner must not propagate a negative or
  // out-of-range allocation into capital math just because upstream *should* have caught it.
  const allocationInRange = Number.isFinite(primaryDecision.allocation) && primaryDecision.allocation >= 0 && primaryDecision.allocation <= 1;
  checks.push({
    check: 'allocation_in_range',
    passed: allocationInRange,
    message: allocationInRange ? `Allocation ${primaryDecision.allocation} is a valid fraction in [0, 1].` : `Allocation ${primaryDecision.allocation} is not a finite number in [0, 1].`,
  });

  const { capital } = context.agentContext;
  const balancesFinite = Number.isFinite(capital.totalManagedCapital) && Number.isFinite(capital.deployableCapital) && Number.isFinite(capital.idleCapital);
  const balancesNonNegative = balancesFinite && capital.totalManagedCapital >= 0 && capital.deployableCapital >= 0 && capital.idleCapital >= 0;
  checks.push({
    check: 'balances_non_negative',
    passed: balancesNonNegative,
    message: balancesNonNegative
      ? 'Total managed, idle, and deployable capital are all finite and non-negative.'
      : `Invalid capital balance (total=${capital.totalManagedCapital}, idle=${capital.idleCapital}, deployable=${capital.deployableCapital}) — must be finite and non-negative.`,
  });

  const requestedCapital = primaryDecision.allocation * capital.totalManagedCapital;
  const balanceOk = balancesNonNegative && Number.isFinite(requestedCapital) && requestedCapital <= capital.deployableCapital;
  checks.push({
    check: 'balances_sufficient',
    passed: balanceOk,
    message: balanceOk
      ? `Requested capital ${requestedCapital.toFixed(2)} is within deployable capital ${capital.deployableCapital}.`
      : `Requested capital ${requestedCapital} exceeds deployable capital ${capital.deployableCapital}, or a balance is invalid.`,
  });

  return checks;
}
