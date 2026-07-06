// Observability tests: context build/cache/validation/quality/confidence metrics get recorded,
// slow builds get flagged, and none of it changes AgentContext output/behavior.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { MarketContext } from '../decisionTypes.js';

// metrics.js is imported dynamically (after vi.resetModules()) in every test below rather than
// statically here — a static import would bind to the module instance loaded at file-parse
// time, which is a *different* instance than the one contextBuilder.js/featureEngine.js see
// after vi.resetModules() resets the registry, so metrics recorded there would silently go to
// an instance nothing in the test ever reads back from.

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

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'kairos-context-metrics-test-'));
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

describe('observability — context build metrics', () => {
  it('records a successful build: count, success outcome, and a non-negative duration', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');
      const { getContextMetricsSnapshot } = await import('../agentContext/metrics.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GMET1', role: 'strategic', capital: '1000' });

      const ctx = await buildAgentContext(agent.id);
      expect(ctx).not.toBeNull();

      const snapshot = getContextMetricsSnapshot();
      expect(snapshot.contextBuild.count).toBe(1);
      expect(snapshot.contextBuild.successCount).toBe(1);
      expect(snapshot.contextBuild.failureCount).toBe(0);
      expect(snapshot.contextBuild.avgDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  it('records a null outcome when the oracle has no candle history yet (not a failure)', async () => {
    vi.doMock('../decisionEngine.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../decisionEngine.js')>();
      return { ...actual, buildMarketContext: vi.fn().mockResolvedValue(null) };
    });
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { buildAgentContext } = await import('../agentContext/contextBuilder.js');
    const { getContextMetricsSnapshot } = await import('../agentContext/metrics.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GMET2', role: 'strategic' });

    const ctx = await buildAgentContext(agent.id);
    expect(ctx).toBeNull();

    const snapshot = getContextMetricsSnapshot();
    expect(snapshot.contextBuild.nullCount).toBe(1);
    expect(snapshot.contextBuild.failureCount).toBe(0);
  });

  it('records a failure outcome when the build throws, and still re-throws (no behavior change)', async () => {
    vi.doMock('../decisionEngine.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../decisionEngine.js')>();
      return { ...actual, buildMarketContext: vi.fn().mockRejectedValue(new Error('boom')) };
    });
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { buildAgentContext } = await import('../agentContext/contextBuilder.js');
    const { getContextMetricsSnapshot } = await import('../agentContext/metrics.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GMET3', role: 'strategic' });

    await expect(buildAgentContext(agent.id)).rejects.toThrow('boom');

    const snapshot = getContextMetricsSnapshot();
    expect(snapshot.contextBuild.failureCount).toBe(1);
  });

  it('logs a slow-build warning when a build crosses the threshold', async () => {
    const { recordContextBuild, getContextMetricsSnapshot } = await import('../agentContext/metrics.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    recordContextBuild(999, 'success');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('slow context build'));
    const snapshot = getContextMetricsSnapshot();
    expect(snapshot.contextBuild.slowBuildCount).toBe(1);
    warnSpy.mockRestore();
  });

  it('does not log a slow-build warning for a fast build', async () => {
    const { recordContextBuild } = await import('../agentContext/metrics.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    recordContextBuild(5, 'success');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('observability — cache hit/miss and provider latency metrics', () => {
  it('records a miss on first build and a hit on a cached rebuild', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');
      const { getContextMetricsSnapshot } = await import('../agentContext/metrics.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GMET4', role: 'strategic' });

      await buildAgentContext(agent.id);
      let snapshot = getContextMetricsSnapshot();
      expect(snapshot.cache.misses).toBe(1);
      expect(snapshot.cache.hits).toBe(0);

      await buildAgentContext(agent.id);
      snapshot = getContextMetricsSnapshot();
      expect(snapshot.cache.hits).toBe(1);
      expect(snapshot.cache.hitRate).toBeCloseTo(0.5, 5);
    });
  });

  it('records provider latency for both cache reads and writes', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');
      const { getContextMetricsSnapshot } = await import('../agentContext/metrics.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GMET5', role: 'strategic' });

      await buildAgentContext(agent.id);
      const snapshot = getContextMetricsSnapshot();
      // One get (miss) + one set on the first build.
      expect(snapshot.providerLatency.count).toBe(2);
      expect(snapshot.providerLatency.avgMs).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('observability — validation/quality/confidence metrics', () => {
  it('records a validation-ok outcome for a clean context', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');
      const { getContextMetricsSnapshot } = await import('../agentContext/metrics.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GMET6', role: 'strategic', capital: '1000' });

      await buildAgentContext(agent.id);
      const snapshot = getContextMetricsSnapshot();
      expect(snapshot.validation.okCount).toBe(1);
      expect(snapshot.validation.failCount).toBe(0);
    });
  });

  it('records validation errors with counts when a context is invalid', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');
      const { getContextMetricsSnapshot } = await import('../agentContext/metrics.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GMET7', role: null });

      await buildAgentContext(agent.id);
      const snapshot = getContextMetricsSnapshot();
      expect(snapshot.validation.failCount).toBe(1);
      expect(snapshot.validation.topErrors.some((e) => e.error.includes('No policy/role assigned'))).toBe(true);
    });
  });

  it('records quality score/level and per-domain confidence', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');
      const { getContextMetricsSnapshot } = await import('../agentContext/metrics.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GMET8', role: 'strategic', capital: '1000' });

      const ctx = await buildAgentContext(agent.id);
      const snapshot = getContextMetricsSnapshot();
      expect(snapshot.quality.avgScore).toBeCloseTo(ctx!.quality.score, 10);
      expect(snapshot.quality.levelCounts[ctx!.quality.level]).toBe(1);
      expect(snapshot.confidence.market).toBeCloseTo(ctx!.market.confidence, 10);
      expect(snapshot.confidence.capital).toBeCloseTo(ctx!.capital.confidence, 10);
    });
  });
});

describe('observability — no behavior change', () => {
  it('metrics recording does not alter the returned AgentContext content', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');
      const { getContextMetricsSnapshot } = await import('../agentContext/metrics.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GMET9', role: 'strategic', capital: '1000' });

      const a = await buildAgentContext(agent.id, { forceRefresh: true });
      const b = await buildAgentContext(agent.id, { forceRefresh: true });
      expect(a!.meta.contextHash).toBe(b!.meta.contextHash);
      expect(a!.status).toBe(b!.status);
    });
  });
});
