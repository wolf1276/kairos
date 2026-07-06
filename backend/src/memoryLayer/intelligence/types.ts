// Types for Memory Engine Phase 3 (Experience Intelligence). Everything here is a deterministic
// aggregation/rule over Phase 2's ranked episodes — no LLM, embedding, ML, or inference. Answers
// "what does history objectively show," never "what should the agent do." See
// docs/architecture/MEMORY_ENGINE.md.
import type { RetrievalQuery, ScoredEpisodicRecord, ScoredSemanticFact, RetrievalMetadata } from '../retrieval/types.js';
import type { WorkingMemoryEntry, MemoryPackageMeta, MemoryValidationResult } from '../types.js';

/** Intelligence algorithm version — bump when statistics/pattern/conflict/evidence rules change
 *  in a way that would alter output for identical input. */
export const INTELLIGENCE_VERSION = '1.0.0';

/** A tag is promoted to a pattern once at least this many episodes carry it — below this, the
 *  sample is too small to call "statistically supported" (spec: "Only report statistically
 *  supported patterns"). Fixed constant, not learned. */
export const MIN_PATTERN_SUPPORT = 3;

/** A win-rate this high/low (given MIN_PATTERN_SUPPORT) is reported as profitable/losing. */
export const PROFITABLE_WIN_RATE_THRESHOLD = 0.6;
export const LOSING_WIN_RATE_THRESHOLD = 0.4;

/** Minimum consecutive same-outcome run (sorted by timestamp) to report a streak pattern. */
export const MIN_STREAK_LENGTH = 3;

export interface FrequencyEntry {
  key: string;
  count: number;
  /** count / totalEpisodes */
  ratio: number;
}

/** Every field is a direct aggregate over the retrieved episodic set — no field here is
 *  predicted, estimated, or inferred. Fields with no eligible data are `null`, never fabricated
 *  as 0, so "no data" is never confused with "measured zero." */
export interface ExperienceStatistics {
  totalEpisodes: number;
  profitableEpisodes: number;
  losingEpisodes: number;
  neutralEpisodes: number;
  pendingEpisodes: number;
  winRate: number | null;
  lossRate: number | null;
  averageReturn: number | null;
  medianReturn: number | null;
  averageHoldingDurationSeconds: number | null;
  averageConfidence: number | null;
  averageQuality: number | null;
  /** EpisodicRecord (Phase 1, frozen) carries no allocation/position-size field — always `null`
   *  until a future phase extends the schema. Documented, not fabricated. */
  averageAllocation: null;
  protocolUsageFrequency: FrequencyEntry[];
  assetUsageFrequency: FrequencyEntry[];
  marketRegimeFrequency: FrequencyEntry[];
  maxGain: number | null;
  maxDrawdown: number | null;
}

export type PatternType =
  | 'profitable-regime'
  | 'losing-regime'
  | 'protocol-success'
  | 'protocol-failure'
  | 'asset-success'
  | 'asset-failure'
  | 'repeated-loss-streak'
  | 'repeated-recovery';

export interface DetectedPattern {
  id: string;
  type: PatternType;
  /** The regime/protocol/asset tag (or streak sequence start id) this pattern is about. */
  key: string;
  supportingEpisodeIds: string[];
  conflictingEpisodeIds: string[];
  supportCount: number;
  totalCount: number;
  winRate: number;
  averageConfidence: number;
}

export interface ConflictAnalysis {
  patternId: string;
  supportingEpisodeIds: string[];
  conflictingEpisodeIds: string[];
  supportingConfidence: number;
  conflictingConfidence: number;
  /** |supportCount - conflictCount| / totalCount — 1 means unanimous, 0 means a dead split. */
  evidenceStrength: number;
}

export interface Evidence {
  id: string;
  type: PatternType;
  supportingEpisodeIds: string[];
  confidence: number;
  quality: number;
  /** supportCount / totalEpisodesConsidered for this pattern's key — the statistical sample
   *  size backing this evidence, not a judgment of correctness. */
  statisticalSupport: number;
  affectedAssets: string[];
  affectedProtocols: string[];
  /** Regime tags observed among the supporting episodes (e.g. "trending_up"), not just the
   *  pattern's own key when the pattern type is regime-shaped. */
  marketRegimes: string[];
}

export interface IntelligenceOptions {
  minPatternSupport?: number;
  minStreakLength?: number;
}

export interface IntelligenceMetadata {
  intelligenceVersion: string;
  intelligenceDurationMs: number;
  statisticsDurationMs: number;
  patternDurationMs: number;
  conflictDurationMs: number;
  evidenceDurationMs: number;
  packageGenerationDurationMs: number;
  patternCount: number;
  evidenceCount: number;
  /** SHA-256 over the stable-stringified query + statistics + patterns + conflicts + evidence +
   *  intelligenceVersion — timing fields excluded so repeated runs over identical input hash
   *  identically. */
  packageHash: string;
}

export interface RetrievalSummary {
  episodicSelected: number;
  semanticSelected: number;
  workingSelected: number;
  retrievalHash: string;
}

/** Phase 3's output — a sibling type to MemoryRetrievalPackage (Phase 2, frozen), not a mutation
 *  of it. This is what a future Reasoning Engine actually consumes. */
export interface MemoryIntelligencePackage {
  meta: MemoryPackageMeta;
  query: RetrievalQuery;
  episodic: ScoredEpisodicRecord[];
  semantic: ScoredSemanticFact[];
  working: WorkingMemoryEntry[];
  statistics: ExperienceStatistics;
  patterns: DetectedPattern[];
  conflicts: ConflictAnalysis[];
  evidence: Evidence[];
  retrievalSummary: RetrievalSummary;
  intelligence: IntelligenceMetadata;
  validation: MemoryValidationResult;
  status: 'valid' | 'invalid';
}
