// Types for the Reasoning Engine (Phase 1: foundation only). Mirrors the Context Layer's and
// Memory Engine's types.ts — this is the ONLY shape any future LLM provider may depend on. No
// LLM calls, prompt execution, trade execution, blockchain interaction, or learning logic lives
// anywhere in this module.
import type { AgentContext } from '../agentContext/index.js';
import type { MemoryPackage } from '../memoryLayer/index.js';

/** ReasoningContext schema version — bump when the shape of ReasoningContext/Prompt/
 *  CandidateDecision changes in a way that would break a persisted or replayed reasoning
 *  request. */
export const REASONING_ENGINE_SCHEMA_VERSION = '1.0.0';

export const PROMPT_TEMPLATE_VERSION = 'v1';

/**
 * User-level policy constraints layered on top of an agent's own PolicyContextView
 * (AgentContext.policy). This is the account owner's outer boundary — allocation ceilings,
 * risk tolerance, and objective wording that apply regardless of what any single agent's
 * strategy config says. Supplied by the caller; never derived from the database here.
 */
export interface UserPolicy {
  userId: string;
  riskTolerance: 'low' | 'medium' | 'high';
  maxAllocationPct: number;
  allowedProtocols: string[];
  allowedAssets: string[];
  minConfidence: number;
  objectives: string[];
}

export interface ReasoningContextMeta {
  version: string;
  timestamp: number;
  agentId: string;
  /** SHA-256 over the deterministic content of this ReasoningContext (everything except
   *  timestamp/contextId/hash itself). */
  reasoningContextHash: string;
  contextId: string;
}

/** Immutable combination of AgentContext + MemoryPackage + UserPolicy. No database access, no
 *  providers, no HTTP, no blockchain — only the three inputs, frozen. */
export interface ReasoningContext {
  meta: ReasoningContextMeta;
  agentContext: AgentContext;
  memoryPackage: MemoryPackage;
  userPolicy: UserPolicy;
}

// ── Prompt ──────────────────────────────────────────────────────────────────────────────────

export interface PromptSections {
  system: string;
  agentIdentity: string;
  marketContext: string;
  managedCapital: string;
  historicalExperience: string;
  detectedPatterns: string;
  evidence: string;
  riskConstraints: string;
  allowedProtocols: string;
  objectives: string;
  outputSchema: string;
}

export interface Prompt {
  templateVersion: string;
  sections: PromptSections;
  /** SHA-256 over `sections` — identical ReasoningContext input must produce an identical
   *  hash across repeated builds. */
  promptHash: string;
}

// ── CandidateDecision ───────────────────────────────────────────────────────────────────────

export type CandidateAction = 'open' | 'close' | 'increase' | 'decrease' | 'hold' | 'rebalance';

export interface SupportingEvidenceItem {
  source: string;
  detail: string;
  weight: number;
}

export interface CandidateRisk {
  description: string;
  severity: 'low' | 'medium' | 'high';
}

export interface CandidateAlternative {
  action: CandidateAction;
  reasoning: string;
}

export interface CandidateDecisionMetadata {
  reasoningVersion: string;
  promptVersion: string;
  providerVersion: string;
  buildDurationMs: number;
  reasoningHash: string;
  promptHash: string;
  schemaVersion: string;
}

/** Immutable, structured output of the Reasoning Engine. Contains no execution fields — this is
 *  a proposal for a future Verification Engine to review, never something to be acted on
 *  directly. */
export interface CandidateDecision {
  decisionId: string;
  timestamp: number;
  action: CandidateAction;
  protocol: string;
  asset: string;
  /** Fraction of managed capital, in [0, 1]. */
  allocation: number;
  /** In [0, 1]. */
  confidence: number;
  reasoning: string;
  supportingEvidence: SupportingEvidenceItem[];
  risks: CandidateRisk[];
  assumptions: string[];
  alternatives: CandidateAlternative[];
  /** In [0, 1] — how much uncertainty remains in this decision, independent of confidence. */
  uncertainty: number;
  metadata: CandidateDecisionMetadata;
}

export interface DecisionValidationResult {
  ok: boolean;
  errors: string[];
}
