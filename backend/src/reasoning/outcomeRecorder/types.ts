// Types for Reasoning Engine Phase 8 (Outcome Recorder). Deterministic — no AI, no LLM, no
// blockchain call, no execution. Turns a frozen ExecutionResult (Phase 7) + post-submission
// telemetry (transaction/settlement facts that only exist once a signed transaction has actually
// been submitted — out of scope for the Execution Engine, which only ever builds/simulates an
// *unsigned* transaction) into an immutable, hashable, replayable OutcomeRecord. Never executes,
// never signs, never mutates its inputs — this only records what already happened.
import type { DataSource, ExecutionFailureReason, ExecutionResultStatus, ResourceEstimate } from '../routeExecutionEngine/types.js';

export const OUTCOME_RECORDER_VERSION = '1.0.0';

export const OUTCOME_REJECTION_REASONS = [
  'malformed_execution_result',
  'missing_execution_hash',
  'missing_route_hash',
  'invalid_protocol',
  'invalid_action',
  'invalid_transaction_hash',
  'invalid_transaction_xdr_hash',
  'negative_fees',
  'invalid_amount',
  'invalid_numeric_field',
  'inconsistent_balances',
  'malformed_telemetry',
] as const;
export type OutcomeRejectionReason = (typeof OUTCOME_REJECTION_REASONS)[number];

/** One asset's balance at a point in time. `amount` is a decimal string — string, not number, to
 *  avoid float precision drift, matching every other balance/amount field in this codebase (see
 *  `executionPlanner/types.ts::BalanceChange`). */
export interface BalanceEntry {
  asset: string;
  amount: string;
}

/** Post-submission facts the Execution Engine (Phase 7) never produces, because it never signs or
 *  submits anything — these only exist once a real transaction has actually settled on-chain (or
 *  definitively failed). Supplied by whatever layer watches the submitted transaction; the
 *  Outcome Recorder never fetches or infers this data itself. */
export interface OutcomeTelemetry {
  transactionHash: string;
  transactionXDRHash: string;
  amountRequested: string;
  amountExecuted: string;
  fees: string;
  slippage: number;
  priceImpact: number;
  balancesBefore: BalanceEntry[];
  balancesAfter: BalanceEntry[];
  /** Hash of the VerifiedDecision that ultimately authorized this execution (see
   *  `verification/types.ts::VerifiedDecision.verificationHash`, threaded through
   *  `ExecutionPlan.metadata.verificationHash`). */
  verificationHash: string;
  /** Hash of the AgentContext snapshot the decision was reasoned over (see
   *  `agentContext/types.ts`'s `meta.contextHash`). */
  contextHash: string;
  /** Hash of the memory package folded into that AgentContext (see
   *  `memoryLayer/types.ts::MemoryPackage.packageHash`). */
  memoryHash: string;
  metadata?: Record<string, unknown>;
}

export interface OutcomeRecordMetadata {
  recorderVersion: string;
  [key: string]: unknown;
}

/** Immutable, replayable, hashable record of one execution's real-world outcome. Never mutated
 *  after being returned — same freeze discipline as every other Phase's output. Never derived by
 *  re-running anything: purely a structured combination of a frozen `ExecutionResult` and the
 *  caller-supplied `OutcomeTelemetry` for that same execution. */
export interface OutcomeRecord {
  outcomeId: string;
  outcomeHash: string;
  executionId: string;
  executionHash: string;
  protocol: string;
  action: string;
  assets: string[];
  transactionHash: string;
  transactionXDRHash: string;
  executionStatus: ExecutionResultStatus;
  dataSource: DataSource;
  amountRequested: string;
  amountExecuted: string;
  fees: string;
  slippage: number;
  priceImpact: number;
  balancesBefore: BalanceEntry[];
  balancesAfter: BalanceEntry[];
  executionDurationMs: number;
  resourceEstimate: ResourceEstimate | null;
  verificationHash: string;
  routeHash: string;
  contextHash: string;
  memoryHash: string;
  failureReason: ExecutionFailureReason | null;
  retryCount: number;
  metadata: OutcomeRecordMetadata;
}

export interface RecordOutcomeOptions {
  /** Injectable id for deterministic tests — defaults to `randomUUID()`. */
  outcomeId?: string;
}
