// Types for Reasoning Engine Phase 9 (Memory Writer). Deterministic — no AI, no LLM, no
// summarization, no inference. Turns a frozen Phase 8 `OutcomeRecord` into deterministic,
// immutable, replayable, idempotent memory entries shaped exactly like the (frozen) Memory
// Engine's own `EpisodicRecord` / `SemanticFact` / `WorkingMemoryEntry` (see
// `../../memoryLayer/types.ts`), then persists them through the Memory Engine's own provider
// interfaces. Never mutates the OutcomeRecord passed in, never re-derives anything from AI.
import type { EpisodicRecord, SemanticFact, WorkingMemoryEntry } from '../../memoryLayer/types.js';

export const MEMORY_WRITER_VERSION = '1.0.0';

export const MEMORY_WRITE_REJECTION_REASONS = [
  'malformed_outcome_record',
  'missing_outcome_hash',
  'invalid_agent_id',
  'invalid_protocol',
  'invalid_action',
  'invalid_status',
  'invalid_amount',
  'invalid_numeric_field',
  'inconsistent_balances',
  'invalid_hash',
] as const;
export type MemoryWriteRejectionReason = (typeof MEMORY_WRITE_REJECTION_REASONS)[number];

/** Minimal shape of the Phase 8 `OutcomeRecord` the Memory Writer depends on. Declared locally
 *  (rather than importing `OutcomeRecord` itself) so this phase only commits to the fields it
 *  actually reads — matches the "depend on the narrowest shape you need" pattern used across
 *  this codebase. Structurally compatible with `../outcomeRecorder/types.ts::OutcomeRecord`. */
export interface OutcomeRecordInput {
  outcomeId: string;
  outcomeHash: string;
  executionId: string;
  executionHash: string;
  protocol: string;
  action: string;
  assets: string[];
  transactionHash: string;
  transactionXDRHash: string;
  executionStatus: 'success' | 'failed';
  dataSource: 'real' | 'synthetic';
  amountRequested: string;
  amountExecuted: string;
  fees: string;
  slippage: number;
  priceImpact: number;
  balancesBefore: { asset: string; amount: string }[];
  balancesAfter: { asset: string; amount: string }[];
  verificationHash: string;
  routeHash: string;
  contextHash: string;
  memoryHash: string;
  failureReason: string | null;
  retryCount: number;
}

export interface MemoryWriteOptions {
  /** Agent this memory is being written for. Never inferred — `OutcomeRecord` carries no agent
   *  identity of its own (Phase 8 records an execution, not who authorized it), so the caller
   *  must supply it explicitly. */
  agentId: string;
  /** Injectable id for deterministic tests — defaults to `randomUUID()`. Excluded from
   *  `writeHash`, same pattern as `RecordOutcomeOptions.outcomeId`. */
  writeId?: string;
  /** Injectable wall-clock timestamp for deterministic tests — defaults to `Date.now()`.
   *  Excluded from `writeHash` and from every id derivation, so identical `OutcomeRecord` +
   *  `agentId` pairs always hash identically regardless of when they were written — same
   *  "wall-clock-only fields excluded" convention as `reasoning/hashing.ts`. */
  timestamp?: number;
}

/** Immutable, replayable, hashable result of writing one `OutcomeRecord` into memory. */
export interface MemoryWriteResult {
  writeId: string;
  writeHash: string;
  outcomeId: string;
  outcomeHash: string;
  agentId: string;
  /** `'written'` the first time a given (outcomeHash, agentId) pair is recorded; `'duplicate'`
   *  on every subsequent identical write — the episodic append is skipped (append-only, so it
   *  cannot be repeated), but semantic/working entries are still (harmlessly) re-applied since
   *  they are idempotent upserts of the same deterministic content. */
  status: 'written' | 'duplicate';
  episodic: EpisodicRecord;
  semantic: SemanticFact[];
  working: WorkingMemoryEntry[];
}
