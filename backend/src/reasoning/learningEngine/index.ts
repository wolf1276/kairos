// Public surface of the Learning Engine (Phase 10). Callers import only from here.
export { computeLearningSnapshot, LearningSnapshotValidationError } from './engine.js';
export { hashLearningSnapshot } from './hashing.js';
export { checkMemoryPackage } from './rules.js';
export {
  computeProtocolStats,
  computeAssetUsage,
  computeAverageFromSemanticPrefix,
  computeConfidenceCalibration,
  computeVerificationPassRate,
  computeProviderReliability,
  computeExecutionDistribution,
} from './analytics.js';
export { LEARNING_ENGINE_VERSION, LEARNING_REJECTION_REASONS } from './types.js';

export type { RuleFailure } from './rules.js';
export type {
  ProtocolStat,
  AssetUsageStat,
  AverageMetric,
  ConfidenceBucket,
  ProviderReliability,
  ExecutionDistributionEntry,
  LearningSnapshotMetadata,
  LearningSnapshot,
  ComputeLearningSnapshotOptions,
  LearningRejectionReason,
} from './types.js';
