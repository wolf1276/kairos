// Unit + integration tests for Memory Engine Phase 3: statistics, pattern detection, conflict
// analysis, evidence building, validation, package assembly, determinism, and concurrency.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildMemoryIntelligencePackage,
  resetAllMemoryProviders,
  getEpisodicMemoryProvider,
  setEpisodicMemoryProvider,
  MIN_PATTERN_SUPPORT,
} from '../memoryLayer/index.js';
import type { EpisodicRecord, EpisodicMemoryProvider } from '../memoryLayer/index.js';
import type { AgentContext } from '../agentContext/types.js';

/** Phase 4 hardened `InMemoryEpisodicProvider.append()` now validates at write time, so it can
 *  no longer be used to plant a malformed record for read-time fail-closed tests. This double
 *  skips that gate — standing in for, e.g., an external/legacy store whose data this process
 *  didn't write and can't have validated on the way in. */
class RawEpisodicProvider implements EpisodicMemoryProvider {
  private byAgent = new Map<string, EpisodicRecord[]>();
  async append(record: EpisodicRecord): Promise<void> {
    const existing = this.byAgent.get(record.agentId) ?? [];
    existing.push(record);
    this.byAgent.set(record.agentId, existing);
  }
  async list(agentId: string): Promise<EpisodicRecord[]> {
    return [...(this.byAgent.get(agentId) ?? [])];
  }
  async get(agentId: string, id: string): Promise<EpisodicRecord | null> {
    return (this.byAgent.get(agentId) ?? []).find((r) => r.id === id) ?? null;
  }
  async size(agentId: string): Promise<number> {
    return (this.byAgent.get(agentId) ?? []).length;
  }
  dispose(): void {
    this.byAgent.clear();
  }
}

const AGENT_ID = 'agent-intel-1';
const CONTEXT_TIMESTAMP = 1_700_000_000_000;

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  const base = {
    agentId: AGENT_ID,
    owner: 'owner-1',
    role: 'yield',
    pair: 'XLM/USDC',
    regime: { base: 'trending', label: 'trending_up', breakout: false, volatilityBand: 'normal' },
    meta: { version: '2.1.0', timestamp: CONTEXT_TIMESTAMP, marketId: 'm-1', snapshotId: 's-1', contextHash: 'h-1' },
    policy: {
      objective: 'yield',
      riskProfile: 'moderate',
      allowedAssets: ['xlm', 'usdc'],
      allowedProtocols: ['blend'],
      delegationActive: true,
      spendingLimitPerTrade: null,
      minConfidence: null,
      positionLimit: { maxCapital: null },
      confidence: 1,
    },
  };
  return { ...base, ...overrides } as unknown as AgentContext;
}

function makeEpisode(overrides: Partial<EpisodicRecord> = {}): EpisodicRecord {
  return {
    id: 'ep-1',
    agentId: AGENT_ID,
    timestamp: CONTEXT_TIMESTAMP - 60_000,
    contextRef: 'snapshot-1',
    decisionRef: null,
    executionRef: null,
    outcome: 'win',
    pnl: 10,
    holdingTimeSeconds: 300,
    confidence: 0.8,
    quality: 'high',
    tags: ['xlm', 'yield', 'blend', 'trending_up'],
    ...overrides,
  };
}

beforeEach(() => {
  resetAllMemoryProviders();
});

