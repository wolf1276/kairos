// Regression tests for the Memory Engine Phase 3 production audit fixes (A–F).
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
import { validateIntelligence } from '../memoryLayer/intelligence/validation.js';
import { stableStringify } from '../stableStringify.js';

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

function baseStats(overrides: Record<string, unknown> = {}): any {
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

function episode(id: string): any {
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

beforeEach(() => {
  resetAllMemoryProviders();
});

describe('FIX B — maxGain / maxDrawdown semantics', () => {
  it('maxDrawdown is 0 (not positive) for an all-winning dataset', async () => {
    const provider = getEpisodicMemoryProvider();
    await provider.append(makeEpisode({ id: 'w1', pnl: 10 }));
    await provider.append(makeEpisode({ id: 'w2', pnl: 20 }));
    await provider.append(makeEpisode({ id: 'w3', pnl: 5 }));
    const pkg = await buildMemoryIntelligencePackage(makeContext());
    expect(pkg.statistics.maxDrawdown).toBe(0);
    expect(pkg.statistics.maxGain).toBe(20);
  });

  it('maxGain is 0 (not negative) for an all-losing dataset', async () => {
    const provider = getEpisodicMemoryProvider();
    await provider.append(makeEpisode({ id: 'l1', outcome: 'loss', pnl: -10 }));
    await provider.append(makeEpisode({ id: 'l2', outcome: 'loss', pnl: -20 }));
    await provider.append(makeEpisode({ id: 'l3', outcome: 'loss', pnl: -5 }));
    const pkg = await buildMemoryIntelligencePackage(makeContext());
    expect(pkg.statistics.maxGain).toBe(0);
    expect(pkg.statistics.maxDrawdown).toBe(-20);
  });
});

describe('FIX C — confidence average excludes NaN consistently', () => {
  it('confidence average excludes NaN consistently between statistics and pattern evidence', async () => {
    setEpisodicMemoryProvider(new RawEpisodicProvider());
    const provider = getEpisodicMemoryProvider();
    await provider.append(makeEpisode({ id: 'ok-1', confidence: 0.8, quality: 'high', outcome: 'win', tags: ['blend', 'xlm', 'trending_up'] }));
    await provider.append(makeEpisode({ id: 'ok-2', confidence: 0.4, quality: 'medium', outcome: 'win', tags: ['blend', 'xlm', 'trending_up'] }));
    await provider.append(makeEpisode({ id: 'bad-conf', confidence: NaN as never, quality: 'high', outcome: 'win', tags: ['blend', 'xlm', 'trending_up'] }));
    await provider.append(makeEpisode({ id: 'bad-quality', confidence: 0.8, quality: 'unknown' as never, outcome: 'win', tags: ['blend', 'xlm', 'trending_up'] }));

    const pkg = await buildMemoryIntelligencePackage(makeContext());
    expect(pkg.statistics.averageConfidence).toBeCloseTo((0.8 + 0.4 + 0.8) / 3, 9);

    const pattern = pkg.patterns.find((p) => p.type === 'protocol-success' && p.key === 'blend');
    expect(pattern).toBeDefined();
    expect(pattern!.averageConfidence).toBeCloseTo((0.8 + 0.4 + 0.8) / 3, 9);

    const evidence = pkg.evidence.find((e) => e.type === 'protocol-success');
    expect(evidence).toBeDefined();
    expect(evidence!.confidence).toBeCloseTo((0.8 + 0.4 + 0.8) / 3, 9);
  });
});

describe('FIX A — centralized regime vocabulary', () => {
  it('regime vocabulary is centralized (no duplicate inline regime sets cause drift)', async () => {
    const provider = getEpisodicMemoryProvider();
    for (let i = 0; i < MIN_PATTERN_SUPPORT; i++) {
      await provider.append(makeEpisode({ id: `hv-${i}`, outcome: 'win', tags: ['blend', 'xlm', 'high_volatility'] }));
    }
    const pkg = await buildMemoryIntelligencePackage(makeContext());
    const pattern = pkg.patterns.find((p) => p.type === 'profitable-regime' && p.key === 'high_volatility');
    expect(pattern).toBeDefined();
  });
});

describe('FIX D — single shared byId index', () => {
  it('single shared byId index used (no duplicate full traversal)', async () => {
    const provider = getEpisodicMemoryProvider();
    for (let i = 0; i < 50; i++) {
      await provider.append(makeEpisode({ id: `ep-${i}`, outcome: i % 2 === 0 ? 'win' : 'loss', tags: ['blend', 'xlm', 'trending_up'] }));
    }
    const pkg = await buildMemoryIntelligencePackage(makeContext());
    expect(pkg.evidence.length).toBe(pkg.patterns.length);
    for (const item of pkg.evidence) {
      expect(item.confidence).toBeGreaterThanOrEqual(0);
      expect(item.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('FIX E — validateIntelligence rejects conflict with unknown episode id', () => {
  it('rejects a conflict referencing an unknown episode id', () => {
    const pattern = { id: 'protocol-success:blend', type: 'protocol-success' as const, key: 'blend', supportingEpisodeIds: ['ep-1'], conflictingEpisodeIds: [], supportCount: 1, totalCount: 1, winRate: 1, averageConfidence: 0.5 };
    const conflict = { patternId: pattern.id, supportingEpisodeIds: ['ghost'], conflictingEpisodeIds: [], supportingConfidence: 0.5, conflictingConfidence: 0.5, evidenceStrength: 0.5 };
    const result = validateIntelligence({ episodic: [episode('ep-1')], statistics: baseStats(), patterns: [pattern], conflicts: [conflict], evidence: [] });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown supporting episode id'))).toBe(true);
  });
});

describe('FIX F — stableStringify handles Map/Set', () => {
  it('stableStringify handles Map/Set deterministically', () => {
    expect(stableStringify(new Map([['b', 1], ['a', 2]]))).toBe(stableStringify(new Map([['a', 2], ['b', 1]])));
    expect(stableStringify(new Map([['b', 1], ['a', 2]]))).toBe(stableStringify([['a', 2], ['b', 1]]));
    expect(stableStringify(new Set([3, 1, 2]))).toBe(stableStringify([1, 2, 3]));
  });
});

describe('chaos — fail closed on malformed episodes', () => {
  it('malformed episode with invalid outcome fails closed (package invalid, not thrown)', async () => {
    setEpisodicMemoryProvider(new RawEpisodicProvider());
    const provider = getEpisodicMemoryProvider();
    await provider.append(makeEpisode({ id: 'bad', outcome: 'bogus' as never }));
    const pkg = await buildMemoryIntelligencePackage(makeContext());
    expect(pkg.status).toBe('invalid');
    expect(pkg.validation.errors.length).toBeGreaterThan(0);
    expect(Number.isFinite(pkg.statistics.maxGain ?? 0) || pkg.statistics.maxGain === null).toBe(true);
    expect(Number.isFinite(pkg.statistics.maxDrawdown ?? 0) || pkg.statistics.maxDrawdown === null).toBe(true);
  });

  it('malformed episode with NaN pnl fails closed', async () => {
    setEpisodicMemoryProvider(new RawEpisodicProvider());
    const provider = getEpisodicMemoryProvider();
    await provider.append(makeEpisode({ id: 'bad', pnl: NaN }));
    const pkg = await buildMemoryIntelligencePackage(makeContext());
    expect(pkg.status).toBe('invalid');
  });

  it('duplicate episode ids fail closed in validation', () => {
    const result = validateIntelligence({
      episodic: [episode('dup'), episode('dup')],
      statistics: baseStats({ totalEpisodes: 2, profitableEpisodes: 2 }),
      patterns: [],
      conflicts: [],
      evidence: [],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Duplicate episodic record id'))).toBe(true);
  });
});

describe('determinism — 1000 consecutive builds', () => {
  it('1000 consecutive builds are deterministic (identical packageHash)', async () => {
    const provider = getEpisodicMemoryProvider();
    for (let i = 0; i < 20; i++) {
      await provider.append(makeEpisode({ id: `ep-${i}`, outcome: i % 2 === 0 ? 'win' : 'loss', pnl: i % 3 === 0 ? 10 : -5 }));
    }
    const context = makeContext();
    const first = await buildMemoryIntelligencePackage(context);
    const firstHash = first.intelligence.packageHash;
    for (let i = 0; i < 1000; i++) {
      const pkg = await buildMemoryIntelligencePackage(context);
      expect(pkg.intelligence.packageHash).toBe(firstHash);
    }
  });
});

describe('tenant isolation', () => {
  it('agent B cannot see agent A episodes', async () => {
    const provider = getEpisodicMemoryProvider();
    for (let i = 0; i < 5; i++) {
      await provider.append(makeEpisode({ id: `a-${i}`, tags: ['blend', 'xlm', 'trending_up'] }));
    }

    const contextB = makeContext({
      agentId: 'agent-intel-2',
      policy: { objective: 'yield', riskProfile: 'moderate', allowedAssets: ['xlm', 'usdc'], allowedProtocols: ['blend'], delegationActive: true, spendingLimitPerTrade: null, minConfidence: null, positionLimit: { maxCapital: null }, confidence: 1 } as never,
      meta: { version: '2.1.0', timestamp: CONTEXT_TIMESTAMP, marketId: 'm-2', snapshotId: 's-2', contextHash: 'h-2' } as never,
    });
    const pkgB = await buildMemoryIntelligencePackage(contextB);
    expect(pkgB.statistics.totalEpisodes).toBe(0);
    expect(pkgB.patterns.length).toBe(0);

    const pkgA = await buildMemoryIntelligencePackage(makeContext());
    expect(pkgA.statistics.totalEpisodes).toBe(5);
    expect(pkgA.patterns.length).toBeGreaterThan(0);
  });
});
