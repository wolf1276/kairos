// Fail-closed validation for Decision Intelligence. Never guesses or coerces — only accepts or
// rejects with a list of reasons, same contract as reasoning/validation.ts::validateCandidateDecision.
import { hashDecisionIntelligence } from './hashing.js';
import { PRIMARY_ACTIONS, EVIDENCE_TYPES } from './types.js';
import type { AllowedPolicy, DecisionIntelligence, DecisionIntelligenceValidationResult, EvidenceType, PrimaryAction } from './types.js';

const VALID_ACTIONS = new Set<string>(PRIMARY_ACTIONS);
const VALID_EVIDENCE_TYPES = new Set<string>(EVIDENCE_TYPES);
const VALID_SEVERITIES = new Set(['low', 'medium', 'high']);
const VALID_DIRECTIONS = new Set(['up', 'down', 'flat', 'uncertain']);

function isFiniteInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** Optional `allowed`/`maxAllocationPct` enforce policy compliance (protocol/asset allowlist,
 *  allocation ceiling) — omitted only for shape-only validation (e.g. replay/audit tooling). */
export interface DecisionIntelligenceValidationOptions {
  allowed?: AllowedPolicy;
  maxAllocationPct?: number;
}

function isSupportedAction(action: unknown): action is PrimaryAction {
  return typeof action === 'string' && VALID_ACTIONS.has(action);
}

function checkProtocolAsset(
  errors: string[],
  label: string,
  protocol: unknown,
  asset: unknown,
  allowed?: AllowedPolicy
): void {
  if (!isNonEmptyString(protocol)) {
    errors.push(`${label}.protocol must be a non-empty string`);
  } else if (allowed && !allowed.allowedProtocols.some((p) => p.toLowerCase() === protocol.toLowerCase())) {
    errors.push(`${label}.protocol '${protocol}' is not an allowed/supported protocol`);
  }
  if (!isNonEmptyString(asset)) {
    errors.push(`${label}.asset must be a non-empty string`);
  } else if (allowed && !allowed.allowedAssets.some((a) => a.toLowerCase() === asset.toLowerCase())) {
    errors.push(`${label}.asset '${asset}' is not an allowed/supported asset`);
  }
}

