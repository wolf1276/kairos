// Deterministic hashing for Phoenix Quotes and TransactionBuilders — same
// SHA-256-over-stableStringify technique used throughout this codebase (see
// aquarius/hashing.ts).
import { sha256 } from '../../reasoning/hashing.js';
import type { Quote, TransactionBuilder } from '../types.js';

export function hashQuote(quote: Omit<Quote, 'quoteHash'>): string {
  return sha256(quote);
}

export function hashTransaction(tx: Omit<TransactionBuilder, 'transactionHash'>): string {
  return sha256(tx);
}
