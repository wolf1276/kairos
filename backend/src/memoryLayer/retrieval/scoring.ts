// Relevance Scoring Engine — deterministic, weighted, explainable. No randomness, no ML: every
// component of every score is a pure function of the record and the RetrievalQuery.
import type { EpisodicRecord, SemanticFact, MemoryQuality } from '../types.js';
import type { RelevanceScoreBreakdown, RetrievalQuery } from './types.js';

/** Weights sum to 1.0 so `total` stays in [0, 1] — documented here as the single source of
 *  truth for the algorithm (see docs/architecture/MEMORY_ENGINE.md "Relevance Scoring"). */
export const SCORE_WEIGHTS = {
  regimeMatch: 0.25,
  protocolMatch: 0.15,
  assetMatch: 0.15,
  objectiveMatch: 0.15,
  riskProfileMatch: 0.1,
  recency: 0.1,
  confidence: 0.05,
  quality: 0.05,
} as const;

const sumWeights = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
if (Math.abs(sumWeights - 1) > 1e-9) {
  throw new Error(`Relevance score weights must sum to 1.0, got ${sumWeights}`);
}

/** Recency half-life — a memory exactly this old scores 0.5 on the recency component. Fixed and
 *  documented so recency is reproducible, never wall-clock-relative in an unexplainable way. */
const RECENCY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/** Exported so Phase 3 (Intelligence) can average quality using the exact same numeric scale
 *  as relevance scoring, instead of re-deriving its own mapping. */
export const QUALITY_SCORE: Record<MemoryQuality, number> = { high: 1, medium: 0.6, low: 0.3 };

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** A corrupted provider or malformed persisted record can hand back a `tags` value that isn't
 *  an array (missing/null/wrong type) — degrade to "no tags" rather than throwing, so one bad
 *  record can't fail the whole retrieval for an agent (see tagIndex.ts's safeTags). */
function safeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.filter((t): t is string => typeof t === 'string');
}

/** count of query values present in record tags / query.length — 0 when the query side is
 *  empty (nothing to match against, so it can't contribute relevance). */
function tagOverlapRatio(recordTags: unknown, queryValues: readonly string[]): number {
  if (queryValues.length === 0) return 0;
  const tagSet = new Set(safeTags(recordTags).map((t) => t.trim().toLowerCase()));
  const hits = queryValues.filter((v) => tagSet.has(v)).length;
  return hits / queryValues.length;
}

function singleTagMatch(recordTags: unknown, value: string): number {
  if (!value) return 0;
  const tagSet = new Set(safeTags(recordTags).map((t) => t.trim().toLowerCase()));
  return tagSet.has(value) ? 1 : 0;
}

function recencyScore(timestamp: number, now: number): number {
  const ageMs = now - timestamp;
  if (!Number.isFinite(ageMs)) return 0;
  if (ageMs <= 0) return 1;
  return clamp01(Math.pow(0.5, ageMs / RECENCY_HALF_LIFE_MS));
}

function assemble(components: Omit<RelevanceScoreBreakdown, 'total'>): RelevanceScoreBreakdown {
  const total =
    components.regimeMatch * SCORE_WEIGHTS.regimeMatch +
    components.protocolMatch * SCORE_WEIGHTS.protocolMatch +
    components.assetMatch * SCORE_WEIGHTS.assetMatch +
    components.objectiveMatch * SCORE_WEIGHTS.objectiveMatch +
    components.riskProfileMatch * SCORE_WEIGHTS.riskProfileMatch +
    components.recency * SCORE_WEIGHTS.recency +
    components.confidence * SCORE_WEIGHTS.confidence +
    components.quality * SCORE_WEIGHTS.quality;
  return { ...components, total: clamp01(total) };
}

export function scoreEpisodicRecord(record: EpisodicRecord, query: RetrievalQuery): RelevanceScoreBreakdown {
  return assemble({
    regimeMatch: singleTagMatch(record.tags, query.regime),
    protocolMatch: tagOverlapRatio(record.tags, query.protocols),
    assetMatch: tagOverlapRatio(record.tags, query.assets),
    objectiveMatch: singleTagMatch(record.tags, query.objective),
    riskProfileMatch: singleTagMatch(record.tags, query.riskProfile),
    recency: recencyScore(record.timestamp, query.now),
    confidence: clamp01(record.confidence),
    quality: QUALITY_SCORE[record.quality] ?? 0,
  });
}

export function scoreSemanticFact(fact: SemanticFact, query: RetrievalQuery): RelevanceScoreBreakdown {
  return assemble({
    regimeMatch: singleTagMatch(fact.tags, query.regime),
    protocolMatch: tagOverlapRatio(fact.tags, query.protocols),
    assetMatch: tagOverlapRatio(fact.tags, query.assets),
    objectiveMatch: singleTagMatch(fact.tags, query.objective),
    riskProfileMatch: singleTagMatch(fact.tags, query.riskProfile),
    recency: recencyScore(fact.updatedAt, query.now),
    confidence: clamp01(fact.confidence),
    // Semantic facts carry no MemoryQuality field — permanence stands in for quality: a fact
    // is either known (1) or it isn't in the candidate set at all, so this component is neutral.
    quality: 1,
  });
}
