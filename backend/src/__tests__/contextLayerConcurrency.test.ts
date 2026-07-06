// Concurrency and replay validation tests for the Context Layer. No production code changes
// here — these tests only exercise existing behavior: thread-safety of concurrent context
// builds/cache access, TTL expiry, invalidation, and that a context can be replayed/rebuilt
// later and still hash identically to the original (deterministic output).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { MarketContext } from '../decisionTypes.js';
import { InMemoryFeatureCacheProvider } from '../agentContext/cache/inMemoryFeatureCacheProvider.js';
import type { CachedFeatureResult } from '../agentContext/cache/types.js';

let tmpDir: string;

function makeCandles(count: number) {
  const candles = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    candles.push({ time: now - (count - 1 - i) * 60_000, open: 100, high: 100.2, low: 99.8, close: 100, volume: 1000 });
  }
  return candles;
}

function makeMarketContext(overrides: Partial<MarketContext> = {}): MarketContext {
  const candles = overrides.candles ?? makeCandles(60);
  return {
    pair: 'XLM/USDC',
    price: candles[candles.length - 1].close,
    change24h: 1.5,
    volume24h: 50_000,
    indicators: { rsi: 55, macd: { MACD: 0.1, signal: 0.05, histogram: 0.05 }, ema20: 105, ema50: 100, sma20: 103, atr: 1.2 },
    regime: { regime: 'trending_up', volatilityPct: 2, momentum: 3, trendStrength: 30, liquidity: 10_000 },
    candles,
    ...overrides,
  };
}

function makeCachedFeatureResult(overrides: Partial<CachedFeatureResult> = {}): CachedFeatureResult {
  return {
    featureSet: {
      pair: 'XLM/USDC',
      price: 100,
      trend: { ema20: 100, ema50: 100, sma20: 100, trendStrength: 10, direction: 'flat' },
      momentum: { rsi: 50, macdHistogram: 0, roc: 0 },
      volatility: { atr: 1, volatilityPct: 1, band: 'low' },
      volume: { window24h: 1000, changePct: 0 },
      liquidity: { recentVolume: 1000 },
      wallet: { publicKey: 'GPUB', smartWalletAddress: null, delegationActive: false, mode: 'paper', capital: null },
      portfolio: { xlmPct: 50, usdcPct: 50, idleUsd: 100, totalValue: 1000, targetXlmPct: 50, targetUsdcPct: 50, driftPct: 0 },
      protocolExposure: [],
      risk: { realizedPnl: 0, unrealizedPnl: 0, drawdownPct: null, volatilityPct: 1 },
      computedAt: Date.now(),
    },
    regime: { base: 'trending_up', label: 'trending_up', breakout: false, volatilityBand: 'low', trendStrength: 10, momentum: 0, liquidity: 1000 } as any,
    marketId: 'XLM/USDC@1',
    oracleTimestamp: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'kairos-context-concurrency-test-'));
  process.env.AGENTS_DB_PATH = path.join(tmpDir, 'agents.db');
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

async function withMockedMarket(fn: () => Promise<void>) {
  vi.doMock('../decisionEngine.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../decisionEngine.js')>();
    return { ...actual, buildMarketContext: vi.fn().mockResolvedValue(makeMarketContext()) };
  });
  await fn();
}

// ── Concurrent context builds ───────────────────────────────────────────────────────────────
describe('concurrency — concurrent context builds', () => {
  it('N concurrent builds for the same agent all succeed and hash identically (thread-safe, deterministic)', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GCONC1', role: 'strategic', capital: '1000' });

      const results = await Promise.all(Array.from({ length: 20 }, () => buildAgentContext(agent.id)));
      expect(results.every((r) => r !== null)).toBe(true);
      const hashes = new Set(results.map((r) => r!.meta.contextHash));
      expect(hashes.size).toBe(1);
      // Every build still gets its own identity even though the underlying data is identical.
      const snapshotIds = new Set(results.map((r) => r!.meta.snapshotId));
      expect(snapshotIds.size).toBe(results.length);
    });
  });

  it('concurrent builds across different agents never cross-contaminate each other\'s data', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agents = [
        insertAgent(db, { owner: 'GCONC2A', role: 'strategic', capital: '100' }),
        insertAgent(db, { owner: 'GCONC2B', role: 'yield', capital: '200' }),
        insertAgent(db, { owner: 'GCONC2C', role: 'balancer', capital: '300' }),
      ];

      const results = await Promise.all(agents.map((a) => buildAgentContext(a.id)));
      results.forEach((ctx, i) => {
        expect(ctx!.agentId).toBe(agents[i].id);
        expect(ctx!.owner).toBe(agents[i].owner);
        expect(ctx!.capital.totalManagedCapital).toBe(parseFloat(agents[i].capital!));
      });
    });
  });

  it('concurrent forceRefresh builds do not corrupt the feature cache for subsequent reads', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GCONC3', role: 'strategic', capital: '1000' });

      await Promise.all(Array.from({ length: 10 }, () => buildAgentContext(agent.id, { forceRefresh: true })));
      const after = await buildAgentContext(agent.id);
      expect(after).not.toBeNull();
      expect(after!.status).toBe('valid');
    });
  });
});

