// Deterministic hashing for Decision Verification — same SHA-256-over-stableStringify technique
// used throughout the Reasoning Engine.
import { sha256 } from '../hashing.js';
import type { RuleResult } from './types.js';
import type { DecisionIntelligence } from '../decisionIntelligence/types.js';

/** Hashes the decision + full rule-result set, excluding the only non-deterministic field
 *  (`verifiedAt`, a wall-clock timestamp) — identical decision + context always produces an
 *  identical verificationHash regardless of when verification ran. */
export function hashVerification(decision: DecisionIntelligence, ruleResults: RuleResult[], verificationVersion: string): string {
  return sha256({ decisionHash: decision.metadata.decisionHash, ruleResults, verificationVersion });
}
