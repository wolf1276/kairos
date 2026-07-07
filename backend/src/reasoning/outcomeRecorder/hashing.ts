// Deterministic hashing for the Outcome Recorder. Same technique as every other layer: SHA-256
// over a canonical, key-sorted JSON string (see `../hashing.ts`). `outcomeId` (a fresh UUID per
// call) is always excluded before hashing, so recording the same ExecutionResult + OutcomeTelemetry
// twice always produces an identical `outcomeHash`.
import { sha256 } from '../hashing.js';
import type { OutcomeRecord } from './types.js';

export function hashOutcomeRecord(record: Omit<OutcomeRecord, 'outcomeHash' | 'outcomeId'>): string {
  return sha256(record);
}
