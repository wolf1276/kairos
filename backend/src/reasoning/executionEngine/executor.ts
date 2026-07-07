// Execution Engine orchestrator (Phase 6): ExecutionPlan -> ExecutionResult. Deterministic given
// a deterministic adapter registry — no AI/LLM, no direct protocol SDK calls (everything routes
// through ProtocolAdapter, see adapter.ts). Executes a plan's steps in dependency order,
// simulates before submitting, retries retryable failures, and runs the plan's own rollback
// strategy on failure.
import { randomUUID } from 'crypto';
import { topologicalSort } from '../executionPlanner/dependencyGraph.js';
import { hashExecutionResult } from './hashing.js';
import { resolveAdapter, type ProtocolAdapterRegistry } from './adapter.js';
import { EXECUTION_ENGINE_VERSION, DEFAULT_RETRY_POLICY } from './types.js';
import type {
  ExecutionPlan,
  PlanStep,
  ExecutionResult,
  ExecutionStepResult,
  ExecutionStepStatus,
  RollbackExecutionResult,
  JournalEntry,
  ExecuteOptions,
  FailureKind,
  ExecutionStatus,
  RollbackStatus,
} from './types.js';

export class ExecutionPlanInvalidError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`Cannot execute plan: ${errors.join('; ')}`);
    this.name = 'ExecutionPlanInvalidError';
    this.errors = errors;
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** Classifies an adapter/confirmation failure into retryable | permanent | timeout. A `timeout`
 *  confirm result is always terminal (no retry — the transaction may or may not have landed, so
 *  resubmitting risks a double-spend); anything else is treated as retryable up to the retry
 *  policy's attempt ceiling, then becomes permanent. */
function classifyFailure(reason: 'sim_failed' | 'submit_failed' | 'confirm_failed' | 'confirm_timeout', attemptsUsed: number, maxAttempts: number): FailureKind {
  if (reason === 'confirm_timeout') return 'timeout';
  return attemptsUsed >= maxAttempts ? 'permanent' : 'retryable';
}

/**
 * Validates a plan structurally before execution — re-runs the same topological sort the planner
 * itself used, so a hand-forged/tampered plan (bypassing buildExecutionPlan) cannot smuggle a
 * cyclic or unresolvable step graph into the engine.
 */
function assertPlanExecutable(plan: ExecutionPlan): void {
  const errors: string[] = [];
  if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
    throw new ExecutionPlanInvalidError(['plan has no steps']);
  }
  const sort = topologicalSort(plan.steps.map((s) => ({ id: s.stepId, dependsOn: s.dependsOn })));
  if (!sort.ok) errors.push(...sort.errors);
  const stepIds = new Set(plan.steps.map((s) => s.stepId));
  for (const rb of plan.rollbackStrategy) {
    if (!stepIds.has(rb.compensatesStepId)) errors.push(`rollback '${rb.stepId}' compensates unknown step '${rb.compensatesStepId}'`);
  }
  if (errors.length > 0) throw new ExecutionPlanInvalidError(errors);
}

interface RunState {
  runId: string;
  now: () => number;
  seq: number;
  journal: JournalEntry[];
}

function log(state: RunState, stepId: string, event: JournalEntry['event'], detail: string): void {
  state.journal.push({ seq: state.seq++, stepId, event, timestamp: state.now(), detail });
}

