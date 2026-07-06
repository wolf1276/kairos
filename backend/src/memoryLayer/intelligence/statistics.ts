// Experience Statistics Engine — every field is a direct aggregate over the retrieved episodic
// set, computed in one pass (plus one sort for the median, which is unavoidable). No inference:
// fields with no eligible data are `null`, never fabricated as 0.
import type { ScoredEpisodicRecord } from '../retrieval/types.js';
import type { RetrievalQuery } from '../retrieval/types.js';
import { QUALITY_SCORE } from '../retrieval/scoring.js';
import type { TagAggregate } from './tagAggregation.js';
import type { ExperienceStatistics, FrequencyEntry } from './types.js';
import { REGIME_TAGS } from './regimeTags.js';

function median(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function frequencyFrom(keys: readonly string[], byTag: Map<string, TagAggregate>, totalEpisodes: number): FrequencyEntry[] {
  return keys.map((key) => {
    const count = byTag.get(key)?.count ?? 0;
    return { key, count, ratio: totalEpisodes === 0 ? 0 : count / totalEpisodes };
  });
}

export function computeStatistics(episodic: readonly ScoredEpisodicRecord[], query: RetrievalQuery, byTag: Map<string, TagAggregate>): ExperienceStatistics {
  const totalEpisodes = episodic.length;
  let profitable = 0;
  let losing = 0;
  let neutral = 0;
  let pending = 0;
  let confidenceSum = 0;
  let confidenceCount = 0;
  let qualitySum = 0;
  let qualityCount = 0;
  let holdingSum = 0;
  let holdingCount = 0;
  const returns: number[] = [];

  for (const episode of episodic) {
    if (episode.outcome === 'win') profitable += 1;
    else if (episode.outcome === 'loss') losing += 1;
    else if (episode.outcome === 'neutral') neutral += 1;
    else pending += 1;

    if (Number.isFinite(episode.confidence)) {
      confidenceSum += episode.confidence;
      confidenceCount += 1;
    }
    if (episode.quality in QUALITY_SCORE) {
      qualitySum += QUALITY_SCORE[episode.quality];
      qualityCount += 1;
    }

    if (episode.holdingTimeSeconds !== null && Number.isFinite(episode.holdingTimeSeconds)) {
      holdingSum += episode.holdingTimeSeconds;
      holdingCount += 1;
    }
    if (episode.pnl !== null && Number.isFinite(episode.pnl)) returns.push(episode.pnl);
  }

  const sortedReturns = [...returns].sort((a, b) => a - b);
  const returnSum = returns.reduce((a, b) => a + b, 0);

  return {
    totalEpisodes,
    profitableEpisodes: profitable,
    losingEpisodes: losing,
    neutralEpisodes: neutral,
    pendingEpisodes: pending,
    winRate: totalEpisodes === 0 ? null : profitable / totalEpisodes,
    lossRate: totalEpisodes === 0 ? null : losing / totalEpisodes,
    averageReturn: returns.length === 0 ? null : returnSum / returns.length,
    medianReturn: median(sortedReturns),
    averageHoldingDurationSeconds: holdingCount === 0 ? null : holdingSum / holdingCount,
    averageConfidence: confidenceCount === 0 ? null : confidenceSum / confidenceCount,
    averageQuality: qualityCount === 0 ? null : qualitySum / qualityCount,
    averageAllocation: null,
    protocolUsageFrequency: frequencyFrom(query.protocols, byTag, totalEpisodes),
    assetUsageFrequency: frequencyFrom(query.assets, byTag, totalEpisodes),
    marketRegimeFrequency: frequencyFrom(REGIME_TAGS, byTag, totalEpisodes),
    maxGain: sortedReturns.length === 0 ? null : Math.max(0, sortedReturns[sortedReturns.length - 1]),
    maxDrawdown: sortedReturns.length === 0 ? null : Math.min(0, sortedReturns[0]),
  };
}
