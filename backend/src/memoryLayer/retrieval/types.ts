// Types for Memory Engine Phase 2 (Retrieval & Relevance). Every value here is derived
// deterministically from an AgentContext + the Phase 1 providers — no LLM, embedding, or ML
// scoring lives anywhere in this module. See docs/architecture/MEMORY_ENGINE.md.
import type { EpisodicRecord, SemanticFact, WorkingMemoryEntry, MemoryPackageMeta, MemoryValidationResult } from '../types.js';

/** Retrieval Ranking algorithm version — bump when scoring weights or the ranking tie-break
 *  change in a way that would reorder an otherwise-identical retrieval. */
export const RETRIEVAL_RANKING_VERSION = '1.0.0';

/** Deterministic filter/scoring key derived from one AgentContext. Every field here is either
 *  copied straight off AgentContext (regime, objective, riskProfile) or derived from it
 *  (asset/protocol lists, the tag union) — never inferred, predicted, or fetched externally. */
export interface RetrievalQuery {
  agentId: string;
  regime: string;
  assets: string[];
  protocols: string[];
  objective: string;
  riskProfile: string;
  /** Union of regime/assets/protocols/objective/riskProfile, lower-cased and de-duplicated —
   *  the candidate-filtering key against EpisodicRecord.tags / SemanticFact.tags. */
  tags: string[];
  /** Reference clock for recency scoring — taken from AgentContext.meta.timestamp, not
   *  Date.now(), so identical AgentContext input always yields identical recency scores. */
  now: number;
}

export interface RelevanceScoreBreakdown {
  regimeMatch: number;
  protocolMatch: number;
  assetMatch: number;
  objectiveMatch: number;
  riskProfileMatch: number;
  recency: number;
  confidence: number;
  quality: number;
  total: number;
}

export interface ScoredEpisodicRecord extends EpisodicRecord {
  score: number;
  scoreBreakdown: RelevanceScoreBreakdown;
}

export interface ScoredSemanticFact extends SemanticFact {
  score: number;
  scoreBreakdown: RelevanceScoreBreakdown;
}

export interface RetrievalOptions {
  topKEpisodic?: number;
  topKSemantic?: number;
  topKWorking?: number;
  /** Overrides RetrievalQuery.now — test-only escape hatch; production callers should let this
   *  default to AgentContext.meta.timestamp. */
  now?: number;
}

export interface RetrievalMetadata {
  retrievalDurationMs: number;
  rankingDurationMs: number;
  episodicScanned: number;
  semanticScanned: number;
  workingScanned: number;
  episodicSelected: number;
  semanticSelected: number;
  workingSelected: number;
  rankingVersion: string;
  /** SHA-256 over the stable-stringified query + selected/scored records + rankingVersion —
   *  lets two retrievals be compared for exact equality without a deep diff. */
  retrievalHash: string;
}

/** Phase 2's output — deliberately a *sibling* type to MemoryPackage, not a mutation of it.
 *  MemoryPackage (Phase 1) stays frozen; this is what a future Reasoning Layer actually consumes. */
export interface MemoryRetrievalPackage {
  meta: MemoryPackageMeta;
  query: RetrievalQuery;
  episodic: ScoredEpisodicRecord[];
  semantic: ScoredSemanticFact[];
  working: WorkingMemoryEntry[];
  retrieval: RetrievalMetadata;
  validation: MemoryValidationResult;
  status: 'valid' | 'invalid';
}
