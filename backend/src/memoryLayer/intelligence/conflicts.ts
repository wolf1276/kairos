// Conflict Analysis Engine — for every detected pattern, surfaces the episodes that disagree
// with it rather than hiding them. Pure function over already-computed DetectedPattern objects;
// no additional traversal of the episodic list (supporting/conflicting ids were already split
// out during tag aggregation / streak detection).
import type { DetectedPattern, ConflictAnalysis } from './types.js';
import type { ScoredEpisodicRecord } from '../retrieval/types.js';

function averageConfidence(ids: readonly string[], index: Map<string, ScoredEpisodicRecord>): number {
  if (ids.length === 0) return 0;
  let sum = 0;
  for (const id of ids) {
    const episode = index.get(id);
    sum += episode && Number.isFinite(episode.confidence) ? episode.confidence : 0;
  }
  return sum / ids.length;
}

export function analyzeConflicts(
  patterns: readonly DetectedPattern[],
  episodic: readonly ScoredEpisodicRecord[],
  byId?: Map<string, ScoredEpisodicRecord>
): ConflictAnalysis[] {
  const index = byId ?? new Map(episodic.map((e) => [e.id, e] as const));
  return patterns.map((pattern) => {
    const total = pattern.supportingEpisodeIds.length + pattern.conflictingEpisodeIds.length;
    const evidenceStrength = total === 0 ? 0 : Math.abs(pattern.supportingEpisodeIds.length - pattern.conflictingEpisodeIds.length) / total;
    return {
      patternId: pattern.id,
      supportingEpisodeIds: pattern.supportingEpisodeIds,
      conflictingEpisodeIds: pattern.conflictingEpisodeIds,
      supportingConfidence: averageConfidence(pattern.supportingEpisodeIds, index),
      conflictingConfidence: averageConfidence(pattern.conflictingEpisodeIds, index),
      evidenceStrength,
    };
  });
}
