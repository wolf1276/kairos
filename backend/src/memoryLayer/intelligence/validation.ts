// Intelligence validation — fails closed, same posture as Phase 1/2. Checks everything specific
// to Phase 3 (statistics sanity, pattern/evidence duplication, conflict/pattern cross-references,
// impossible aggregate values) on top of the episodic/semantic/working shape already validated
// by Phase 1's validateMemoryPackage.
import type { MemoryValidationResult } from '../types.js';
import { episodicRecordErrors } from '../validation.js';
import type { ScoredEpisodicRecord } from '../retrieval/types.js';
import type { ExperienceStatistics, DetectedPattern, ConflictAnalysis, Evidence } from './types.js';

function isFiniteOrNull(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isValidRatioOrNull(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1);
}

function isValidRatio(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

export interface IntelligenceValidationInput {
  episodic: ScoredEpisodicRecord[];
  statistics: ExperienceStatistics;
  patterns: DetectedPattern[];
  conflicts: ConflictAnalysis[];
  evidence: Evidence[];
}

export function validateIntelligence(input: IntelligenceValidationInput): MemoryValidationResult {
  const errors: string[] = [];
  const episodeIds = new Set(input.episodic.map((e) => e.id));

  // Belt-and-suspenders: Phase 1/2 already validate episodic record shape and duplicate ids
  // before this function ever sees them, but validateIntelligence is also callable directly
  // (see tests), and buildInner's exposed `validation.errors` should never be empty while
  // `status` is 'invalid' for a reason the caller can't see here — so re-check directly rather
  // than relying on the caller to have merged Phase 1/2's separate validation result.
  const seenIds = new Set<string>();
  for (const record of input.episodic) {
    if (record.id && seenIds.has(record.id)) {
      errors.push(`Duplicate episodic record id: ${record.id}`);
      continue;
    }
    if (record.id) seenIds.add(record.id);
    errors.push(...episodicRecordErrors(record));
  }

  const s = input.statistics;
  if (
    !Number.isFinite(s.totalEpisodes) ||
    !Number.isFinite(s.profitableEpisodes) ||
    !Number.isFinite(s.losingEpisodes) ||
    !Number.isFinite(s.neutralEpisodes) ||
    !Number.isFinite(s.pendingEpisodes)
  ) {
    errors.push('Malformed statistics: non-finite episode counts');
  } else if (s.profitableEpisodes + s.losingEpisodes + s.neutralEpisodes + s.pendingEpisodes !== s.totalEpisodes) {
    errors.push('Impossible statistics: outcome counts do not sum to totalEpisodes');
  }
  if (!isValidRatioOrNull(s.winRate)) errors.push(`Malformed statistics: invalid winRate ${s.winRate}`);
  if (!isValidRatioOrNull(s.lossRate)) errors.push(`Malformed statistics: invalid lossRate ${s.lossRate}`);
  if (!isFiniteOrNull(s.averageReturn)) errors.push('Malformed statistics: non-finite averageReturn');
  if (!isFiniteOrNull(s.medianReturn)) errors.push('Malformed statistics: non-finite medianReturn');
  if (!isFiniteOrNull(s.averageHoldingDurationSeconds)) errors.push('Malformed statistics: non-finite averageHoldingDurationSeconds');
  if (!isValidRatioOrNull(s.averageConfidence)) errors.push('Malformed statistics: invalid averageConfidence');
  if (!isValidRatioOrNull(s.averageQuality)) errors.push('Malformed statistics: invalid averageQuality');
  if (!isFiniteOrNull(s.maxGain)) errors.push('Malformed statistics: non-finite maxGain');
  if (!isFiniteOrNull(s.maxDrawdown)) errors.push('Malformed statistics: non-finite maxDrawdown');
  for (const entry of [...s.protocolUsageFrequency, ...s.assetUsageFrequency, ...s.marketRegimeFrequency]) {
    if (!Number.isFinite(entry.count) || entry.count < 0) errors.push(`Malformed statistics: invalid frequency count for "${entry.key}"`);
    if (!isValidRatio(entry.ratio)) errors.push(`Malformed statistics: invalid frequency ratio for "${entry.key}"`);
  }

  const patternIds = new Set<string>();
  for (const pattern of input.patterns) {
    if (!pattern.id) {
      errors.push('Pattern missing id');
      continue;
    }
    if (patternIds.has(pattern.id)) {
      errors.push(`Duplicate pattern id: ${pattern.id}`);
      continue;
    }
    patternIds.add(pattern.id);
    if (!isValidRatio(pattern.winRate)) errors.push(`Pattern ${pattern.id} has invalid winRate: ${pattern.winRate}`);
    if (!isValidRatio(pattern.averageConfidence)) errors.push(`Pattern ${pattern.id} has invalid averageConfidence`);
    if (pattern.supportCount > pattern.totalCount) errors.push(`Pattern ${pattern.id} has supportCount exceeding totalCount`);
    for (const id of pattern.supportingEpisodeIds) {
      if (!episodeIds.has(id)) errors.push(`Pattern ${pattern.id} references unknown episode id: ${id}`);
    }
    for (const id of pattern.conflictingEpisodeIds) {
      if (!episodeIds.has(id)) errors.push(`Pattern ${pattern.id} references unknown conflicting episode id: ${id}`);
    }
  }

  for (const conflict of input.conflicts) {
    if (!patternIds.has(conflict.patternId)) errors.push(`Conflict references unknown pattern id: ${conflict.patternId}`);
    if (!isValidRatio(conflict.evidenceStrength)) errors.push(`Conflict for ${conflict.patternId} has invalid evidenceStrength`);
    if (!isValidRatio(conflict.supportingConfidence)) errors.push(`Conflict for ${conflict.patternId} has invalid supportingConfidence`);
    if (!isValidRatio(conflict.conflictingConfidence)) errors.push(`Conflict for ${conflict.patternId} has invalid conflictingConfidence`);
    for (const id of conflict.supportingEpisodeIds) {
      if (!episodeIds.has(id)) errors.push(`Conflict for ${conflict.patternId} references unknown supporting episode id: ${id}`);
    }
    for (const id of conflict.conflictingEpisodeIds) {
      if (!episodeIds.has(id)) errors.push(`Conflict for ${conflict.patternId} references unknown conflicting episode id: ${id}`);
    }
  }

  const evidenceIds = new Set<string>();
  for (const item of input.evidence) {
    if (!item.id) {
      errors.push('Evidence missing id');
      continue;
    }
    if (evidenceIds.has(item.id)) {
      errors.push(`Duplicate evidence id: ${item.id}`);
      continue;
    }
    evidenceIds.add(item.id);
    if (!isValidRatio(item.confidence)) errors.push(`Evidence ${item.id} has invalid confidence`);
    if (!isValidRatio(item.quality)) errors.push(`Evidence ${item.id} has invalid quality`);
    if (!isValidRatio(item.statisticalSupport)) errors.push(`Evidence ${item.id} has invalid statisticalSupport`);
    for (const id of item.supportingEpisodeIds) {
      if (!episodeIds.has(id)) errors.push(`Evidence ${item.id} references unknown episode id: ${id}`);
    }
  }

  return { ok: errors.length === 0, errors };
}
