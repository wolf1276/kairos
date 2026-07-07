// Execution Planner orchestrator: VerifiedDecision + AgentContext -> ExecutionPlan. Deterministic,
// synchronous, no AI/LLM, no blockchain call — this only builds a plan, never runs one.
import { randomUUID } from 'crypto';
import { runPrerequisiteChecks } from './rules.js';
import { estimateFee, estimateSlippage, estimateBalanceChanges, estimateStateChanges } from './estimate.js';
import { topologicalSort } from './dependencyGraph.js';
import { hashExecutionPlan } from './hashing.js';
import { EXECUTION_PLANNER_VERSION } from './types.js';
import type { ReasoningContext } from '../types.js';
import type { VerifiedDecision } from '../verification/types.js';
import type { PlanStep, RollbackStep, SimulationRequest, ExecutionPlan } from './types.js';

export class ExecutionPlanValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`Execution plan validation failed: ${errors.join('; ')}`);
    this.name = 'ExecutionPlanValidationError';
    this.errors = errors;
  }
}

/** Recursively freezes a plan so no downstream consumer can mutate it after it's built —
 *  same technique as reasoning/contextBuilder.ts::deepFreeze, duplicated locally rather than
 *  importing from a frozen Phase 1 file. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

function buildSteps(action: string, protocol: string, asset: string, allocation: number): PlanStep[] {
  if (action === 'HOLD') {
    return [{ stepId: 'step-0-confirm', type: 'confirm', action: 'no_op', protocol, asset, allocation: 0, dependsOn: [] }];
  }

  return [
    { stepId: 'step-0-prerequisite_check', type: 'prerequisite_check', action: action as PlanStep['action'], protocol, asset, allocation: 0, dependsOn: [] },
    { stepId: 'step-1-simulate', type: 'simulate', action: action as PlanStep['action'], protocol, asset, allocation, dependsOn: ['step-0-prerequisite_check'] },
    { stepId: 'step-2-execute', type: 'execute', action: action as PlanStep['action'], protocol, asset, allocation, dependsOn: ['step-1-simulate'] },
    { stepId: 'step-3-confirm', type: 'confirm', action: action as PlanStep['action'], protocol, asset, allocation: 0, dependsOn: ['step-2-execute'] },
  ];
}

function buildRollbackStrategy(steps: PlanStep[]): RollbackStep[] {
  const executeSteps = steps.filter((s) => s.type === 'execute');
  return executeSteps.map((s) => ({
    stepId: `rollback-${s.stepId}`,
    compensatesStepId: s.stepId,
    action: 'compensating_reverse',
    description: `If '${s.stepId}' (${s.action} on ${s.protocol}/${s.asset}) succeeded but a later step failed, reverse it: issue the inverse action (DEPOSIT<->WITHDRAW, or restore prior allocation for SWAP/REBALANCE) for the same allocation fraction.`,
  }));
}

function buildSimulationRequests(steps: PlanStep[]): SimulationRequest[] {
  return steps
    .filter((s) => s.type === 'simulate')
    .map((s) => ({ stepId: s.stepId, protocol: s.protocol, action: s.action as SimulationRequest['action'], asset: s.asset, amount: s.allocation.toFixed(6) }));
}

/**
 * Builds a deterministic ExecutionPlan from a VerifiedDecision + ReasoningContext. Throws
 * `ExecutionPlanValidationError` (fail closed) if the decision isn't actually `status: 'verified'`,
 * or if any prerequisite check (protocol/action/asset/balance) fails. Never executes anything —
 * the returned plan is a frozen, hashable, replayable description of what *would* be executed.
 */
export function buildExecutionPlan(decision: VerifiedDecision, context: ReasoningContext): ExecutionPlan {
  if (decision.status !== 'verified') {
    throw new ExecutionPlanValidationError([`cannot plan a decision with status '${(decision as { status: string }).status}' — only a VerifiedDecision may be planned`]);
  }

  const { primaryDecision } = decision.decision;
  const prerequisiteChecks = runPrerequisiteChecks(primaryDecision, context);
  const failedChecks = prerequisiteChecks.filter((c) => !c.passed);
  if (failedChecks.length > 0) {
    throw new ExecutionPlanValidationError(failedChecks.map((c) => `${c.check}: ${c.message}`));
  }

  const steps = buildSteps(primaryDecision.action, primaryDecision.protocol, primaryDecision.asset, primaryDecision.allocation);

  const sortResult = topologicalSort(steps.map((s) => ({ id: s.stepId, dependsOn: s.dependsOn })));
  if (!sortResult.ok) {
    throw new ExecutionPlanValidationError(sortResult.errors);
  }
  const orderedSteps = sortResult.order.map((id) => steps.find((s) => s.stepId === id)!);

  const protocolRouting: Record<string, string> = {};
  const assetRouting: Record<string, string> = {};
  const dependencies: Record<string, string[]> = {};
  for (const step of orderedSteps) {
    protocolRouting[step.stepId] = step.protocol;
    assetRouting[step.stepId] = step.asset;
    dependencies[step.stepId] = step.dependsOn;
  }

  const executionId = randomUUID();
  const timestamp = Date.now();

  const plan: ExecutionPlan = {
    executionId,
    planHash: 'pending',
    version: EXECUTION_PLANNER_VERSION,
    timestamp,
    steps: orderedSteps,
    protocolRouting,
    assetRouting,
    dependencies,
    prerequisiteChecks,
    rollbackStrategy: buildRollbackStrategy(orderedSteps),
    simulationRequests: buildSimulationRequests(orderedSteps),
    estimatedFees: [estimateFee(primaryDecision, context)],
    estimatedSlippage: [estimateSlippage(primaryDecision, context)],
    expectedBalanceChanges: estimateBalanceChanges(primaryDecision, context),
    expectedStateChanges: estimateStateChanges(primaryDecision, context),
    metadata: {
      plannerVersion: EXECUTION_PLANNER_VERSION,
      planHash: 'pending',
      decisionHash: decision.decision.metadata.decisionHash,
      verificationHash: decision.verificationHash,
      stepCount: orderedSteps.length,
    },
  };

  const planHash = hashExecutionPlan(plan);
  const finalPlan: ExecutionPlan = { ...plan, planHash, metadata: { ...plan.metadata, planHash } };
  return deepFreeze(finalPlan);
}
