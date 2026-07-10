// Deterministic hashing for the Outcome Recorder. Same technique as every other layer: SHA-256
// over a canonical, key-sorted JSON string (see `../hashing.ts`). `outcomeId` (a fresh UUID per
// call) and `executionId` (the upstream execution's fresh UUID — its content is already captured
// deterministically by `executionHash`) are always excluded before hashing, so recording the same
// ExecutionResult + OutcomeTelemetry twice always produces an identical `outcomeHash`.
import { sha256 } from '../hashing.js';
import type { OutcomeRecord } from './types.js';

export function hashOutcomeRecord(record: Omit<OutcomeRecord, 'outcomeHash' | 'outcomeId'>): string {
  const { executionId: _executionId, ...rest } = record;
  return sha256(rest);
}
