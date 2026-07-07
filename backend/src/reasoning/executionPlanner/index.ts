// Public surface of the Execution Planner (Phase 5). Callers import only from here.
export { buildExecutionPlan, ExecutionPlanValidationError } from './planner.js';
export { hashExecutionPlan } from './hashing.js';
export { topologicalSort } from './dependencyGraph.js';
export { runPrerequisiteChecks } from './rules.js';
export { estimateFee, estimateSlippage, estimateBalanceChanges, estimateStateChanges, PROTOCOL_FEE_RATE, SLIPPAGE_COEFFICIENT, MAX_SLIPPAGE_PCT } from './estimate.js';
export { EXECUTION_PLANNER_VERSION, PLAN_STEP_TYPES } from './types.js';

export type {
  PlanStepType,
  PlanStep,
  PrerequisiteCheck,
  RollbackStep,
  SimulationRequest,
  FeeEstimate,
  SlippageEstimate,
  BalanceChange,
  StateChange,
  ExecutionPlanMetadata,
  ExecutionPlan,
  PlanValidationResult,
} from './types.js';
export type { DependencyNode, TopologicalSortResult } from './dependencyGraph.js';