export function validateDecisionIntelligence(
  decision: DecisionIntelligence,
  options: DecisionIntelligenceValidationOptions = {}
): DecisionIntelligenceValidationResult {
  const { allowed, maxAllocationPct } = options;
  const errors: string[] = [];

  if (!decision || typeof decision !== 'object') {
    return { ok: false, errors: ['decision must be a non-null object'] };
  }

  if (!isNonEmptyString(decision.decisionId)) errors.push('decisionId must be a non-empty string');
  if (!Number.isFinite(decision.timestamp) || decision.timestamp <= 0) errors.push('timestamp must be a positive finite number');

  // ── Primary decision ──
  const pd = decision.primaryDecision;
  if (!pd || typeof pd !== 'object') {
    errors.push('primaryDecision is required');
  } else {
    if (!isSupportedAction(pd.action)) errors.push(`primaryDecision.action must be one of ${PRIMARY_ACTIONS.join(', ')}`);
    checkProtocolAsset(errors, 'primaryDecision', pd.protocol, pd.asset, allowed);
    if (!isFiniteInRange(pd.allocation, 0, 1)) errors.push('primaryDecision.allocation must be a finite number in [0, 1]');
    else if (maxAllocationPct !== undefined && pd.allocation > maxAllocationPct / 100) {
      errors.push(`primaryDecision.allocation (${pd.allocation}) exceeds policy maxAllocationPct (${maxAllocationPct}%)`);
    }
    if (!isFiniteInRange(pd.confidence, 0, 1)) errors.push('primaryDecision.confidence must be a finite number in [0, 1]');
  }

  // ── Alternatives (2-3) ──
  if (!Array.isArray(decision.alternatives) || decision.alternatives.length < 2 || decision.alternatives.length > 3) {
    errors.push('alternatives must be an array of 2-3 items');
  } else {
    decision.alternatives.forEach((alt, i) => {
      const label = `alternatives[${i}]`;
      if (!alt || typeof alt !== 'object') {
        errors.push(`${label} must be an object`);
        return;
      }
      if (!isSupportedAction(alt.action)) errors.push(`${label}.action must be one of ${PRIMARY_ACTIONS.join(', ')}`);
      checkProtocolAsset(errors, label, alt.protocol, alt.asset, allowed);
      if (!isFiniteInRange(alt.allocation, 0, 1)) errors.push(`${label}.allocation must be a finite number in [0, 1]`);
      else if (maxAllocationPct !== undefined && alt.allocation > maxAllocationPct / 100) {
        errors.push(`${label}.allocation exceeds policy maxAllocationPct`);
      }
      if (!isFiniteInRange(alt.confidence, 0, 1)) errors.push(`${label}.confidence must be a finite number in [0, 1]`);
      if (!isNonEmptyString(alt.tradeoffs)) errors.push(`${label}.tradeoffs must be a non-empty string`);
    });
  }

  // ── Evidence (cited by reasoning chain) ──
  if (!Array.isArray(decision.evidence) || decision.evidence.length === 0) {
    errors.push('evidence must be a non-empty array');
  } else {
    const seen = new Set<string>();
    decision.evidence.forEach((item, i) => {
      const label = `evidence[${i}]`;
      if (!item || !VALID_EVIDENCE_TYPES.has(item.type as EvidenceType)) errors.push(`${label}.type must be one of ${EVIDENCE_TYPES.join(', ')}`);
      if (!item || !isNonEmptyString(item.source)) errors.push(`${label}.source must be a non-empty string`);
      if (!item || !isNonEmptyString(item.detail)) errors.push(`${label}.detail must be a non-empty string`);
      if (!item || !isFiniteInRange(item.weight, 0, 1)) errors.push(`${label}.weight must be a finite number in [0, 1]`);
      if (item) {
        const key = `${item.source}::${item.detail}`;
        if (seen.has(key)) errors.push(`${label} is a duplicate of an earlier evidence entry`);
        seen.add(key);
      }
    });
  }

  // ── Reasoning chain (must cite evidence; refs must resolve — "broken reference" rejection) ──
  if (!Array.isArray(decision.reasoningChain) || decision.reasoningChain.length === 0) {
    errors.push('reasoningChain must be a non-empty array');
  } else {
    const evidenceLength = Array.isArray(decision.evidence) ? decision.evidence.length : 0;
    decision.reasoningChain.forEach((step, i) => {
      const label = `reasoningChain[${i}]`;
      if (!step || !isNonEmptyString(step.step)) errors.push(`${label}.step must be a non-empty string`);
      if (!step || !Array.isArray(step.evidenceRefs) || step.evidenceRefs.length === 0) {
        errors.push(`${label}.evidenceRefs must be a non-empty array (every reasoning step must cite evidence)`);
      } else {
        for (const ref of step.evidenceRefs) {
          if (!Number.isInteger(ref) || ref < 0 || ref >= evidenceLength) {
            errors.push(`${label}.evidenceRefs references evidence[${ref}], which does not exist (broken reference)`);
          }
        }
      }
    });
  }

  // ── Assumptions ──
  if (!isStringArray(decision.assumptions) || decision.assumptions.length === 0) {
    errors.push('assumptions must be a non-empty array of strings (no hidden assumptions)');
  }

  // ── Risks ──
  if (!Array.isArray(decision.risks)) {
    errors.push('risks must be an array');
  } else {
    decision.risks.forEach((risk, i) => {
      const label = `risks[${i}]`;
      if (!risk || !isNonEmptyString(risk.description)) errors.push(`${label}.description must be a non-empty string`);
      if (!risk || !isFiniteInRange(risk.probability, 0, 1)) errors.push(`${label}.probability must be a finite number in [0, 1]`);
      if (!risk || !VALID_SEVERITIES.has(risk.severity)) errors.push(`${label}.severity must be one of low, medium, high`);
      if (!risk || !isNonEmptyString(risk.mitigation)) errors.push(`${label}.mitigation must be a non-empty string`);
    });
  }

  // ── Uncertainty ──
  const unc = decision.uncertainty;
  if (!unc || typeof unc !== 'object') {
    errors.push('uncertainty is required');
  } else {
    if (!isStringArray(unc.missingInformation)) errors.push('uncertainty.missingInformation must be an array of strings');
    if (!isStringArray(unc.conflictingEvidence)) errors.push('uncertainty.conflictingEvidence must be an array of strings');
    if (!isStringArray(unc.lowConfidenceSignals)) errors.push('uncertainty.lowConfidenceSignals must be an array of strings');
    if (!isFiniteInRange(unc.score, 0, 1)) errors.push('uncertainty.score must be a finite number in [0, 1]');
  }

  // ── Expected outcome ──
  const eo = decision.expectedOutcome;
  if (!eo || typeof eo !== 'object') {
    errors.push('expectedOutcome is required');
  } else {
    if (!VALID_DIRECTIONS.has(eo.direction)) errors.push('expectedOutcome.direction must be one of up, down, flat, uncertain');
    if (!isNonEmptyString(eo.expectedBenefit)) errors.push('expectedOutcome.expectedBenefit must be a non-empty string');
    if (!isNonEmptyString(eo.expectedDownside)) errors.push('expectedOutcome.expectedDownside must be a non-empty string');
  }

  // ── Confidence ──
  const conf = decision.confidence;
  if (!conf || typeof conf !== 'object') {
    errors.push('confidence is required');
  } else {
    if (!isFiniteInRange(conf.overall, 0, 1)) errors.push('confidence.overall must be a finite number in [0, 1]');
    const per = conf.perSection;
    if (!per || typeof per !== 'object') {
      errors.push('confidence.perSection is required');
    } else {
      for (const key of ['primaryDecision', 'alternatives', 'evidence', 'risk', 'expectedOutcome'] as const) {
        if (!isFiniteInRange(per[key], 0, 1)) errors.push(`confidence.perSection.${key} must be a finite number in [0, 1]`);
      }
    }
  }

  // ── Summary ──
  if (!isNonEmptyString(decision.summary)) errors.push('summary must be a non-empty string');

  // ── Metadata ──
  if (!decision.metadata || typeof decision.metadata !== 'object') {
    errors.push('metadata is required');
  } else {
    const m = decision.metadata;
    if (!isNonEmptyString(m.reasoningVersion)) errors.push('metadata.reasoningVersion is required');
    if (!isNonEmptyString(m.decisionVersion)) errors.push('metadata.decisionVersion is required');
    if (!isNonEmptyString(m.promptVersion)) errors.push('metadata.promptVersion is required');
    if (!isNonEmptyString(m.providerVersion)) errors.push('metadata.providerVersion is required');
    if (!Number.isFinite(m.reasoningDurationMs) || m.reasoningDurationMs < 0) errors.push('metadata.reasoningDurationMs must be a non-negative finite number');
    if (!Number.isFinite(m.evidenceCount) || m.evidenceCount < 0) errors.push('metadata.evidenceCount must be a non-negative finite number');
    if (!Number.isFinite(m.alternativeCount) || m.alternativeCount < 0) errors.push('metadata.alternativeCount must be a non-negative finite number');
    if (!isFiniteInRange(m.uncertaintyScore, 0, 1)) errors.push('metadata.uncertaintyScore must be a finite number in [0, 1]');
    if (!isNonEmptyString(m.decisionHash)) errors.push('metadata.decisionHash is required');
    if (!isNonEmptyString(m.promptHash)) errors.push('metadata.promptHash is required');

    if (isNonEmptyString(m.decisionHash)) {
      const expectedHash = hashDecisionIntelligence(decision);
      if (expectedHash !== m.decisionHash) {
        errors.push('metadata.decisionHash does not match the recomputed hash of this decision');
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
