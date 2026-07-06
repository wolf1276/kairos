// Public surface of Decision Intelligence (Phase 3). Callers import only from here.
export { generateDecisionIntelligence } from './orchestrator.js';
export { validateDecisionIntelligence } from './validation.js';
export { hashDecisionIntelligence } from './hashing.js';
export { normalizeToDecisionIntelligence } from './normalize.js';
export { DECISION_INTELLIGENCE_JSON_SCHEMA, parseStrictJson, MalformedDecisionIntelligenceError } from './schema.js';
export { getDecisionIntelligenceMetrics, resetDecisionIntelligenceMetrics } from './metrics.js';

export {
  DECISION_INTELLIGENCE_SCHEMA_VERSION,
  DECISION_PROMPT_TEMPLATE_VERSION,
  PRIMARY_ACTIONS,
  EVIDENCE_TYPES,
} from './types.js';
export type {
  PrimaryAction,
  EvidenceType,
  EvidenceItem,
  ReasoningStep,
  PrimaryDecision,
  AlternativeDecision,
  RiskItem,
  UncertaintyAssessment,
  ExpectedDirection,
  ExpectedOutcome,
  ConfidenceBreakdown,
  DecisionIntelligenceMetadata,
  DecisionIntelligence,
  DecisionIntelligenceValidationResult,
} from './types.js';
export type { GenerateDecisionIntelligenceResult } from './orchestrator.js';
export type { DecisionIntelligenceValidationOptions } from './validation.js';
export type { DecisionIntelligenceObservability } from './metrics.js';
