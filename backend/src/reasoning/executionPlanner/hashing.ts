// Deterministic hashing for Execution Plans — same SHA-256-over-stableStringify technique used
// throughout the Reasoning Engine.
import { sha256 } from '../hashing.js';
import type { ExecutionPlan } from './types.js';

/** Hashes an ExecutionPlan's content, excluding the only non-deterministic fields
 *  (`executionId` — a random uuid — and `timestamp`) so replanning from the same VerifiedDecision
 *  + AgentContext always produces an identical `planHash` regardless of when or how many times it
 *  runs. */
export function hashExecutionPlan(plan: ExecutionPlan): string {
  // The top-level `planHash` field must ALSO be excluded, not just `metadata.planHash` — a
  // completed plan carries its own hash at both locations, and leaving the top-level one in
  // `rest` made recomputing the hash on an already-built plan diverge from the hash used to
  // build it in the first place (self-referential corruption). Found during the Phase 5 final
  // production audit.
  const { executionId: _executionId, timestamp: _timestamp, planHash: _planHash, metadata, ...rest } = plan;
  const { planHash: _metadataPlanHash, ...metadataForHash } = metadata;
  return sha256({ ...rest, metadata: metadataForHash });
}
