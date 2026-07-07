// Types for Reasoning Engine Phase 10 (Learning Engine). Deterministic — no AI, no LLM, no
// inference, no prediction. Turns a frozen `MemoryPackage` (Memory Engine, see
// `../../memoryLayer/types.ts`) into an immutable, hashable, replayable `LearningSnapshot` of
// pure statistical analytics over that package's episodic/semantic content. Never mutates the
// MemoryPackage passed in, never fetches anything, never calls out to any model.
import type { EpisodeOutcome } from '../../memoryLayer/types.js';

export const LEARNING_ENGINE_VERSION = '1.0.0';

export const LEARNING_REJECTION_REASONS = [
  'malformed_memory_package',
  'invalid_source_package',
  'missing_package_hash',
  'missing_episodic_hash',
  'missing_semantic_hash',
  'duplicate_episodic_memory',
  'duplicate_semantic_memory',
  'inconsistent_metadata',
  'invalid_numeric_field',
  'invalid_confidence',
  'invalid_outcome',
  'invalid_tags',
] as const;
export type LearningRejectionReason = (typeof LEARNING_REJECTION_REASONS)[number];

/** Per-protocol usage/outcome tally. Protocol is read from `EpisodicRecord.tags[0]` — the
 *  Memory Writer (Phase 9) always writes `[protocol, action, executionStatus, dataSource,
 *  ...assets]` as an episode's tags (see `memoryWriter/deriver.ts::buildEpisodicRecord`), so
 *  this is a stable, documented convention rather than a guess. */
export interface ProtocolStat {
  protocol: string;
  usageCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  failureRate: number;
}

export interface AssetUsageStat {
  asset: string;
  count: number;
}

/** Average of a numeric signal across every semantic fact whose key matches a known prefix
 *  (e.g. `last_fees:`). `null` whenever the package carries zero matching facts — never
 *  fabricated as `0`, since `0` is a valid observed average and would be indistinguishable from
 *  "no data". */
export interface AverageMetric {
  value: number;
  sampleCount: number;
}

export interface ConfidenceBucket {
  bucketMin: number;
  bucketMax: number;
  count: number;
  avgConfidence: number;
  winRate: number;
}

export interface ProviderReliability {
  protocol: string;
  reliabilityScore: number;
  sampleCount: number;
}

export interface ExecutionDistributionEntry {
  protocol: string;
  fraction: number;
}

export interface LearningSnapshotMetadata {
  learningEngineVersion: string;
  [key: string]: unknown;
}

/** Immutable, replayable, hashable result of computing analytics over one `MemoryPackage`.
 *  Never mutated after being returned. Identical `MemoryPackage` content always produces an
 *  identical `snapshotHash`, regardless of when or how many times it is computed. */
export interface LearningSnapshot {
  snapshotId: string;
  snapshotHash: string;
  sourcePackageHash: string;
  agentId: string;
  episodeCount: number;
  semanticFactCount: number;
  protocolStats: ProtocolStat[];
  assetUsage: AssetUsageStat[];
  avgFees: AverageMetric | null;
  avgSlippage: AverageMetric | null;
  avgExecutionLatencyMs: AverageMetric | null;
  avgResourceUsage: AverageMetric | null;
  confidenceCalibration: ConfidenceBucket[];
  verificationPassRate: number;
  retryStatistics: AverageMetric | null;
  providerReliability: ProviderReliability[];
  executionDistribution: ExecutionDistributionEntry[];
  metadata: LearningSnapshotMetadata;
}

export interface ComputeLearningSnapshotOptions {
  /** Injectable id for deterministic tests — defaults to `randomUUID()`. Excluded from
   *  `snapshotHash`, same pattern as `RecordOutcomeOptions.outcomeId`. */
  snapshotId?: string;
}

/** Local, narrow re-export so callers of this module never need to reach into `EpisodeOutcome`
 *  through `memoryLayer` directly. */
export type { EpisodeOutcome };
