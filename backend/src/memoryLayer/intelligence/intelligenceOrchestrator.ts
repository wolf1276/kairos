// Memory Intelligence Engine / Orchestrator — Phase 3's single assembly point. Runs Phase 2's
// retrieveMemoryPackage unchanged, then derives statistics/patterns/conflicts/evidence purely
// from its ranked episodes in one additional pass (plus one sort for streaks/median). Never
// reasons, decides, predicts, or generates natural language — see docs/architecture/MEMORY_ENGINE.md.
import { createHash } from 'crypto';
import { randomUUID } from 'crypto';
import type { AgentContext } from '../../agentContext/types.js';
import { retrieveMemoryPackage } from '../retrieval/retrievalOrchestrator.js';
import type { RetrievalOptions } from '../retrieval/types.js';
import { stableStringify } from '../../stableStringify.js';
import { aggregateByTag } from './tagAggregation.js';
import { computeStatistics } from './statistics.js';
import { detectPatterns } from './patterns.js';
import { analyzeConflicts } from './conflicts.js';
import { buildEvidence } from './evidence.js';
import { validateIntelligence } from './validation.js';
import { recordIntelligence, logIfSlow } from './metrics.js';
import { INTELLIGENCE_VERSION } from './types.js';
import type { MemoryIntelligencePackage, IntelligenceOptions, IntelligenceMetadata } from './types.js';
import { MEMORY_PACKAGE_SCHEMA_VERSION } from '../types.js';

function deepFreeze<T>(obj: T): T {
  if (obj !== null && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const value of Object.values(obj as Record<string, unknown>)) deepFreeze(value);
  }
  return obj;
}

/**
 * Builds the immutable MemoryIntelligencePackage for one agent: retrieves ranked memories
 * (Phase 2, unmodified) then derives deterministic statistics, patterns, conflicts, and evidence
 * from them. Answers "what does history show," never "what should the agent do."
 */
export async function buildMemoryIntelligencePackage(
  context: AgentContext,
  retrievalOptions: RetrievalOptions = {},
  intelligenceOptions: IntelligenceOptions = {}
): Promise<MemoryIntelligencePackage> {
  const start = performance.now();
  try {
    const pkg = await buildInner(context, retrievalOptions, intelligenceOptions, start);
    const metricsInput = {
      intelligenceMs: pkg.intelligence.intelligenceDurationMs,
      statisticsMs: pkg.intelligence.statisticsDurationMs,
      patternMs: pkg.intelligence.patternDurationMs,
      conflictMs: pkg.intelligence.conflictDurationMs,
      evidenceMs: pkg.intelligence.evidenceDurationMs,
      patternCount: pkg.patterns.length,
      evidenceCount: pkg.evidence.length,
      outcome: 'success' as const,
    };
    recordIntelligence(metricsInput);
    logIfSlow(metricsInput);
    return pkg;
  } catch (error) {
    recordIntelligence({
      intelligenceMs: performance.now() - start,
      statisticsMs: 0,
      patternMs: 0,
      conflictMs: 0,
      evidenceMs: 0,
      patternCount: 0,
      evidenceCount: 0,
      outcome: 'failure',
    });
    throw error;
  }
}

async function buildInner(
  context: AgentContext,
  retrievalOptions: RetrievalOptions,
  intelligenceOptions: IntelligenceOptions,
  start: number
): Promise<MemoryIntelligencePackage> {
  const retrieval = await retrieveMemoryPackage(context, retrievalOptions);

  const statsStart = performance.now();
  const byTag = aggregateByTag(retrieval.episodic);
  const statistics = computeStatistics(retrieval.episodic, retrieval.query, byTag);
  const statisticsDurationMs = performance.now() - statsStart;

  const patternStart = performance.now();
  const patterns = detectPatterns(retrieval.episodic, retrieval.query, byTag, intelligenceOptions.minPatternSupport, intelligenceOptions.minStreakLength);
  const patternDurationMs = performance.now() - patternStart;

  const conflictStart = performance.now();
  const byId = new Map(retrieval.episodic.map((e) => [e.id, e] as const));
  const conflicts = analyzeConflicts(patterns, retrieval.episodic, byId);
  const conflictDurationMs = performance.now() - conflictStart;

  const evidenceStart = performance.now();
  const evidence = buildEvidence(patterns, retrieval.episodic, retrieval.query, byId);
  const evidenceDurationMs = performance.now() - evidenceStart;

  const assemblyStart = performance.now();
  const ownValidation = validateIntelligence({ episodic: retrieval.episodic, statistics, patterns, conflicts, evidence });
  // Merge in Phase 2's validation errors too — status already accounts for retrieval.status,
  // but the errors array itself must carry the *reason*, so a package can never be marked
  // invalid while exposing an empty validation.errors to its caller.
  const errors = [...retrieval.validation.errors, ...ownValidation.errors];
  const validation = { ok: errors.length === 0, errors };
  const status = validation.errors.length === 0 && retrieval.status === 'valid' ? ('valid' as const) : ('invalid' as const);

  const packageHash = createHash('sha256')
    .update(
      stableStringify({
        query: retrieval.query,
        statistics,
        patterns,
        conflicts,
        evidence,
        intelligenceVersion: INTELLIGENCE_VERSION,
      })
    )
    .digest('hex');

  const intelligence: IntelligenceMetadata = {
    intelligenceVersion: INTELLIGENCE_VERSION,
    intelligenceDurationMs: performance.now() - start,
    statisticsDurationMs,
    patternDurationMs,
    conflictDurationMs,
    evidenceDurationMs,
    packageGenerationDurationMs: performance.now() - assemblyStart,
    patternCount: patterns.length,
    evidenceCount: evidence.length,
    packageHash,
  };

  const memoryIntelligencePackage: MemoryIntelligencePackage = {
    meta: {
      version: MEMORY_PACKAGE_SCHEMA_VERSION,
      agentId: context.agentId,
      timestamp: Date.now(),
      packageId: randomUUID(),
      packageHash,
    },
    query: retrieval.query,
    episodic: retrieval.episodic,
    semantic: retrieval.semantic,
    working: retrieval.working,
    statistics,
    patterns,
    conflicts,
    evidence,
    retrievalSummary: {
      episodicSelected: retrieval.retrieval.episodicSelected,
      semanticSelected: retrieval.retrieval.semanticSelected,
      workingSelected: retrieval.retrieval.workingSelected,
      retrievalHash: retrieval.retrieval.retrievalHash,
    },
    intelligence,
    validation,
    status,
  };

  return deepFreeze(memoryIntelligencePackage);
}