describe('statistics', () => {
  it('computes counts/rates/returns directly from stored episodes, with null for absent data', async () => {
    const provider = getEpisodicMemoryProvider();
    await provider.append(makeEpisode({ id: 'w1', outcome: 'win', pnl: 10 }));
    await provider.append(makeEpisode({ id: 'w2', outcome: 'win', pnl: 20 }));
    await provider.append(makeEpisode({ id: 'l1', outcome: 'loss', pnl: -5 }));

    const pkg = await buildMemoryIntelligencePackage(makeContext());
    const s = pkg.statistics;
    expect(s.totalEpisodes).toBe(3);
    expect(s.profitableEpisodes).toBe(2);
    expect(s.losingEpisodes).toBe(1);
    expect(s.winRate).toBeCloseTo(2 / 3, 9);
    expect(s.lossRate).toBeCloseTo(1 / 3, 9);
    expect(s.averageReturn).toBeCloseTo((10 + 20 - 5) / 3, 9);
    expect(s.medianReturn).toBe(10);
    expect(s.maxGain).toBe(20);
    expect(s.maxDrawdown).toBe(-5);
    expect(s.averageAllocation).toBeNull();
  });

  it('returns null (not 0) for every rate/return field when there are no episodes', async () => {
    const pkg = await buildMemoryIntelligencePackage(makeContext());
    expect(pkg.statistics.totalEpisodes).toBe(0);
    expect(pkg.statistics.winRate).toBeNull();
    expect(pkg.statistics.averageReturn).toBeNull();
    expect(pkg.statistics.maxGain).toBeNull();
  });

  it('reports protocol/asset/regime usage frequency from query vocabulary', async () => {
    const provider = getEpisodicMemoryProvider();
    for (let i = 0; i < 3; i++) await provider.append(makeEpisode({ id: `ep-${i}` }));
    const pkg = await buildMemoryIntelligencePackage(makeContext());
    const blend = pkg.statistics.protocolUsageFrequency.find((f) => f.key === 'blend');
    expect(blend?.count).toBe(3);
    expect(blend?.ratio).toBeCloseTo(1, 9);
    const regime = pkg.statistics.marketRegimeFrequency.find((f) => f.key === 'trending_up');
    expect(regime?.count).toBe(3);
  });

  it('excludes episodes with non-finite confidence/unknown quality from their averages instead of diluting them', async () => {
    // Uses the raw (non-validating) provider double: Phase 4 hardening makes the real provider
    // reject these writes at append() time, so this simulates data from a store this process
    // didn't write (and therefore couldn't validate on the way in).
    setEpisodicMemoryProvider(new RawEpisodicProvider());
    const provider = getEpisodicMemoryProvider();
    await provider.append(makeEpisode({ id: 'ok-1', confidence: 0.8, quality: 'high' }));
    await provider.append(makeEpisode({ id: 'ok-2', confidence: 0.4, quality: 'medium' }));
    await provider.append(makeEpisode({ id: 'bad-conf', confidence: NaN }));
    await provider.append(makeEpisode({ id: 'bad-quality', quality: 'unknown' as never }));

    const pkg = await buildMemoryIntelligencePackage(makeContext());
    const s = pkg.statistics;
    expect(s.totalEpisodes).toBe(4);
    // Averages must be computed only over episodes with valid values, not diluted by treating
    // missing/invalid values as 0 across the full episode count.
    expect(s.averageConfidence).toBeCloseTo((0.8 + 0.4 + 0.8) / 3, 9);
    expect(s.averageQuality).toBeCloseTo((1 + 0.6 + 1) / 3, 9);
  });
});

describe('pattern detection', () => {
  it('detects a protocol-success pattern once support reaches MIN_PATTERN_SUPPORT with a high win rate', async () => {
    const provider = getEpisodicMemoryProvider();
    for (let i = 0; i < MIN_PATTERN_SUPPORT; i++) await provider.append(makeEpisode({ id: `w-${i}`, outcome: 'win' }));
    const pkg = await buildMemoryIntelligencePackage(makeContext());
    const pattern = pkg.patterns.find((p) => p.type === 'protocol-success' && p.key === 'blend');
    expect(pattern).toBeDefined();
    expect(pattern!.supportingEpisodeIds.length).toBe(MIN_PATTERN_SUPPORT);
    expect(pattern!.winRate).toBe(1);
  });

  it('detects a protocol-failure pattern with a low win rate', async () => {
    const provider = getEpisodicMemoryProvider();
    for (let i = 0; i < MIN_PATTERN_SUPPORT; i++) await provider.append(makeEpisode({ id: `l-${i}`, outcome: 'loss' }));
    const pkg = await buildMemoryIntelligencePackage(makeContext());
    const pattern = pkg.patterns.find((p) => p.type === 'protocol-failure' && p.key === 'blend');
    expect(pattern).toBeDefined();
    expect(pattern!.winRate).toBe(0);
  });

  it('does not report a pattern below MIN_PATTERN_SUPPORT — insufficient sample size', async () => {
    const provider = getEpisodicMemoryProvider();
    await provider.append(makeEpisode({ id: 'w-1', outcome: 'win' }));
    const pkg = await buildMemoryIntelligencePackage(makeContext());
    expect(pkg.patterns.find((p) => p.type === 'protocol-success')).toBeUndefined();
  });

  it('detects a repeated-loss-streak pattern for consecutive chronological losses', async () => {
    const provider = getEpisodicMemoryProvider();
    for (let i = 0; i < MIN_PATTERN_SUPPORT; i++) {
      await provider.append(makeEpisode({ id: `streak-${i}`, outcome: 'loss', timestamp: CONTEXT_TIMESTAMP - (MIN_PATTERN_SUPPORT - i) * 1000 }));
    }
    const pkg = await buildMemoryIntelligencePackage(makeContext());
    const streak = pkg.patterns.find((p) => p.type === 'repeated-loss-streak');
    expect(streak).toBeDefined();
    expect(streak!.supportingEpisodeIds.length).toBe(MIN_PATTERN_SUPPORT);
  });

  it('every pattern references only real, retrieved episode ids', async () => {
    const provider = getEpisodicMemoryProvider();
    for (let i = 0; i < 5; i++) await provider.append(makeEpisode({ id: `ep-${i}`, outcome: i % 2 === 0 ? 'win' : 'loss' }));
    const pkg = await buildMemoryIntelligencePackage(makeContext());
    const episodeIds = new Set(pkg.episodic.map((e) => e.id));
    for (const pattern of pkg.patterns) {
      for (const id of [...pattern.supportingEpisodeIds, ...pattern.conflictingEpisodeIds]) {
        expect(episodeIds.has(id)).toBe(true);
      }
    }
  });
});

