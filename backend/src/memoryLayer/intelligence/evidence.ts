// Evidence Builder — turns each DetectedPattern into structured, non-natural-language evidence.
// No additional traversal of the full episodic list: only the (already small) set of supporting
// episode ids per pattern is inspected.
import type { ScoredEpisodicRecord } from '../retrieval/types.js';
import type { RetrievalQuery } from '../retrieval/types.js';
import { QUALITY_SCORE } from '../retrieval/scoring.js';
import { safeTags } from './tagAggregation.js';
import { REGIME_TAG_SET } from './regimeTags.js';
import type { DetectedPattern, Evidence } from './types.js';

export function buildEvidence(patterns: readonly DetectedPattern[], episodic: readonly ScoredEpisodicRecord[], query: RetrievalQuery, byId?: Map<string, ScoredEpisodicRecord>): Evidence[] {
  const index = byId ?? new Map(episodic.map((e) => [e.id, e] as const));
  const assetSet = new Set(query.assets);
  const protocolSet = new Set(query.protocols);

  return patterns.map((pattern) => {
    const supporting = pattern.supportingEpisodeIds.map((id) => index.get(id)).filter((e): e is ScoredEpisodicRecord => e !== undefined);

    const affectedAssets = new Set<string>();
    const affectedProtocols = new Set<string>();
    const marketRegimes = new Set<string>();
    let qualitySum = 0;
    for (const episode of supporting) {
      qualitySum += QUALITY_SCORE[episode.quality] ?? 0;
      for (const tag of safeTags(episode.tags)) {
        if (assetSet.has(tag)) affectedAssets.add(tag);
        if (protocolSet.has(tag)) affectedProtocols.add(tag);
        if (REGIME_TAG_SET.has(tag)) marketRegimes.add(tag);
      }
    }
    if (pattern.type === 'asset-success' || pattern.type === 'asset-failure') affectedAssets.add(pattern.key);
    if (pattern.type === 'protocol-success' || pattern.type === 'protocol-failure') affectedProtocols.add(pattern.key);
    if (pattern.type === 'profitable-regime' || pattern.type === 'losing-regime') marketRegimes.add(pattern.key);

    return {
      id: `evidence:${pattern.id}`,
      type: pattern.type,
      supportingEpisodeIds: pattern.supportingEpisodeIds,
      confidence: pattern.averageConfidence,
      quality: supporting.length === 0 ? 0 : qualitySum / supporting.length,
      statisticalSupport: pattern.totalCount === 0 ? 0 : pattern.supportCount / pattern.totalCount,
      affectedAssets: [...affectedAssets].sort(),
      affectedProtocols: [...affectedProtocols].sort(),
      marketRegimes: [...marketRegimes].sort(),
    };
  });
}
