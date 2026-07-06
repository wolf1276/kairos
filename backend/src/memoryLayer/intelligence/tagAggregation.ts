// Single-pass tag aggregation shared by statistics.ts and patterns.ts — the one full traversal
// of the retrieved episodic set that both engines are built from, so pattern detection never
// re-scans the episode list the statistics engine already walked.
import type { ScoredEpisodicRecord } from '../retrieval/types.js';

export interface TagAggregate {
  tag: string;
  winIds: string[];
  lossIds: string[];
  neutralIds: string[];
  pendingIds: string[];
  confidenceSum: number;
  confidenceCount: number;
  count: number;
}

function safeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0);
}

export { safeTags };

export function aggregateByTag(episodic: readonly ScoredEpisodicRecord[]): Map<string, TagAggregate> {
  const byTag = new Map<string, TagAggregate>();
  for (const episode of episodic) {
    for (const tag of safeTags(episode.tags)) {
      let agg = byTag.get(tag);
      if (!agg) {
      agg = { tag, winIds: [], lossIds: [], neutralIds: [], pendingIds: [], confidenceSum: 0, confidenceCount: 0, count: 0 };
        byTag.set(tag, agg);
      }
      agg.count += 1;
      const confidence = Number.isFinite(episode.confidence) ? episode.confidence : null;
      if (confidence !== null) {
        agg.confidenceSum += confidence;
        agg.confidenceCount += 1;
      }
      if (episode.outcome === 'win') agg.winIds.push(episode.id);
      else if (episode.outcome === 'loss') agg.lossIds.push(episode.id);
      else if (episode.outcome === 'neutral') agg.neutralIds.push(episode.id);
      else agg.pendingIds.push(episode.id);
    }
  }
  return byTag;
}

export function averageConfidenceOf(agg: TagAggregate): number {
  return agg.confidenceCount === 0 ? 0 : agg.confidenceSum / agg.confidenceCount;
}