describe('conflict analysis', () => {
  it('reports conflicting episodes rather than hiding them', async () => {
    const provider = getEpisodicMemoryProvider();
    for (let i = 0; i < 4; i++) await provider.append(makeEpisode({ id: `w-${i}`, outcome: 'win' }));
    await provider.append(makeEpisode({ id: 'l-0', outcome: 'loss' }));

    const pkg = await buildMemoryIntelligencePackage(makeContext());
    const pattern = pkg.patterns.find((p) => p.type === 'protocol-success' && p.key === 'blend');
    const conflict = pkg.conflicts.find((c) => c.patternId === pattern!.id);
    expect(conflict).toBeDefined();
    expect(conflict!.conflictingEpisodeIds).toContain('l-0');
    expect(conflict!.evidenceStrength).toBeGreaterThan(0);
    expect(conflict!.evidenceStrength).toBeLessThanOrEqual(1);
  });
});

describe('evidence builder', () => {
  it('produces structured, non-natural-language evidence tied to supporting episodes', async () => {
    const provider = getEpisodicMemoryProvider();
    for (let i = 0; i < MIN_PATTERN_SUPPORT; i++) await provider.append(makeEpisode({ id: `w-${i}`, outcome: 'win' }));
    const pkg = await buildMemoryIntelligencePackage(makeContext());
    expect(pkg.evidence.length).toBeGreaterThan(0);
    const item = pkg.evidence.find((e) => e.type === 'protocol-success');
    expect(item).toBeDefined();
    expect(item!.affectedProtocols).toContain('blend');
    expect(item!.statisticalSupport).toBeGreaterThan(0);
    expect(item!.statisticalSupport).toBeLessThanOrEqual(1);
  });
});

describe('package assembly', () => {
  it('is immutable', async () => {
    await getEpisodicMemoryProvider().append(makeEpisode());
    const pkg = await buildMemoryIntelligencePackage(makeContext());
    expect(() => {
      (pkg as unknown as { status: string }).status = 'invalid';
    }).toThrow();
    expect(() => {
      (pkg.patterns as unknown[]).push({});
    }).toThrow();
  });

  it('carries a retrievalSummary consistent with the underlying retrieval', async () => {
    await getEpisodicMemoryProvider().append(makeEpisode());
    const pkg = await buildMemoryIntelligencePackage(makeContext());
    expect(pkg.retrievalSummary.episodicSelected).toBe(pkg.episodic.length);
    expect(pkg.retrievalSummary.retrievalHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stamps intelligence metadata with all required durations and a package hash', async () => {
    await getEpisodicMemoryProvider().append(makeEpisode());
    const pkg = await buildMemoryIntelligencePackage(makeContext());
    const i = pkg.intelligence;
    expect(i.intelligenceVersion).toBeTruthy();
    expect(i.packageHash).toMatch(/^[0-9a-f]{64}$/);
    for (const field of [i.intelligenceDurationMs, i.statisticsDurationMs, i.patternDurationMs, i.conflictDurationMs, i.evidenceDurationMs, i.packageGenerationDurationMs]) {
      expect(field).toBeGreaterThanOrEqual(0);
    }
  });

  it('is valid end-to-end when retrieval and intelligence both succeed', async () => {
    await getEpisodicMemoryProvider().append(makeEpisode());
    const pkg = await buildMemoryIntelligencePackage(makeContext());
    expect(pkg.status).toBe('valid');
  });
});

describe('determinism', () => {
  it('produces identical statistics, patterns, evidence, and packageHash across repeated builds', async () => {
    const provider = getEpisodicMemoryProvider();
    for (let i = 0; i < 5; i++) await provider.append(makeEpisode({ id: `ep-${i}`, outcome: i % 2 === 0 ? 'win' : 'loss' }));
    const context = makeContext();

    const first = await buildMemoryIntelligencePackage(context);
    const second = await buildMemoryIntelligencePackage(context);

    expect(second.statistics).toEqual(first.statistics);
    expect(second.patterns).toEqual(first.patterns);
    expect(second.evidence).toEqual(first.evidence);
    expect(second.intelligence.packageHash).toBe(first.intelligence.packageHash);
  });

  it('runs 100 concurrent package builds with identical hashes and no race conditions', async () => {
    await getEpisodicMemoryProvider().append(makeEpisode());
    const context = makeContext();
    const results = await Promise.all(Array.from({ length: 100 }, () => buildMemoryIntelligencePackage(context)));
    const hashes = new Set(results.map((r) => r.intelligence.packageHash));
    expect(hashes.size).toBe(1);
  });
});
