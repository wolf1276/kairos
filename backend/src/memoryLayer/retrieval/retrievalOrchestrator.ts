// Memory Retrieval Engine / Orchestrator — Phase 2's single assembly point. Takes an immutable
// AgentContext, pulls candidates from the Phase 1 providers exactly once each, scores/ranks/
// selects deterministically, and freezes the result into a MemoryRetrievalPackage. Never reasons,
// decides, executes, or learns — see docs/architecture/MEMORY_ENGINE.md.
import { createHash, randomUUID } from 'crypto';
import type { AgentContext } from '../../agentContext/types.js';
import { getEpisodicMemoryProvider, getSemanticMemoryProvider, getWorkingMemoryProvider } from '../providers/index.js';
import { stableStringify } from '../../stableStringify.js';
import { buildRetrievalQuery } from './queryBuilder.js';
import { buildTagIndex, filterCandidatesByTags } from './tagIndex.js';
import { scoreEpisodicRecord, scoreSemanticFact } from './scoring.js';
import { rankEpisodicRecords, rankSemanticFacts } from './ranking.js';
import { selectTopK, DEFAULT_TOP_K_EPISODIC, DEFAULT_TOP_K_SEMANTIC, DEFAULT_TOP_K_WORKING } from './topK.js';
import { validateRetrieval } from './validation.js';
import { recordRetrieval } from './metrics.js';
import { RETRIEVAL_RANKING_VERSION } from './types.js';
import type { MemoryRetrievalPackage, RetrievalOptions, RetrievalMetadata, ScoredEpisodicRecord, ScoredSemanticFact } from './types.js';
import { MEMORY_PACKAGE_SCHEMA_VERSION } from '../types.js';

export class MemoryRetrievalError extends Error {}

function deepFreeze<T>(obj: T): T {
  if (obj !== null && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const value of Object.values(obj as Record<string, unknown>)) deepFreeze(value);
  }
  return obj;
}

function computeRetrievalHash(input: {
  query: unknown;
  episodic: ScoredEpisodicRecord[];
  semantic: ScoredSemanticFact[];
  working: unknown;
  rankingVersion: string;
}): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

/**
 * Retrieves the Top-K most relevant memories for an agent, given its current AgentContext.
 * Reuses Phase 1's providers as-is (list-only, one call each) — this function owns filtering,
 * scoring, ranking, and selection, none of which live in the providers or the Phase 1
 * orchestrator.
 */
export async function retrieveMemoryPackage(context: AgentContext, options: RetrievalOptions = {}): Promise<MemoryRetrievalPackage> {
  if (!context?.agentId) throw new MemoryRetrievalError('retrieveMemoryPackage requires an AgentContext with a non-empty agentId');

  const retrievalStart = performance.now();
  try {
    const pkg = await retrieveMemoryPackageInner(context, options, retrievalStart);
    recordRetrieval(
      pkg.retrieval.retrievalDurationMs,
      pkg.retrieval.rankingDurationMs,
      pkg.retrieval.episodicScanned + pkg.retrieval.semanticScanned + pkg.retrieval.workingScanned,
      pkg.retrieval.episodicSelected + pkg.retrieval.semanticSelected + pkg.retrieval.workingSelected,
      'success'
    );
    return pkg;
  } catch (error) {
    recordRetrieval(performance.now() - retrievalStart, 0, 0, 0, 'failure');
    throw error;
  }
}

async function retrieveMemoryPackageInner(context: AgentContext, options: RetrievalOptions, retrievalStart: number): Promise<MemoryRetrievalPackage> {
  const agentId = context.agentId;
  const topKEpisodic = options.topKEpisodic ?? DEFAULT_TOP_K_EPISODIC;
  const topKSemantic = options.topKSemantic ?? DEFAULT_TOP_K_SEMANTIC;
  const topKWorking = options.topKWorking ?? DEFAULT_TOP_K_WORKING;

  const query = buildRetrievalQuery(context, options.now);

  // One list() call per provider — never re-queried below.
  const [rawEpisodic, rawSemantic, rawWorking] = await Promise.all([
    getEpisodicMemoryProvider().list(agentId),
    getSemanticMemoryProvider().list(agentId),
    getWorkingMemoryProvider().list(agentId),
  ]);

  const episodicScanned = rawEpisodic.length;
  const semanticScanned = rawSemantic.length;
  const workingScanned = rawWorking.length;

  const episodicOwned = rawEpisodic.filter((r) => r.agentId === agentId);
  const semanticOwned = rawSemantic.filter((f) => f.agentId === agentId);

  const rankStart = performance.now();

  const episodicIndex = buildTagIndex(episodicOwned);
  const episodicCandidates = filterCandidatesByTags(episodicOwned, episodicIndex, query.tags);
  const scoredEpisodic: ScoredEpisodicRecord[] = episodicCandidates.map((record) => {
    const scoreBreakdown = scoreEpisodicRecord(record, query);
    return { ...record, score: scoreBreakdown.total, scoreBreakdown };
  });
  const rankedEpisodic = rankEpisodicRecords(scoredEpisodic);
  const selectedEpisodic = selectTopK(rankedEpisodic, topKEpisodic);

  const semanticIndex = buildTagIndex(semanticOwned);
  const semanticCandidates = filterCandidatesByTags(semanticOwned, semanticIndex, query.tags);
  const scoredSemantic: ScoredSemanticFact[] = semanticCandidates.map((fact) => {
    const scoreBreakdown = scoreSemanticFact(fact, query);
    return { ...fact, score: scoreBreakdown.total, scoreBreakdown };
  });
  const rankedSemantic = rankSemanticFacts(scoredSemantic);
  const selectedSemantic = selectTopK(rankedSemantic, topKSemantic);

  // Working memory: providers already drop expired entries in list(); "active" here means
  // most-recently-set first, capped at topKWorking.
  const workingOwned = rawWorking.filter((w) => w.agentId === agentId);
  const rankedWorking = [...workingOwned].sort((a, b) => b.setAt - a.setAt);
  const selectedWorking = selectTopK(rankedWorking, topKWorking);

  const rankingDurationMs = performance.now() - rankStart;

  const retrievalHash = computeRetrievalHash({
    query,
    episodic: selectedEpisodic,
    semantic: selectedSemantic,
    working: selectedWorking,
    rankingVersion: RETRIEVAL_RANKING_VERSION,
  });

  const retrieval: RetrievalMetadata = {
    retrievalDurationMs: performance.now() - retrievalStart,
    rankingDurationMs,
    episodicScanned,
    semanticScanned,
    workingScanned,
    episodicSelected: selectedEpisodic.length,
    semanticSelected: selectedSemantic.length,
    workingSelected: selectedWorking.length,
    rankingVersion: RETRIEVAL_RANKING_VERSION,
    retrievalHash,
  };

  const validation = validateRetrieval({
    episodic: selectedEpisodic,
    semantic: selectedSemantic,
    working: selectedWorking,
    metadata: retrieval,
    schemaVersion: MEMORY_PACKAGE_SCHEMA_VERSION,
  });
  const status = validation.errors.length === 0 ? ('valid' as const) : ('invalid' as const);

  const memoryRetrievalPackage: MemoryRetrievalPackage = {
    meta: {
      version: MEMORY_PACKAGE_SCHEMA_VERSION,
      agentId,
      timestamp: Date.now(),
      packageId: randomUUID(),
      packageHash: retrievalHash,
    },
    query,
    episodic: selectedEpisodic,
    semantic: selectedSemantic,
    working: selectedWorking,
    retrieval,
    validation,
    status,
  };

  return deepFreeze(memoryRetrievalPackage);
}
