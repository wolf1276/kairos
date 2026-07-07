// Public surface of the Reasoning Engine. Future callers — the orchestration layer that invokes
// a ReasoningProvider — import only from here, never reaching into
// contextBuilder.ts/promptBuilder.ts/validation.ts directly.
export { buildReasoningContext, ReasoningContextError } from './contextBuilder.js';
export { buildPrompt } from './promptBuilder.js';
export { validateCandidateDecision, deriveAllowedPolicy } from './validation.js';
export { buildReasoningRequest, buildReasoningRequestContext, assemblePrompt, validateDecision, runReasoning } from './orchestrator.js';

/** Phase 3 (Decision Intelligence) — a distinct schema/pipeline from CandidateDecision above,
 *  namespaced to avoid name collisions (both modules export a `validate*` function). See
 *  decisionIntelligence/index.ts and docs/architecture/REASONING_ENGINE.md. */
export * as decisionIntelligence from './decisionIntelligence/index.js';

/** Phase 4 (Decision Verification) — deterministic, rule-based, no AI/LLM. Namespaced for the
 *  same reason as decisionIntelligence above. See verification/index.ts and
 *  docs/architecture/REASONING_ENGINE.md. */
export * as verification from './verification/index.js';

export type { ReasoningProvider } from './interfaces.js';

export {
  REASONING_ENGINE_SCHEMA_VERSION,
  PROMPT_TEMPLATE_VERSION,
} from './types.js';
export type { AllowedPolicy } from './validation.js';
export type {
  UserPolicy,
  ReasoningContext,
  ReasoningContextMeta,
  Prompt,
  PromptSections,
  CandidateAction,
  SupportingEvidenceItem,
  CandidateRisk,
  CandidateAlternative,
  CandidateDecisionMetadata,
  CandidateDecision,
  DecisionValidationResult,
} from './types.js';