async function executeStep(
  step: PlanStep,
  registry: ProtocolAdapterRegistry,
  state: RunState,
  maxAttempts: number,
): Promise<ExecutionStepResult> {
  const startedAt = state.now();
  const base: Omit<ExecutionStepResult, 'status' | 'completedAt' | 'durationMs' | 'transactionId' | 'fee' | 'simulationResult' | 'failureKind' | 'errorMessage' | 'retryCount'> = {
    stepId: step.stepId,
    executionId: state.runId,
    protocol: step.protocol,
    action: step.action,
    startedAt,
  };

  // prerequisite_check / confirm steps carry no adapter call — the planner already ran the real
  // prerequisite checks; the engine's job for these is bookkeeping, not re-verification.
  if (step.type === 'prerequisite_check' || step.type === 'confirm') {
    const completedAt = state.now();
    log(state, step.stepId, 'confirm_result', `status=confirmed (${step.type} recorded, no adapter call)`);
    return { ...base, status: 'confirmed', completedAt, durationMs: completedAt - startedAt, transactionId: null, fee: null, simulationResult: null, failureKind: null, errorMessage: null, retryCount: 0 };
  }

  const adapter = resolveAdapter(registry, step.protocol);

  log(state, step.stepId, 'simulate_start', `simulating ${step.action} on ${step.protocol}/${step.asset}`);
  const simulationResult = await adapter.simulate(step);
  log(state, step.stepId, 'simulate_result', `ok=${simulationResult.ok} reason=${simulationResult.reason}`);

  if (!simulationResult.ok) {
    const completedAt = state.now();
    return {
      ...base, status: 'failed', completedAt, durationMs: completedAt - startedAt, transactionId: null,
      fee: null, simulationResult, failureKind: classifyFailure('sim_failed', 1, maxAttempts),
      errorMessage: `simulation rejected: ${simulationResult.reason}`, retryCount: 0,
    };
  }

  if (step.type === 'simulate') {
    const completedAt = state.now();
    log(state, step.stepId, 'confirm_result', 'status=confirmed (simulate step complete)');
    return { ...base, status: 'simulated', completedAt, durationMs: completedAt - startedAt, transactionId: null, fee: simulationResult.estimatedFee, simulationResult, failureKind: null, errorMessage: null, retryCount: 0 };
  }

  // step.type === 'execute': submit, then confirm, retrying retryable failures up to maxAttempts.
  let attempt = 0;
  let lastError: string | null = null;
  while (attempt < maxAttempts) {
    attempt++;
    if (attempt > 1) log(state, step.stepId, 'retry', `attempt ${attempt}/${maxAttempts}`);
    log(state, step.stepId, 'submit_start', `submitting attempt ${attempt}`);
    try {
      const submitResult = await adapter.submit(step);
      log(state, step.stepId, 'submit_result', `transactionId=${submitResult.transactionId}`);
      const confirmResult = await adapter.confirm(step, submitResult.transactionId);
      log(state, step.stepId, 'confirm_result', `status=${confirmResult.status}`);

      if (confirmResult.status === 'confirmed') {
        const completedAt = state.now();
        return {
          ...base, status: 'confirmed', completedAt, durationMs: completedAt - startedAt,
          transactionId: submitResult.transactionId, fee: submitResult.fee, simulationResult,
          failureKind: null, errorMessage: null, retryCount: attempt - 1,
        };
      }

      const kind = classifyFailure(confirmResult.status === 'timeout' ? 'confirm_timeout' : 'confirm_failed', attempt, maxAttempts);
      lastError = confirmResult.errorMessage ?? `confirmation status: ${confirmResult.status}`;
      if (kind !== 'retryable') {
        const completedAt = state.now();
        return {
          ...base, status: 'failed', completedAt, durationMs: completedAt - startedAt,
          transactionId: submitResult.transactionId, fee: submitResult.fee, simulationResult,
          failureKind: kind, errorMessage: lastError, retryCount: attempt - 1,
        };
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      log(state, step.stepId, 'submit_result', `error: ${lastError}`);
    }
  }

  const completedAt = state.now();
  return {
    ...base, status: 'failed', completedAt, durationMs: completedAt - startedAt, transactionId: null,
    fee: null, simulationResult, failureKind: classifyFailure('submit_failed', attempt, maxAttempts),
    errorMessage: lastError ?? 'submission failed with no error detail', retryCount: attempt - 1,
  };
}

/** Runs the plan's rollback strategy for every execute-step that succeeded before a failure
 *  occurred. Rollback is executed by re-invoking the same protocol adapter's `submit`, tagged as
 *  a compensating call — the engine still never talks to a protocol SDK directly. */
async function runRollback(
  plan: ExecutionPlan,
  succeededExecuteSteps: Map<string, ExecutionStepResult>,
  registry: ProtocolAdapterRegistry,
  state: RunState,
): Promise<{ results: RollbackExecutionResult[]; status: RollbackStatus }> {
  const applicable = plan.rollbackStrategy.filter((rb) => succeededExecuteSteps.has(rb.compensatesStepId));
  if (applicable.length === 0) return { results: [], status: 'not_needed' };

  const results: RollbackExecutionResult[] = [];
  for (const rb of applicable) {
    const compensated = succeededExecuteSteps.get(rb.compensatesStepId)!;
    log(state, rb.stepId, 'rollback_start', `compensating ${rb.compensatesStepId}`);
    try {
      const adapter = resolveAdapter(registry, compensated.protocol);
      const compensatingStep: PlanStep = { stepId: rb.stepId, type: 'execute', action: compensated.action as PlanStep['action'], protocol: compensated.protocol, asset: '', allocation: 0, dependsOn: [] };
      const submitResult = await adapter.submit(compensatingStep);
      log(state, rb.stepId, 'rollback_result', `status=completed transactionId=${submitResult.transactionId}`);
      results.push({ stepId: rb.stepId, compensatesStepId: rb.compensatesStepId, status: 'completed', transactionId: submitResult.transactionId, errorMessage: null });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log(state, rb.stepId, 'rollback_result', `status=failed error=${errorMessage}`);
      results.push({ stepId: rb.stepId, compensatesStepId: rb.compensatesStepId, status: 'failed', transactionId: null, errorMessage });
    }
  }

  const status: RollbackStatus = results.every((r) => r.status === 'completed') ? 'completed' : results.some((r) => r.status === 'completed') ? 'partial' : 'failed';
  return { results, status };
}

/**
 * Executes an ExecutionPlan against a caller-supplied ProtocolAdapter registry. Steps run in
 * dependency order (re-derived from the plan's own graph, never trusted blindly from array
 * order); a step only starts once every step it `dependsOn` has reached a terminal status. On the
 * first step failure, execution stops (fail-fast — no step downstream of a failure is attempted)
 * and the plan's rollback strategy runs for whatever `execute` steps already succeeded.
 */
export async function executePlan(plan: ExecutionPlan, registry: ProtocolAdapterRegistry, options: ExecuteOptions = {}): Promise<ExecutionResult> {
  assertPlanExecutable(plan);

  const now = options.now ?? Date.now;
  const runId = options.runId ?? randomUUID();
  const maxAttempts = Math.max(1, options.retryPolicy?.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts);
  const state: RunState = { runId, now, seq: 0, journal: [] };

  const startedAt = now();
  const order = topologicalSort(plan.steps.map((s) => ({ id: s.stepId, dependsOn: s.dependsOn }))).order;
  const stepById = new Map(plan.steps.map((s) => [s.stepId, s]));

  const stepResults: ExecutionStepResult[] = [];
  const resultById = new Map<string, ExecutionStepResult>();
  const succeededExecuteSteps = new Map<string, ExecutionStepResult>();
  let firstFailure = false;

  for (const stepId of order) {
    const step = stepById.get(stepId)!;
    const depsOk = step.dependsOn.every((d) => resultById.get(d)?.status === 'confirmed' || resultById.get(d)?.status === 'simulated');

    if (firstFailure || !depsOk) {
      const completedAt = now();
      log(state, step.stepId, 'skip', firstFailure ? 'skipped: earlier step failed' : 'skipped: a dependency did not succeed');
      const skipped: ExecutionStepResult = {
        stepId: step.stepId, executionId: runId, transactionId: null, protocol: step.protocol, action: step.action,
        status: 'skipped', startedAt: completedAt, completedAt, durationMs: 0, retryCount: 0, fee: null,
        simulationResult: null, failureKind: null, errorMessage: null,
      };
      stepResults.push(skipped);
      resultById.set(step.stepId, skipped);
      continue;
    }

    const result = await executeStep(step, registry, state, maxAttempts);
    stepResults.push(result);
    resultById.set(step.stepId, result);
    if (result.status === 'confirmed' && step.type === 'execute') succeededExecuteSteps.set(step.stepId, result);
    if (result.status === 'failed') firstFailure = true;
  }

  const rollback = firstFailure ? await runRollback(plan, succeededExecuteSteps, registry, state) : { results: [], status: 'not_needed' as RollbackStatus };

  const completedSteps = stepResults.filter((s) => s.status === 'confirmed' || s.status === 'simulated').map((s) => s.stepId);
  const failedSteps = stepResults.filter((s) => s.status === 'failed').map((s) => s.stepId);
  const transactionIds = [
    ...stepResults.map((s) => s.transactionId).filter((t): t is string => t !== null),
    ...rollback.results.map((r) => r.transactionId).filter((t): t is string => t !== null),
  ];

  let status: ExecutionStatus;
  if (failedSteps.length === 0) status = 'completed';
  else if (rollback.status === 'completed') status = 'rolled_back';
  else if (completedSteps.length > 0) status = 'partially_completed';
  else status = 'failed';

  const completedAt = now();
  const totalRetryCount = stepResults.reduce((acc, s) => acc + s.retryCount, 0);

  const resultBase: Omit<ExecutionResult, 'executionHash' | 'metadata'> = {
    executionVersion: EXECUTION_ENGINE_VERSION,
    runId,
    planExecutionId: plan.executionId,
    status,
    completedSteps,
    failedSteps,
    rollbackStatus: rollback.status,
    rollbackResults: rollback.results,
    transactionIds,
    steps: stepResults,
    journal: state.journal,
    startedAt,
    completedAt,
  };

  const withMetadata: ExecutionResult = {
    ...resultBase,
    executionHash: 'pending',
    metadata: {
      engineVersion: EXECUTION_ENGINE_VERSION,
      planHash: plan.planHash,
      executionHash: 'pending',
      stepCount: plan.steps.length,
      completedStepCount: completedSteps.length,
      failedStepCount: failedSteps.length,
      totalRetryCount,
    },
  };

  const executionHash = hashExecutionResult(withMetadata);
  const finalResult: ExecutionResult = { ...withMetadata, executionHash, metadata: { ...withMetadata.metadata, executionHash } };
  return deepFreeze(finalResult);
}

/** Replays a previously-recorded journal to deterministically reconstruct which steps
 *  completed/failed/were rolled back — without re-invoking any adapter. Used to audit or restore
 *  execution state from the durable journal alone. */
export function replayJournal(journal: JournalEntry[]): { completedSteps: string[]; failedSteps: string[]; rolledBackSteps: string[] } {
  const completed = new Set<string>();
  const failed = new Set<string>();
  const rolledBack = new Set<string>();
  for (const entry of [...journal].sort((a, b) => a.seq - b.seq)) {
    if (entry.event === 'confirm_result' && /status=confirmed/.test(entry.detail)) completed.add(entry.stepId);
    if (entry.event === 'confirm_result' && /status=(failed|timeout)/.test(entry.detail)) failed.add(entry.stepId);
    if (entry.event === 'rollback_result' && /status=completed/.test(entry.detail)) rolledBack.add(entry.stepId);
  }
  return { completedSteps: [...completed].sort(), failedSteps: [...failed].sort(), rolledBackSteps: [...rolledBack].sort() };
}
