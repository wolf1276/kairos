// Deterministic hashing for the Reasoning Engine. Same technique as the Context Layer and
// Memory Engine: SHA-256 over a canonical, key-sorted JSON string, so identical inputs always
// produce identical hashes regardless of property insertion order.
import { createHash } from 'crypto';
import { stableStringify } from '../stableStringify.js';
import type { CandidateDecision, PromptSections } from './types.js';

export function sha256(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

/** Hashes the deterministic content of a ReasoningContext build — callers pass the canonical
 *  object with wall-clock-only fields (timestamp, contextId) already excluded. */
export function hashReasoningContext(canonical: unknown): string {
  return sha256(canonical);
}

export function hashPromptSections(sections: PromptSections): string {
  return sha256(sections);
}

/** Hashes a CandidateDecision, ignoring runtime-only fields (decisionId, timestamp,
 *  metadata.buildDurationMs, metadata.reasoningHash itself) so a replayed decision built from
 *  the same ReasoningContext + Prompt hashes identically to the original. */
export function hashCandidateDecision(decision: CandidateDecision): string {
  const { decisionId: _decisionId, timestamp: _timestamp, metadata, ...rest } = decision;
  const { buildDurationMs: _buildDurationMs, reasoningHash: _reasoningHash, ...metadataForHash } = metadata;
  return sha256({ ...rest, metadata: metadataForHash });
}
