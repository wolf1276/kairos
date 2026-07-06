// Validation Layer for the Reasoning Engine. Fails closed: any malformed, non-finite, or
// internally-inconsistent CandidateDecision is rejected rather than passed through with a
// best-effort guess.
import { hashCandidateDecision } from './hashing.js';
import type { CandidateDecision, DecisionValidationResult, ReasoningContext } from './types.js';

const VALID_ACTIONS = new Set(['open', 'close', 'increase', 'decrease', 'hold', 'rebalance']);
const VALID_SEVERITIES = new Set(['low', 'medium', 'high']);

function isFiniteInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** A decision's protocol/asset is only considered supported if BOTH the agent's own policy and
 *  the account owner's UserPolicy allow it — either boundary can veto. */
export interface AllowedPolicy {
  allowedProtocols: string[];
  allowedAssets: string[];
}

function intersectCaseInsensitive(a: readonly string[], b: readonly string[]): string[] {
  const bLower = new Set(b.map((s) => s.toLowerCase()));
  return a.filter((s) => bLower.has(s.toLowerCase()));
}

/** Derives the effective allowed protocol/asset sets for a ReasoningContext: the intersection of
 *  AgentContext.policy (the agent's own strategy-config rules) and UserPolicy (the account
 *  owner's outer boundary) — never used as a shortcut, this is fail-closed on purpose. */
export function deriveAllowedPolicy(context: ReasoningContext): AllowedPolicy {
  return {
    allowedProtocols: intersectCaseInsensitive(context.agentContext.policy.allowedProtocols, context.userPolicy.allowedProtocols),
    allowedAssets: intersectCaseInsensitive(context.agentContext.policy.allowedAssets, context.userPolicy.allowedAssets),
  };
}

/** Validates a CandidateDecision's own shape/fields, and — when `allowed` is supplied — that its
 *  protocol/asset are within the effective allowed sets. `allowed` is optional so this function
 *  can validate decision shape in isolation (e.g. replay/audit tooling with no live
 *  ReasoningContext); every production call site (providers/baseProvider.ts, orchestrator.ts)
 *  always supplies it, so an out-of-policy protocol/asset is rejected before ever reaching a
 *  caller — this is the fail-closed boundary for policy escapes. */
export function validateCandidateDecision(decision: CandidateDecision, allowed?: AllowedPolicy): DecisionValidationResult {
  const errors: string[] = [];

  if (!decision || typeof decision !== 'object') {
    return { ok: false, errors: ['decision must be a non-null object'] };
  }

  if (!isNonEmptyString(decision.decisionId)) errors.push('decisionId must be a non-empty string');
  if (!Number.isFinite(decision.timestamp) || decision.timestamp <= 0) errors.push('timestamp must be a positive finite number');
  if (!VALID_ACTIONS.has(decision.action)) errors.push(`action must be one of ${[...VALID_ACTIONS].join(', ')}`);
  if (!isNonEmptyString(decision.protocol)) errors.push('protocol must be a non-empty string');
  if (!isNonEmptyString(decision.asset)) errors.push('asset must be a non-empty string');

  if (allowed && isNonEmptyString(decision.protocol)) {
    const supported = allowed.allowedProtocols.some((p) => p.toLowerCase() === decision.protocol.toLowerCase());
    if (!supported) errors.push(`protocol '${decision.protocol}' is not an allowed/supported protocol`);
  }
  if (allowed && isNonEmptyString(decision.asset)) {
    const supported = allowed.allowedAssets.some((a) => a.toLowerCase() === decision.asset.toLowerCase());
    if (!supported) errors.push(`asset '${decision.asset}' is not an allowed/supported asset`);
  }
  if (!isFiniteInRange(decision.allocation, 0, 1)) errors.push('allocation must be a finite number in [0, 1]');
  if (!isFiniteInRange(decision.confidence, 0, 1)) errors.push('confidence must be a finite number in [0, 1]');
  if (!isFiniteInRange(decision.uncertainty, 0, 1)) errors.push('uncertainty must be a finite number in [0, 1]');
  if (!isNonEmptyString(decision.reasoning)) errors.push('reasoning must be a non-empty string');

  if (!Array.isArray(decision.supportingEvidence) || decision.supportingEvidence.length === 0) {
    errors.push('supportingEvidence must be a non-empty array');
  } else {
    const seen = new Set<string>();
    for (const [i, item] of decision.supportingEvidence.entries()) {
      if (!item || !isNonEmptyString(item.source) || !isNonEmptyString(item.detail)) {
        errors.push(`supportingEvidence[${i}] must have non-empty source and detail`);
        continue;
      }
      if (!isFiniteInRange(item.weight, 0, 1)) {
        errors.push(`supportingEvidence[${i}].weight must be a finite number in [0, 1]`);
      }
      const key = `${item.source}::${item.detail}`;
      if (seen.has(key)) errors.push(`supportingEvidence[${i}] is a duplicate of an earlier entry`);
      seen.add(key);
    }
  }

  if (!Array.isArray(decision.risks)) {
    errors.push('risks must be an array');
  } else {
    for (const [i, risk] of decision.risks.entries()) {
      if (!risk || !isNonEmptyString(risk.description) || !VALID_SEVERITIES.has(risk.severity)) {
        errors.push(`risks[${i}] must have a non-empty description and a valid severity`);
      }
    }
  }

  if (!Array.isArray(decision.assumptions)) {
    errors.push('assumptions must be an array');
  }

  if (!Array.isArray(decision.alternatives)) {
    errors.push('alternatives must be an array');
  } else {
    for (const [i, alt] of decision.alternatives.entries()) {
      if (!alt || !VALID_ACTIONS.has(alt.action) || !isNonEmptyString(alt.reasoning)) {
        errors.push(`alternatives[${i}] must have a valid action and non-empty reasoning`);
      }
    }
  }

  if (!decision.metadata || typeof decision.metadata !== 'object') {
    errors.push('metadata is required');
  } else {
    const m = decision.metadata;
    if (!isNonEmptyString(m.reasoningVersion)) errors.push('metadata.reasoningVersion is required');
    if (!isNonEmptyString(m.promptVersion)) errors.push('metadata.promptVersion is required');
    if (!isNonEmptyString(m.providerVersion)) errors.push('metadata.providerVersion is required');
    if (!Number.isFinite(m.buildDurationMs) || m.buildDurationMs < 0) errors.push('metadata.buildDurationMs must be a non-negative finite number');
    if (!isNonEmptyString(m.reasoningHash)) errors.push('metadata.reasoningHash is required');
    if (!isNonEmptyString(m.promptHash)) errors.push('metadata.promptHash is required');
    if (!isNonEmptyString(m.schemaVersion)) errors.push('metadata.schemaVersion is required');

    if (isNonEmptyString(m.reasoningHash)) {
      const expectedHash = hashCandidateDecision(decision);
      if (expectedHash !== m.reasoningHash) {
        errors.push('metadata.reasoningHash does not match the recomputed hash of this decision');
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
