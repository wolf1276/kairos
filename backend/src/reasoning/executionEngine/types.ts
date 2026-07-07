// Types for Reasoning Engine Phase 6 (Execution Engine). Deterministic orchestration — no AI, no
// LLM. Consumes a frozen ExecutionPlan (Phase 5) and a caller-supplied ProtocolAdapter registry,
// produces an ExecutionResult. The engine never talks to a protocol SDK itself — every side
// effect goes through the ProtocolAdapter interface (adapter.ts), so this file has zero
// dependency on any specific chain/protocol.
import type { PlanStep, RollbackStep, ExecutionPlan } from '../executionPlanner/types.js';

export const EXECUTION_ENGINE_VERSION = '1.0.0';

export const EXECUTION_STEP_STATUSES = [
  'pending',
  'simulating',
  'simulated',
  'submitted',
  'confirmed',
  'failed',
  'rolled_back',
  'skipped',
] as const;
export type ExecutionStepStatus = (typeof EXECUTION_STEP_STATUSES)[number];

export const FAILURE_KINDS = ['retryable', 'permanent', 'timeout'] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

export const EXECUTION_STATUSES = ['completed', 'failed', 'partially_completed', 'rolled_back'] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const ROLLBACK_STATUSES = ['not_needed', 'not_attempted', 'completed', 'partial', 'failed'] as const;
export type RollbackStatus = (typeof ROLLBACK_STATUSES)[number];

/** Result of simulating one PlanStep against its protocol adapter — required before any
 *  `execute`-type step may submit. */
export interface StepSimulationResult {
  ok: boolean;
  reason: string;
  estimatedFee: string;
}

/** Record kept for every executed step, per the spec's required field list. */
export interface ExecutionStepResult {
  stepId: string;
  executionId: string;
  transactionId: string | null;
  protocol: string;
  action: string;
  status: ExecutionStepStatus;
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
  retryCount: number;
  fee: string | null;
  simulationResult: StepSimulationResult | null;
  failureKind: FailureKind | null;
  errorMessage: string | null;
}

export interface RollbackExecutionResult {
  stepId: string;
  compensatesStepId: string;
  status: 'completed' | 'failed' | 'skipped';
  transactionId: string | null;
  errorMessage: string | null;
}

/** One append-only entry in the execution journal — the durable record a caller can replay to
 *  deterministically reconstruct which steps completed/failed/rolled back, without re-running any
 *  protocol call. */
export interface JournalEntry {
  seq: number;
  stepId: string;
  event: 'simulate_start' | 'simulate_result' | 'submit_start' | 'submit_result' | 'confirm_result' | 'retry' | 'rollback_start' | 'rollback_result' | 'skip';
  timestamp: number;
  detail: string;
}

export interface ExecutionResultMetadata {
  engineVersion: string;
  planHash: string;
  executionHash: string;
  stepCount: number;
  completedStepCount: number;
  failedStepCount: number;
  totalRetryCount: number;
}

/** Immutable, replayable result of running an ExecutionPlan. Never mutated after being returned —
 *  same freeze discipline as ExecutionPlan (Phase 5). */
export interface ExecutionResult {
  executionHash: string;
  executionVersion: string;
  runId: string;
  planExecutionId: string;
  status: ExecutionStatus;
  completedSteps: string[];
  failedSteps: string[];
  rollbackStatus: RollbackStatus;
  rollbackResults: RollbackExecutionResult[];
  transactionIds: string[];
  steps: ExecutionStepResult[];
  journal: JournalEntry[];
  startedAt: number;
  completedAt: number;
  metadata: ExecutionResultMetadata;
}

export interface RetryPolicy {
  /** Max attempts per `execute`/`simulate` step, including the first — 1 means no retries. */
  maxAttempts: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxAttempts: 3 };

export type ExecutionMode = 'sequential' | 'batched' | 'dependent';

export interface ExecuteOptions {
  mode?: ExecutionMode;
  retryPolicy?: RetryPolicy;
  /** Injectable clock/id for deterministic tests — defaults to Date.now/randomUUID. */
  now?: () => number;
  runId?: string;
}

export type { PlanStep, RollbackStep, ExecutionPlan };
