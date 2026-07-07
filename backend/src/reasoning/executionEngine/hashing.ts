// Deterministic hashing for ExecutionResults — same SHA-256-over-stableStringify technique used
// throughout the Reasoning Engine (see executionPlanner/hashing.ts).
import { sha256 } from '../hashing.js';
import type { ExecutionResult } from './types.js';

/** Hashes only the deterministic content of an ExecutionResult: excludes `runId`, wall-clock
 *  timestamps/durations, adapter-generated transactionIds (not reproducible across runs even
 *  against a deterministic adapter, e.g. a real chain's tx hash), and the entire `journal` — the
 *  journal is a free-text audit trail whose `detail` strings embed those same non-reproducible
 *  transactionIds/error text, so it can never be part of a stable hash. The canonical outcome
 *  (status, completedSteps, failedSteps, rollbackStatus, and each step's status/fee/
 *  simulationResult/failureKind) is what gets hashed. Same ExecutionPlan + same adapter
 *  *decisions* (ok/fail per step) always hash identically. */
export function hashExecutionResult(result: ExecutionResult): string {
  const {
    executionHash: _executionHash,
    runId: _runId,
    startedAt: _startedAt,
    completedAt: _completedAt,
    transactionIds: _transactionIds,
    steps,
    journal: _journal,
    rollbackResults,
    metadata,
    ...rest
  } = result;

  const stepsForHash = steps.map((s) => {
    const { startedAt: _s1, completedAt: _s2, durationMs: _s3, transactionId: _s4, executionId: _s5, ...stepRest } = s;
    return stepRest;
  });
  const rollbackForHash = rollbackResults.map(({ transactionId: _tx, errorMessage: _err, ...r }) => r);
  const { executionHash: _metaHash, ...metadataForHash } = metadata;

  return sha256({ ...rest, steps: stepsForHash, rollbackResults: rollbackForHash, metadata: metadataForHash });
}
