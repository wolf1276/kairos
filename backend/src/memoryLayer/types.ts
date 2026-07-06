// Types for the Memory Engine (Phase 1: foundation only). Mirrors the Context Layer's
// types.ts — this is the ONLY shape the future Reasoning Layer may depend on. No LLM,
// embedding, ranking, or summarization logic lives anywhere in this module.

/** MemoryPackage schema version — bump when the shape of EpisodicRecord/SemanticFact/
 *  WorkingMemoryEntry/MemoryPackage changes in a way that would break a persisted package. */
export const MEMORY_PACKAGE_SCHEMA_VERSION = '1.0.0';

export type EpisodeOutcome = 'win' | 'loss' | 'neutral' | 'pending';
export type MemoryQuality = 'high' | 'medium' | 'low';

/** One immutable, completed experience. Never modified after being appended — a correction
 *  is a new episode, not an edit to an old one. */
export interface EpisodicRecord {
  id: string;
  agentId: string;
  timestamp: number;
  /** Reference into the Context Layer — typically an AgentContext.meta.snapshotId or
   *  contextHash — never the context itself, so episodes stay small and context stays the
   *  single source of truth for "what was true then". */
  contextRef: string;
  decisionRef: string | null;
  executionRef: string | null;
  outcome: EpisodeOutcome;
  pnl: number | null;
  holdingTimeSeconds: number | null;
  /** 0-1 — confidence the decision layer had at the time, not a judgment made after the fact. */
  confidence: number;
  quality: MemoryQuality;
  tags: string[];
}

/** A long-term fact, not an event. No predictions, no time-series — just "what is known
 *  to be true" for an agent, keyed so a later value for the same key replaces the prior one. */
export interface SemanticFact {
  id: string;
  agentId: string;
  key: string;
  value: string;
  confidence: number;
  updatedAt: number;
  tags: string[];
}

/** Temporary, mutable operational state — scratch space for the current tick/session.
 *  Never treated as durable; a provider may drop it at any time. */
export interface WorkingMemoryEntry {
  agentId: string;
  key: string;
  value: unknown;
  setAt: number;
  expiresAt: number | null;
}

export interface MemoryValidationResult {
  ok: boolean;
  errors: string[];
}

/** Immutable metadata stamped on every MemoryPackage assembly. */
export interface MemoryPackageMeta {
  version: string;
  agentId: string;
  timestamp: number;
  packageId: string;
  /** SHA-256 hash over the deterministic content of this package (everything except
   *  packageId/timestamp/hash itself) — lets two packages be compared for exact equality. */
  packageHash: string;
}

export interface MemoryPackage {
  meta: MemoryPackageMeta;
  episodic: EpisodicRecord[];
  semantic: SemanticFact[];
  working: WorkingMemoryEntry[];
  validation: MemoryValidationResult;
  status: 'valid' | 'invalid';
}
