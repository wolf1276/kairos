// Types for Reasoning Engine Phase 5 (Execution Planner). Deterministic — no AI, no LLM, no
// blockchain call. Turns a VerifiedDecision (Phase 4, frozen) + AgentContext (Phase 1, frozen)
// into an ordered, hashable ExecutionPlan. Never executes anything — this is a plan, not an
// action.
import type { PrimaryAction } from '../decisionIntelligence/types.js';

export const EXECUTION_PLANNER_VERSION = '1.0.0';

export const PLAN_STEP_TYPES = ['prerequisite_check', 'simulate', 'execute', 'confirm'] as const;
export type PlanStepType = (typeof PLAN_STEP_TYPES)[number];

export interface PlanStep {
  stepId: string;
  type: PlanStepType;
  action: PrimaryAction | 'no_op';
  protocol: string;
  asset: string;
  /** Fraction of managed capital this step moves — mirrors the decision's allocation for
   *  `execute` steps; 0 for check/simulate/confirm steps, which move nothing themselves. */
  allocation: number;
  dependsOn: string[];
}

export interface PrerequisiteCheck {
  check: string;
  passed: boolean;
  message: string;
}

export interface RollbackStep {
  stepId: string;
  compensatesStepId: string;
  action: string;
  description: string;
}

export interface SimulationRequest {
  stepId: string;
  protocol: string;
  action: PrimaryAction;
  asset: string;
  /** Requested capital amount as a decimal string — string, not number, to avoid float
   *  precision drift once this leaves the planner (matches how amounts are carried elsewhere in
   *  this codebase, e.g. AgentContext.policy.spendingLimitPerTrade). */
  amount: string;
}

export interface FeeEstimate {
  protocol: string;
  estimatedFee: string;
  feeAsset: string;
  basis: string;
}

export interface SlippageEstimate {
  asset: string;
  estimatedSlippagePct: number;
  basis: string;
}

export interface BalanceChange {
  asset: string;
  before: string;
  after: string;
  delta: string;
}

export interface StateChange {
  field: string;
  before: string;
  after: string;
}

export interface ExecutionPlanMetadata {
  plannerVersion: string;
  planHash: string;
  decisionHash: string;
  verificationHash: string;
  stepCount: number;
}

/** Immutable, structured execution plan. Never an execution instruction that runs itself — a
 *  future Execution Engine (not built here) would consume this and actually call a protocol. */
export interface ExecutionPlan {
  executionId: string;
  planHash: string;
  version: string;
  timestamp: number;
  steps: PlanStep[];
  protocolRouting: Record<string, string>;
  assetRouting: Record<string, string>;
  dependencies: Record<string, string[]>;
  prerequisiteChecks: PrerequisiteCheck[];
  rollbackStrategy: RollbackStep[];
  simulationRequests: SimulationRequest[];
  estimatedFees: FeeEstimate[];
  estimatedSlippage: SlippageEstimate[];
  expectedBalanceChanges: BalanceChange[];
  expectedStateChanges: StateChange[];
  metadata: ExecutionPlanMetadata;
}

export interface PlanValidationResult {
  ok: boolean;
  errors: string[];
}
