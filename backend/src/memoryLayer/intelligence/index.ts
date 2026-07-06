// Public surface of Memory Engine Phase 3 (Experience Intelligence). Future callers (the
// Reasoning Engine) import only from here.
export { buildMemoryIntelligencePackage } from './intelligenceOrchestrator.js';
export { computeStatistics } from './statistics.js';
export { detectPatterns } from './patterns.js';
export { analyzeConflicts } from './conflicts.js';
export { buildEvidence } from './evidence.js';
export { aggregateByTag } from './tagAggregation.js';
export { validateIntelligence } from './validation.js';
export { getIntelligenceMetricsSnapshot, resetIntelligenceMetrics } from './metrics.js';
export {
  INTELLIGENCE_VERSION,
  MIN_PATTERN_SUPPORT,
  MIN_STREAK_LENGTH,
  PROFITABLE_WIN_RATE_THRESHOLD,
  LOSING_WIN_RATE_THRESHOLD,
} from './types.js';
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
} from './types.js';
