// Types for the Execution Engine (Phase 7). Deterministic — no AI, no LLM, no blockchain
// execution (never signs or submits anything). Consumes a frozen ExecutionPlan (Phase 5) + a
// frozen ExecutionRoute (Phase 6) and produces an immutable, hashable, replayable ExecutionResult
// describing an *unsigned* transaction: built, simulated (via the protocol adapter's Soroban RPC
// integration), fee-estimated, resource-estimated, and validated. Never changes the plan or the
// route — both are read-only inputs.
import type { TransactionBuilder, SimulationResult } from '../../protocolAdapters/types.js';
import type { ExecutionRoute } from '../routeEngine/types.js';

export const EXECUTION_ENGINE_VERSION = '1.0.0';

export const EXECUTION_RESULT_STATUSES = ['success', 'failed'] as const;
export type ExecutionResultStatus = (typeof EXECUTION_RESULT_STATUSES)[number];

export const EXECUTION_FAILURE_REASONS = [
  'no_route_selected',
  'stale_route',
  'adapter_not_found',
  'adapter_spoofing',
  'transaction_build_unsupported',
  'transaction_build_failed',
  'malformed_transaction',
  'forged_transaction',
  'invalid_contract',
  'malformed_xdr',
  'simulation_failed',
  'malformed_simulation',
  'validation_failed',
  'fee_estimation_failed',
  'malformed_fee_estimate',
] as const;
export type ExecutionFailureReason = (typeof EXECUTION_FAILURE_REASONS)[number];

/** Where `transactionXDR`/`resourceEstimate` on an `ExecutionResult` actually came from.
 *  `'real'`: a genuine unsigned Soroban transaction, resource-assembled from a live
 *  `simulateTransaction` response via a protocol's `RealTransactionProvider` (see `engine.ts`) —
 *  currently only wired for Aquarius (`protocolAdapters/aquarius/realTransactionBuilder.ts`),
 *  the only protocol with a live-testnet-verified Soroban invocation builder. `'synthetic'`: the
 *  deterministic placeholder derived purely from the `TransactionBuilder`'s own shape (see
 *  `resourceEstimate.ts`) — used whenever no real provider is registered for the resolved
 *  protocol, so the pipeline still produces something replayable/hashable rather than failing
 *  closed over a missing "nice to have". Never silently mixed: one execution's XDR and resource
 *  estimate always share the same source. */
export const DATA_SOURCES = ['real', 'synthetic'] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

/** Resource footprint for the built (unsigned) transaction. When `dataSource: 'real'`, these are
 *  the actual `SorobanTransactionData` resources returned by `simulateTransaction` (instructions/
 *  disk-read-bytes/write-bytes/resource-fee, per `@stellar/stellar-sdk`'s `SorobanDataBuilder`).
 *  When `dataSource: 'synthetic'` (no real provider registered for the protocol), this is a
 *  deterministic heuristic function of the built `TransactionBuilder`'s own content — never a
 *  network call — documented as a placeholder standing in for a real resource estimate. */
export interface ResourceEstimate {
  cpuInstructions: number;
  diskReadBytes: number;
  writeBytes: number;
  resourceFeeStroops: string;
  transactionSizeBytes: number;
}

export interface ExecutionResultMetadata {
  engineVersion: string;
  planExecutionId: string;
  planHash: string;
  routeHash: string;
  requestHash: string;
  executionHash: string;
  retryCount: number;
  failureReason: ExecutionFailureReason | null;
  errorMessage: string | null;
  dataSource: DataSource;
  startedAt: number;
  completedAt: number;
  durationMs: number;
}

/** Immutable, replayable, hashable result of running the Execution Engine pipeline for one
 *  ExecutionRoute. Never mutated after being returned — same freeze discipline as ExecutionPlan
 *  (Phase 5) and ExecutionRoute (Phase 6). Never a submitted/confirmed transaction — `status:
 *  'success'` means an unsigned transaction was built, simulated, fee/resource-estimated, and
 *  validated; it was never signed or broadcast (blockchain execution is explicitly out of scope). */
export interface ExecutionResult {
  executionId: string;
  executionHash: string;
  transactionXDR: string | null;
  transaction: TransactionBuilder | null;
  simulationResult: SimulationResult | null;
  estimatedFees: string | null;
  resourceEstimate: ResourceEstimate | null;
  protocol: string;
  route: ExecutionRoute;
  status: ExecutionResultStatus;
  metadata: ExecutionResultMetadata;
}

export interface RetryPolicy {
  /** Max attempts per adapter call, including the first — 1 means no retries. Only a thrown
   *  exception (a transient/RPC-unavailable failure) is retried; a structured failure (simulation
   *  `success: false`, validation `ok: false`) is never retried — retrying a protocol's considered
   *  "no" doesn't make it a "yes". */
  maxAttempts: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxAttempts: 3 };

/** Result of asking a protocol's real Soroban integration for a genuine unsigned, resource-
 *  assembled transaction for an already-built `TransactionBuilder`. Optional per protocol — a
 *  protocol with no real Soroban invocation builder simply has no entry in
 *  `ExecuteRouteOptions.realTransactionProviders`, and the pipeline falls back to the synthetic
 *  XDR/resource estimate (see `DataSource`). Never signs or submits. */
export interface RealTransactionProvider {
  (tx: TransactionBuilder): Promise<{ success: true; unsignedXdr: string; resourceEstimate: ResourceEstimate } | { success: false; errors: string[] }>;
}

export interface ExecuteRouteOptions {
  retryPolicy?: RetryPolicy;
  /** A route older than this (relative to `now()`) is rejected as stale before any adapter call —
   *  replay-attack protection: an old ExecutionRoute (whose ranking/quotes may no longer reflect
   *  live protocol state) cannot be resubmitted indefinitely. Defaults to 60s. */
  routeTtlMs?: number;
  /** Injectable clock/id for deterministic tests — defaults to Date.now/randomUUID. */
  now?: () => number;
  executionId?: string;
  /** Per-protocol real transaction providers (see `RealTransactionProvider`). Keyed by protocol
   *  name, matching `ProtocolRegistry` keys. A protocol with no entry here uses the synthetic
   *  XDR/resource-estimate fallback — always recorded via `metadata.dataSource`, never silently. */
  realTransactionProviders?: Record<string, RealTransactionProvider>;
}
