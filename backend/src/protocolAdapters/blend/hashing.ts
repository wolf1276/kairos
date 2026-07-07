// Deterministic hashing for Blend TransactionBuilders — same SHA-256-over-stableStringify
// technique used throughout this codebase (see aquarius/hashing.ts, phoenix/hashing.ts). Blend
// does not implement `quote()` (see types.ts), so there is no `hashQuote` here.
import { sha256 } from '../../reasoning/hashing.js';
import type { TransactionBuilder } from '../types.js';

export function hashTransaction(tx: Omit<TransactionBuilder, 'transactionHash'>): string {
  return sha256(tx);
}
