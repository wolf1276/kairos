// Deterministic hashing for Decision Intelligence — same SHA-256-over-stableStringify technique
// as reasoning/hashing.ts, kept separate since DecisionIntelligence is a distinct schema.
import { sha256 } from '../hashing.js';
import type { DecisionIntelligence } from './types.js';

/** Hashes a DecisionIntelligence result, ignoring runtime-only fields (decisionId, timestamp,
 *  metadata.reasoningDurationMs, metadata.decisionHash itself) so a replayed decision built from
 *  the same ReasoningContext + Prompt hashes identically regardless of when it was produced. */
export function hashDecisionIntelligence(decision: DecisionIntelligence): string {
  const { decisionId: _decisionId, timestamp: _timestamp, metadata, ...rest } = decision;
  const { reasoningDurationMs: _reasoningDurationMs, decisionHash: _decisionHash, ...metadataForHash } = metadata;
  return sha256({ ...rest, metadata: metadataForHash });
}
