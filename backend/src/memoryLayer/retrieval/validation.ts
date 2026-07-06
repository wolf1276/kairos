// Retrieval validation — fails closed, same posture as Phase 1's validateMemoryPackage. Checks
// the things that are specific to retrieval (score sanity, duplicate ids surviving selection,
// malformed metadata) on top of reusing Phase 1's record-shape validation.
import type { MemoryValidationResult } from '../types.js';
import { validateMemoryPackage } from '../validation.js';
import type { ScoredEpisodicRecord, ScoredSemanticFact, RetrievalMetadata } from './types.js';
import type { WorkingMemoryEntry } from '../types.js';

function isValidScore(score: unknown): score is number {
  return typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 1;
}

/** Phase 1's validateMemoryPackage doesn't check `tags` shape at all — scoring.ts/tagIndex.ts
 *  degrade a non-array `tags` to "no tags" defensively so one bad record can't crash retrieval,
 *  but that degradation must still surface as a validation error so the package is marked
 *  invalid rather than silently under-scoring. */
function hasValidTags(tags: unknown): boolean {
  return Array.isArray(tags) && tags.every((t) => typeof t === 'string');
}

export interface RetrievalValidationInput {
  episodic: ScoredEpisodicRecord[];
  semantic: ScoredSemanticFact[];
  working: WorkingMemoryEntry[];
  metadata: RetrievalMetadata;
  schemaVersion?: string;
}

export function validateRetrieval(input: RetrievalValidationInput): MemoryValidationResult {
  const base = validateMemoryPackage({
    episodic: input.episodic,
    semantic: input.semantic,
    working: input.working,
    schemaVersion: input.schemaVersion,
  });
  const errors = [...base.errors];

  const episodicIds = new Set<string>();
  for (const record of input.episodic) {
    if (episodicIds.has(record.id)) errors.push(`Duplicate selected episodic record id: ${record.id}`);
    episodicIds.add(record.id);
    if (!isValidScore(record.score)) errors.push(`Episodic record ${record.id} has invalid score: ${record.score}`);
    if (!isValidScore(record.scoreBreakdown?.total)) errors.push(`Episodic record ${record.id} has invalid score total`);
    if (!hasValidTags(record.tags)) errors.push(`Episodic record ${record.id} has malformed tags`);
  }

  const semanticIds = new Set<string>();
  for (const fact of input.semantic) {
    if (semanticIds.has(fact.id)) errors.push(`Duplicate selected semantic fact id: ${fact.id}`);
    semanticIds.add(fact.id);
    if (!isValidScore(fact.score)) errors.push(`Semantic fact ${fact.id} has invalid score: ${fact.score}`);
    if (!isValidScore(fact.scoreBreakdown?.total)) errors.push(`Semantic fact ${fact.id} has invalid score total`);
    if (!hasValidTags(fact.tags)) errors.push(`Semantic fact ${fact.id} has malformed tags`);
  }

  const meta = input.metadata;
  if (
    !Number.isFinite(meta.retrievalDurationMs) ||
    !Number.isFinite(meta.rankingDurationMs) ||
    !Number.isFinite(meta.episodicScanned) ||
    !Number.isFinite(meta.semanticScanned) ||
    !Number.isFinite(meta.workingScanned) ||
    !Number.isFinite(meta.episodicSelected) ||
    !Number.isFinite(meta.semanticSelected) ||
    !Number.isFinite(meta.workingSelected) ||
    !meta.rankingVersion ||
    !meta.retrievalHash
  ) {
    errors.push('Malformed retrieval metadata');
  }

  return { ok: errors.length === 0, errors };
}
