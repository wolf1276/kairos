// Pattern Detection Engine — deterministic, rule-based (fixed thresholds, no learning) reporting
// of statistically supported recurring patterns. Reuses the tag aggregation statistics.ts already
// built (no re-scan of the episodic list for regime/protocol/asset patterns); streak detection
// needs one additional timestamp-sorted pass, which is the only extra traversal this engine adds.
import type { ScoredEpisodicRecord } from '../retrieval/types.js';
import type { RetrievalQuery } from '../retrieval/types.js';
import type { TagAggregate } from './tagAggregation.js';
import { averageConfidenceOf } from './tagAggregation.js';
import { REGIME_TAG_SET } from './regimeTags.js';
import type { DetectedPattern, PatternType } from './types.js';
import { MIN_PATTERN_SUPPORT, MIN_STREAK_LENGTH, PROFITABLE_WIN_RATE_THRESHOLD, LOSING_WIN_RATE_THRESHOLD } from './types.js';

function winRateOf(agg: TagAggregate): number {
  return agg.count === 0 ? 0 : agg.winIds.length / agg.count;
}

function tagWinLossPatterns(
  keys: readonly string[],
  byTag: Map<string, TagAggregate>,
  successType: PatternType,
  failureType: PatternType,
  minSupport: number
): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];
  for (const key of keys) {
    const agg = byTag.get(key);
    if (!agg || agg.count < minSupport) continue;
    const winRate = winRateOf(agg);
    const averageConfidence = averageConfidenceOf(agg);
    if (winRate >= PROFITABLE_WIN_RATE_THRESHOLD) {
      patterns.push({
        id: `${successType}:${key}`,
        type: successType,
        key,
        supportingEpisodeIds: agg.winIds,
        conflictingEpisodeIds: agg.lossIds,
        supportCount: agg.winIds.length,
        totalCount: agg.count,
        winRate,
        averageConfidence,
      });
    } else if (winRate <= LOSING_WIN_RATE_THRESHOLD) {
      patterns.push({
        id: `${failureType}:${key}`,
        type: failureType,
        key,
        supportingEpisodeIds: agg.lossIds,
        conflictingEpisodeIds: agg.winIds,
        supportCount: agg.lossIds.length,
        totalCount: agg.count,
        winRate,
        averageConfidence,
      });
    }
  }
  return patterns;
}

/** One additional pass over the episodic list, sorted by timestamp — unavoidable for
 *  chronological streak detection, and kept to exactly one sort (not one per streak type). */
function detectStreakPatterns(episodic: readonly ScoredEpisodicRecord[], minStreakLength: number): DetectedPattern[] {
  const sorted = [...episodic].sort((a, b) => a.timestamp - b.timestamp);
  const patterns: DetectedPattern[] = [];

  const lossStreakIds = new Set<string>();
  let runIds: string[] = [];
  for (const episode of sorted) {
    if (episode.outcome === 'loss') {
      runIds.push(episode.id);
    } else {
      if (runIds.length >= minStreakLength) for (const id of runIds) lossStreakIds.add(id);
      runIds = [];
    }
  }
  if (runIds.length >= minStreakLength) for (const id of runIds) lossStreakIds.add(id);

  if (lossStreakIds.size > 0) {
    const ids = [...lossStreakIds];
    const confidences = sorted.filter((e) => lossStreakIds.has(e.id)).map((e) => (Number.isFinite(e.confidence) ? e.confidence : 0));
    const averageConfidence = confidences.length === 0 ? 0 : confidences.reduce((a, b) => a + b, 0) / confidences.length;
    patterns.push({
      id: 'repeated-loss-streak:all',
      type: 'repeated-loss-streak',
      key: 'loss-streak',
      supportingEpisodeIds: ids,
      conflictingEpisodeIds: [],
      supportCount: ids.length,
      totalCount: sorted.length,
      winRate: 0,
      averageConfidence,
    });
  }

  const recoveryIds: string[] = [];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1].outcome === 'loss' && sorted[i].outcome === 'win') recoveryIds.push(sorted[i].id);
  }
  if (recoveryIds.length >= minStreakLength) {
    const confidences = sorted.filter((e) => recoveryIds.includes(e.id)).map((e) => (Number.isFinite(e.confidence) ? e.confidence : 0));
    const averageConfidence = confidences.length === 0 ? 0 : confidences.reduce((a, b) => a + b, 0) / confidences.length;
    patterns.push({
      id: 'repeated-recovery:all',
      type: 'repeated-recovery',
      key: 'recovery',
      supportingEpisodeIds: recoveryIds,
      conflictingEpisodeIds: [],
      supportCount: recoveryIds.length,
      totalCount: sorted.length,
      winRate: 1,
      averageConfidence,
    });
  }

  return patterns;
}

export function detectPatterns(
  episodic: readonly ScoredEpisodicRecord[],
  query: RetrievalQuery,
  byTag: Map<string, TagAggregate>,
  minPatternSupport: number = MIN_PATTERN_SUPPORT,
  minStreakLength: number = MIN_STREAK_LENGTH
): DetectedPattern[] {
  const regimeKeys = [query.regime, ...regimeTagsPresent(byTag)].filter((k, i, arr) => k && arr.indexOf(k) === i);
  const patterns: DetectedPattern[] = [
    ...tagWinLossPatterns(regimeKeys, byTag, 'profitable-regime', 'losing-regime', minPatternSupport),
    ...tagWinLossPatterns(query.protocols, byTag, 'protocol-success', 'protocol-failure', minPatternSupport),
    ...tagWinLossPatterns(query.assets, byTag, 'asset-success', 'asset-failure', minPatternSupport),
    ...detectStreakPatterns(episodic, minStreakLength),
  ];
  return patterns;
}

/** Regime patterns should cover every regime tag actually observed in the episodic set, not just
 *  the current AgentContext's regime — otherwise "losing market regimes" plural could never
 *  surface a regime the agent isn't in right now. statistics.ts's KNOWN_REGIME_LABELS already
 *  enumerates the closed regime vocabulary for the frequency table; pattern detection reuses
 *  whatever regime-shaped tags are already keys in byTag instead of importing that list again. */
function regimeTagsPresent(byTag: Map<string, TagAggregate>): string[] {
  return [...byTag.keys()].filter((k) => REGIME_TAG_SET.has(k));
}
