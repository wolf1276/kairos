// Public surface of the Memory Engine — future callers (the Reasoning Layer, episode writers)
// import only from here, never reaching into provider implementations directly.
export { assembleMemoryPackage, MemoryOrchestratorError } from './orchestrator.js';
export { validateMemoryPackage } from './validation.js';
export {
  getEpisodicMemoryProvider,
  setEpisodicMemoryProvider,
  resetEpisodicMemoryProvider,
  getSemanticMemoryProvider,
  setSemanticMemoryProvider,
  resetSemanticMemoryProvider,
  getWorkingMemoryProvider,
  setWorkingMemoryProvider,
  resetWorkingMemoryProvider,
  resetAllMemoryProviders,
  InMemoryEpisodicProvider,
  InMemorySemanticProvider,
  InMemoryWorkingProvider,
} from './providers/index.js';
export type { EpisodicMemoryProvider, SemanticMemoryProvider, WorkingMemoryProvider } from './providers/types.js';
export { getMemoryMetricsSnapshot, resetMemoryMetrics } from './metrics.js';
export {
  MEMORY_PACKAGE_SCHEMA_VERSION,
} from './types.js';
export type {
  EpisodicRecord,
  SemanticFact,
  WorkingMemoryEntry,
  MemoryPackage,
  MemoryPackageMeta,
  MemoryValidationResult,
  EpisodeOutcome,
  MemoryQuality,
} from './types.js';

// Phase 2 (Retrieval & Relevance) — re-exported here so callers don't need to know the Memory
// Engine has sub-modules; canonical exports live in ./retrieval/index.ts.
export {
  retrieveMemoryPackage,
  MemoryRetrievalError,
  buildRetrievalQuery,
  validateRetrieval,
  getRetrievalMetricsSnapshot,
  resetRetrievalMetrics,
  SCORE_WEIGHTS,
  DEFAULT_TOP_K_EPISODIC,
  DEFAULT_TOP_K_SEMANTIC,
  DEFAULT_TOP_K_WORKING,
  RETRIEVAL_RANKING_VERSION,
} from './retrieval/index.js';
export type {
  RetrievalQuery,
  RetrievalOptions,
  RetrievalMetadata,
  RelevanceScoreBreakdown,
  ScoredEpisodicRecord,
  ScoredSemanticFact,
  MemoryRetrievalPackage,
} from './retrieval/index.js';

// Phase 3 (Experience Intelligence) — re-exported here so callers don't need to know the Memory
// Engine has sub-modules; canonical exports live in ./intelligence/index.ts.
export {
  buildMemoryIntelligencePackage,
  computeStatistics,
  detectPatterns,
  analyzeConflicts,
  buildEvidence,
  aggregateByTag,
  validateIntelligence,
  getIntelligenceMetricsSnapshot,
  resetIntelligenceMetrics,
  INTELLIGENCE_VERSION,
  MIN_PATTERN_SUPPORT,
  MIN_STREAK_LENGTH,
  PROFITABLE_WIN_RATE_THRESHOLD,
  LOSING_WIN_RATE_THRESHOLD,
} from './intelligence/index.js';
export type {
  ExperienceStatistics,
  FrequencyEntry,
  DetectedPattern,
  PatternType,
  ConflictAnalysis,
  Evidence,
  IntelligenceOptions,
  IntelligenceMetadata,
  RetrievalSummary,
  MemoryIntelligencePackage,
} from './intelligence/index.js';