// ── Concurrent cache access ──────────────────────────────────────────────────────────────────
describe('concurrency — concurrent cache access', () => {
  it('interleaved get/set/invalidate calls across many keys never throw and leave a consistent store', async () => {
    const provider = new InMemoryFeatureCacheProvider();
    try {
      const ops: Promise<unknown>[] = [];
      for (let i = 0; i < 50; i++) {
        const key = `agent${i % 5}:XLM/USDC`;
        ops.push(provider.set(key, makeCachedFeatureResult({ marketId: `m${i}` })));
        ops.push(provider.get(key));
        if (i % 7 === 0) ops.push(provider.invalidate(key));
      }
      await expect(Promise.all(ops)).resolves.toBeDefined();
      const size = await provider.size();
      expect(size).toBeGreaterThanOrEqual(0);
      expect(size).toBeLessThanOrEqual(5);
    } finally {
      provider.dispose();
    }
  });

  it('concurrent writes to the same key resolve to exactly one final value (last write wins, no torn state)', async () => {
    const provider = new InMemoryFeatureCacheProvider();
    try {
      const key = 'agent1:XLM/USDC';
      await Promise.all(
        Array.from({ length: 20 }, (_, i) => provider.set(key, makeCachedFeatureResult({ marketId: `m${i}` })))
      );
      const value = await provider.get(key);
      expect(value).not.toBeNull();
      expect(value!.marketId).toMatch(/^m\d+$/);
      expect(await provider.size()).toBe(1);
    } finally {
      provider.dispose();
    }
  });
});

// ── TTL expiry ───────────────────────────────────────────────────────────────────────────────
describe('concurrency — TTL expiry', () => {
  it('an entry is served while within TTL and evicted once expired', async () => {
    const provider = new InMemoryFeatureCacheProvider();
    try {
      await provider.set('k', makeCachedFeatureResult(), 20);
      expect(await provider.get('k')).not.toBeNull();
      await new Promise((r) => setTimeout(r, 40));
      expect(await provider.get('k')).toBeNull();
      expect(await provider.size()).toBe(0);
    } finally {
      provider.dispose();
    }
  });

  it('the periodic sweep reclaims expired entries even without a get() on that key', async () => {
    vi.useFakeTimers();
    const provider = new InMemoryFeatureCacheProvider();
    try {
      await provider.set('swept', makeCachedFeatureResult(), 10);
      expect(await provider.size()).toBe(1);
      // Advance past both the entry's TTL and the sweep interval without ever calling get().
      await vi.advanceTimersByTimeAsync(30_001);
      expect(await provider.size()).toBe(0);
    } finally {
      provider.dispose();
      vi.useRealTimers();
    }
  });

  it('featureCacheTtlForInterval produces a TTL that actually governs how long a build result survives', async () => {
    const { featureCacheTtlForInterval } = await import('../agentContext/cache/index.js');
    const provider = new InMemoryFeatureCacheProvider();
    try {
      const ttlMs = featureCacheTtlForInterval(1); // tiny interval -> clamps to the configured minimum
      await provider.set('k', makeCachedFeatureResult(), ttlMs);
      expect(await provider.get('k')).not.toBeNull();
      await new Promise((r) => setTimeout(r, ttlMs + 20));
      expect(await provider.get('k')).toBeNull();
    } finally {
      provider.dispose();
    }
  });
});

