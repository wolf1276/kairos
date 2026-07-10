// Deterministic hashing for the Execution Engine. Same technique as every other layer: SHA-256
// over a canonical, key-sorted JSON string (see `../hashing.ts`). `executionId` (a fresh UUID per
// run) and every wall-clock field are always excluded before hashing, so replaying the same
// ExecutionPlan + ExecutionRoute against the same adapter state always produces an identical
// `executionHash`.
import { sha256 } from '../hashing.js';
import type { TransactionBuilder, SimulationResult } from '../../protocolAdapters/types.js';
import type { ExecutionResult, ResourceEstimate } from './types.js';

/** Recomputes a TransactionBuilder's hash the exact way every protocol adapter's own
 *  `hashTransaction` does (`sha256(tx-without-transactionHash)`) — used to independently verify a
 *  live `buildTransaction()` result was not forged/tampered with before it's trusted. */
export function recomputeTransactionHash(tx: Omit<TransactionBuilder, 'transactionHash'>): string {
  return sha256(tx);
}

export function hashResourceEstimate(estimate: ResourceEstimate): string {
  return sha256(estimate);
}

/** Hashes the deterministic content of an ExecutionResult — excludes `executionId` (fresh UUID),
 *  `metadata.startedAt`/`completedAt`/`durationMs`/`executionHash` itself (wall clock and
 *  self-reference), `metadata.planExecutionId` (the upstream plan's fresh UUID), and the embedded
 *  `route.routeId`/`route.metadata.timestamp` (Phase 6's own wall-clock fields) — so replaying the
 *  same plan+route against the same adapter state always produces the same `executionHash`
 *  regardless of when either run happened. */
export function hashExecutionResult(result: Omit<ExecutionResult, 'executionHash' | 'executionId'>): string {
  const { metadata, route, ...rest } = result;
  const { startedAt: _startedAt, completedAt: _completedAt, durationMs: _durationMs, executionHash: _executionHash, planExecutionId: _planExecutionId, ...metadataForHash } = metadata;
  const { routeId: _routeId, ...routeRest } = route;
  const { timestamp: _timestamp, ...routeMetadataForHash } = route.metadata;
  return sha256({ ...rest, route: { ...routeRest, metadata: routeMetadataForHash }, metadata: metadataForHash });
}
