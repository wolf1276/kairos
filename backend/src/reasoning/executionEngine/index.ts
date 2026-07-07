// Public surface of the Execution Engine (Phase 6). Callers import only from here.
export { executePlan, replayJournal, ExecutionPlanInvalidError } from './executor.js';
export { hashExecutionResult } from './hashing.js';
export { resolveAdapter, AdapterNotFoundError } from './adapter.js';
export { EXECUTION_ENGINE_VERSION, EXECUTION_STEP_STATUSES, FAILURE_KINDS, EXECUTION_STATUSES, ROLLBACK_STATUSES, DEFAULT_RETRY_POLICY } from './types.js';

export type { ProtocolAdapter, ProtocolAdapterRegistry, AdapterSubmitResult, AdapterConfirmResult } from './adapter.js';
export type {
  ExecutionStepStatus,
  FailureKind,
  ExecutionStatus,
  RollbackStatus,
  StepSimulationResult,
  ExecutionStepResult,
  RollbackExecutionResult,
  JournalEntry,
  ExecutionResultMetadata,
  ExecutionResult,
  RetryPolicy,
  ExecutionMode,
  ExecuteOptions,
} from './types.js';