// ── Cache invalidation ───────────────────────────────────────────────────────────────────────
describe('concurrency — cache invalidation', () => {
  it('invalidate forces the next build to recompute rather than reusing a stale cached result', async () => {
    await withMockedMarket(async () => {
      const marketContextMock = vi.fn().mockResolvedValue(makeMarketContext());
      vi.doMock('../decisionEngine.js', async (importOriginal) => {
        const actual = await importOriginal<typeof import('../decisionEngine.js')>();
        return { ...actual, buildMarketContext: marketContextMock };
      });
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildFeatureResult } = await import('../agentContext/featureEngine.js');
      const { invalidateFeatureSet, clearFeatureCache } = await import('../agentContext/featureCache.js');
      clearFeatureCache();

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GINV1' });

      await buildFeatureResult(agent, 'XLM/USDC', 300);
      await buildFeatureResult(agent, 'XLM/USDC', 300);
      expect(marketContextMock).toHaveBeenCalledTimes(1);

      invalidateFeatureSet(agent.id, 'XLM/USDC');
      await buildFeatureResult(agent, 'XLM/USDC', 300);
      expect(marketContextMock).toHaveBeenCalledTimes(2);
    });
  });

  it('invalidating one agent\'s cache entry does not affect another agent\'s cached entry', async () => {
    const provider = new InMemoryFeatureCacheProvider();
    try {
      await provider.set('agentA:XLM/USDC', makeCachedFeatureResult({ marketId: 'a' }));
      await provider.set('agentB:XLM/USDC', makeCachedFeatureResult({ marketId: 'b' }));
      await provider.invalidate('agentA:XLM/USDC');
      expect(await provider.get('agentA:XLM/USDC')).toBeNull();
      expect((await provider.get('agentB:XLM/USDC'))!.marketId).toBe('b');
    } finally {
      provider.dispose();
    }
  });

  it('clear() empties the entire store regardless of individual TTLs', async () => {
    const provider = new InMemoryFeatureCacheProvider();
    try {
      await provider.set('a', makeCachedFeatureResult(), 60_000);
      await provider.set('b', makeCachedFeatureResult(), 60_000);
      await provider.clear();
      expect(await provider.size()).toBe(0);
    } finally {
      provider.dispose();
    }
  });
});

// ── Replay / deterministic hashing / repeated identical contexts ───────────────────────────────
describe('replay validation', () => {
  it('replaying a build (forceRefresh, fresh cache, later wall-clock time) reproduces the same contextHash', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GREPLAY1', role: 'balancer', capital: '500' });

      const original = await buildAgentContext(agent.id);
      await new Promise((r) => setTimeout(r, 10));
      const replayed = await buildAgentContext(agent.id, { forceRefresh: true });

      expect(replayed!.meta.contextHash).toBe(original!.meta.contextHash);
      expect(replayed!.meta.snapshotId).not.toBe(original!.meta.snapshotId);
      expect(replayed!.status).toBe(original!.status);
      expect(replayed!.quality.score).toBeCloseTo(original!.quality.score, 10);
      expect(replayed!.validation.errors).toEqual(original!.validation.errors);
    });
  });

  it('two independently-built contexts for the same underlying data are deep-equal apart from identity fields', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GREPLAY2', role: 'yield', capital: '750' });

      const a = await buildAgentContext(agent.id, { forceRefresh: true });
      const b = await buildAgentContext(agent.id, { forceRefresh: true });

      const strip = (ctx: typeof a) => {
        const { meta, builtAt, features, ...rest } = ctx!;
        const { snapshotId, contextHash, timestamp, ...restMeta } = meta;
        const { computedAt, ...restFeatures } = features;
        return { ...rest, meta: restMeta, features: restFeatures };
      };
      expect(strip(a)).toEqual(strip(b));
    });
  });

  it('repeated builds against an unchanged cache (no forceRefresh) return the same content every time', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GREPLAY3', role: 'strategic', capital: '250' });

      const first = await buildAgentContext(agent.id);
      const hashes = new Set<string>();
      for (let i = 0; i < 5; i++) {
        const ctx = await buildAgentContext(agent.id);
        hashes.add(ctx!.meta.contextHash);
      }
      hashes.add(first!.meta.contextHash);
      expect(hashes.size).toBe(1);
    });
  });

  it('hash is order-independent: rebuilding after the process constructs domain views afresh still matches', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext, refreshAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GREPLAY4', role: 'balancer', capital: '900' });

      const first = await buildAgentContext(agent.id);
      const second = await refreshAgentContext(agent.id);
      const third = await refreshAgentContext(agent.id);

      expect(new Set([first!.meta.contextHash, second!.meta.contextHash, third!.meta.contextHash]).size).toBe(1);
    });
  });
});
