// Direct unit tests for Phase 3's validateIntelligence — inject NaN/Infinity/malformed/duplicate
// data and confirm every case fails closed.
import { describe, it, expect } from 'vitest';
import { validateIntelligence } from '../memoryLayer/intelligence/validation.js';
import type { ExperienceStatistics, DetectedPattern, ConflictAnalysis, Evidence } from '../memoryLayer/intelligence/types.js';
import type { ScoredEpisodicRecord } from '../memoryLayer/retrieval/types.js';

function baseStats(overrides: Partial<ExperienceStatistics> = {}): ExperienceStatistics {
  return {
    totalEpisodes: 1,
    profitableEpisodes: 1,
    losingEpisodes: 0,
    neutralEpisodes: 0,
    pendingEpisodes: 0,
    winRate: 1,
    lossRate: 0,
    averageReturn: 10,
    medianReturn: 10,
    averageHoldingDurationSeconds: 60,
    averageConfidence: 0.8,
    averageQuality: 1,
    averageAllocation: null,
    protocolUsageFrequency: [],
    assetUsageFrequency: [],
    marketRegimeFrequency: [],
    maxGain: 10,
    maxDrawdown: 10,
    ...overrides,
  };
}

function episode(id: string): ScoredEpisodicRecord {
  return {
    id,
    agentId: 'a',
    timestamp: 1,
    contextRef: 'c',
    decisionRef: null,
    executionRef: null,
    outcome: 'win',
    pnl: 1,
    holdingTimeSeconds: 1,
    confidence: 0.5,
    quality: 'high',
    tags: [],
    score: 0.5,
    scoreBreakdown: {
      regimeMatch: 0,
      protocolMatch: 0,
      assetMatch: 0,
      objectiveMatch: 0,
      riskProfileMatch: 0,
      recency: 0,
      confidence: 0.5,
      quality: 1,
      total: 0.5,
    },
  };
}

function basePattern(overrides: Partial<DetectedPattern> = {}): DetectedPattern {
  return {
    id: 'protocol-success:blend',
    type: 'protocol-success',
    key: 'blend',
    supportingEpisodeIds: ['ep-1'],
    conflictingEpisodeIds: [],
    supportCount: 1,
    totalCount: 1,
    winRate: 1,
    averageConfidence: 0.5,
    ...overrides,
  };
}

describe('validateIntelligence — fail closed on malformed input', () => {
  it('accepts a well-formed package', () => {
    const result = validateIntelligence({ episodic: [episode('ep-1')], statistics: baseStats(), patterns: [basePattern()], conflicts: [], evidence: [] });
    expect(result.ok).toBe(true);
  });

  it('rejects NaN in a statistics field', () => {
    const result = validateIntelligence({ episodic: [], statistics: baseStats({ averageReturn: NaN }), patterns: [], conflicts: [], evidence: [] });
    expect(result.ok).toBe(false);
  });

  it('rejects Infinity in a statistics field', () => {
    const result = validateIntelligence({ episodic: [], statistics: baseStats({ maxGain: Infinity }), patterns: [], conflicts: [], evidence: [] });
    expect(result.ok).toBe(false);
  });

  it('rejects a winRate outside [0, 1]', () => {
    const result = validateIntelligence({ episodic: [], statistics: baseStats({ winRate: 1.5 }), patterns: [], conflicts: [], evidence: [] });
    expect(result.ok).toBe(false);
  });

  it('rejects impossible outcome counts that do not sum to totalEpisodes', () => {
    const result = validateIntelligence({
      episodic: [],
      statistics: baseStats({ totalEpisodes: 10, profitableEpisodes: 1, losingEpisodes: 1, neutralEpisodes: 0, pendingEpisodes: 0 }),
      patterns: [],
      conflicts: [],
      evidence: [],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Impossible statistics'))).toBe(true);
  });

  it('rejects duplicate pattern ids', () => {
    const result = validateIntelligence({
      episodic: [episode('ep-1')],
      statistics: baseStats(),
      patterns: [basePattern(), basePattern()],
      conflicts: [],
      evidence: [],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Duplicate pattern'))).toBe(true);
  });

  it('rejects duplicate evidence ids', () => {
    const ev: Evidence = { id: 'evidence:1', type: 'protocol-success', supportingEpisodeIds: ['ep-1'], confidence: 0.5, quality: 1, statisticalSupport: 1, affectedAssets: [], affectedProtocols: [], marketRegimes: [] };
    const result = validateIntelligence({ episodic: [episode('ep-1')], statistics: baseStats(), patterns: [], conflicts: [], evidence: [ev, ev] });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Duplicate evidence'))).toBe(true);
  });

  it('rejects a pattern referencing an episode id that does not exist', () => {
    const result = validateIntelligence({
      episodic: [],
      statistics: baseStats({ totalEpisodes: 0, profitableEpisodes: 0 }),
      patterns: [basePattern({ supportingEpisodeIds: ['ghost'] })],
      conflicts: [],
      evidence: [],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown episode id'))).toBe(true);
  });

  it('rejects a conflict referencing a nonexistent pattern id', () => {
    const conflict: ConflictAnalysis = { patternId: 'does-not-exist', supportingEpisodeIds: [], conflictingEpisodeIds: [], supportingConfidence: 0.5, conflictingConfidence: 0.5, evidenceStrength: 0.5 };
    const result = validateIntelligence({ episodic: [], statistics: baseStats({ totalEpisodes: 0, profitableEpisodes: 0 }), patterns: [], conflicts: [conflict], evidence: [] });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown pattern id'))).toBe(true);
  });

  it('rejects a pattern with supportCount exceeding totalCount', () => {
    const result = validateIntelligence({
      episodic: [episode('ep-1')],
      statistics: baseStats(),
      patterns: [basePattern({ supportCount: 5, totalCount: 1, supportingEpisodeIds: ['ep-1'] })],
      conflicts: [],
      evidence: [],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects evidence with an out-of-range confidence/quality/statisticalSupport', () => {
    const ev: Evidence = { id: 'e-1', type: 'protocol-success', supportingEpisodeIds: [], confidence: 2, quality: -1, statisticalSupport: 1.2, affectedAssets: [], affectedProtocols: [], marketRegimes: [] };
    const result = validateIntelligence({ episodic: [], statistics: baseStats({ totalEpisodes: 0, profitableEpisodes: 0 }), patterns: [], conflicts: [], evidence: [ev] });
    expect(result.ok).toBe(false);
  });
});
