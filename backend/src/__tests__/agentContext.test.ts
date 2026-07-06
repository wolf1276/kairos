// Agent Foundation Layer tests: feature generation, regime detection, AgentContext assembly,
// cache behavior, and error handling. Mocks decisionEngine.buildMarketContext (the oracle/LLM
// boundary) so these run deterministically with no network calls.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { MarketContext } from '../decisionTypes.js';

let tmpDir: string;

function makeCandles(count: number, opts: { trendUp?: boolean; breakoutUp?: boolean; volatile?: boolean } = {}) {
  const candles = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    if (opts.trendUp) price += 0.3;
    if (opts.volatile) price += i % 2 === 0 ? 5 : -5;
    const open = price;
    const close = price + (opts.trendUp ? 0.1 : 0);
    candles.push({ time: i * 60_000, open, high: Math.max(open, close) + 0.2, low: Math.min(open, close) - 0.2, close, volume: 1000 });
  }
  if (opts.breakoutUp) {
    const last = candles[candles.length - 1];
    candles[candles.length - 1] = { ...last, close: last.high + 50, high: last.high + 50 };
  }
  return candles;
}

function makeMarketContext(overrides: Partial<MarketContext> = {}): MarketContext {
  const candles = overrides.candles ?? makeCandles(60, { trendUp: true });
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
  tmpDir = mkdtempSync(path.join(tmpdir(), 'kairos-agentcontext-test-'));
  process.env.AGENTS_DB_PATH = path.join(tmpDir, 'agents.db');
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('regimeDetector.classifyRegime', () => {
  it('labels a clean uptrend with normal volatility as trending_up', async () => {
    const { classifyRegime } = await import('../agentContext/regimeDetector.js');
    // Flat candles (no fresh 20-bar high/low on the last close) so only the base regime/volatility
    // inputs drive the label — trend direction here comes from the mocked RegimeMetrics, not price action.
    const ctx = makeMarketContext({ candles: makeCandles(60), regime: { regime: 'trending_up', volatilityPct: 2, momentum: 3, trendStrength: 30, liquidity: 10_000 } });
    const result = classifyRegime(ctx);
    expect(result.label).toBe('trending_up');
    expect(result.volatilityBand).toBe('normal');
    expect(result.breakout).toBe(false);
  });

  it('detects an upward breakout ahead of the underlying trend label', async () => {
    const { classifyRegime } = await import('../agentContext/regimeDetector.js');
    const candles = makeCandles(60, { trendUp: true, breakoutUp: true });
    const ctx = makeMarketContext({ candles, regime: { regime: 'trending_up', volatilityPct: 2, momentum: 3, trendStrength: 30, liquidity: 10_000 } });
    const result = classifyRegime(ctx);
    expect(result.label).toBe('breakout_up');
    expect(result.breakout).toBe(true);
  });

  it('labels high volatility ahead of trend when the volatility ceiling is breached', async () => {
    const { classifyRegime } = await import('../agentContext/regimeDetector.js');
    const ctx = makeMarketContext({ candles: makeCandles(60), regime: { regime: 'volatile', volatilityPct: 6, momentum: -1, trendStrength: 10, liquidity: 5_000 } });
    const result = classifyRegime(ctx);
    expect(result.label).toBe('high_volatility');
    expect(result.volatilityBand).toBe('high');
  });

  it('labels low volatility when below the floor', async () => {
    const { classifyRegime } = await import('../agentContext/regimeDetector.js');
    const ctx = makeMarketContext({ candles: makeCandles(60), regime: { regime: 'ranging', volatilityPct: 0.4, momentum: 0.1, trendStrength: 8, liquidity: 2_000 } });
    const result = classifyRegime(ctx);
    expect(result.label).toBe('low_volatility');
  });
});

describe('featureEngine.buildFeatureResult', () => {
  it('builds a normalized FeatureSet from an agent row, reusing existing services', async () => {
    vi.doMock('../decisionEngine.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../decisionEngine.js')>();
      return { ...actual, buildMarketContext: vi.fn().mockResolvedValue(makeMarketContext()) };
    });
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { buildFeatureResult } = await import('../agentContext/featureEngine.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GOWNER1', role: 'strategic', capital: '1000' });

    const result = await buildFeatureResult(agent, 'XLM/USDC', 300, { useCache: false });
    expect(result).not.toBeNull();
    expect(result!.featureSet.pair).toBe('XLM/USDC');
    expect(result!.featureSet.wallet.publicKey).toBe(agent.public_key);
    expect(result!.featureSet.portfolio.targetXlmPct).toBe(50); // default target, no portfolio_state row
    expect(result!.featureSet.protocolExposure).toEqual([]);
    expect(result!.featureSet.risk.realizedPnl).toBe(0);
    expect(result!.regime.label).toBeDefined();
  });

  it('returns null when the oracle has insufficient candle history', async () => {
    vi.doMock('../decisionEngine.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../decisionEngine.js')>();
      return { ...actual, buildMarketContext: vi.fn().mockResolvedValue(null) };
    });
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { buildFeatureResult } = await import('../agentContext/featureEngine.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GOWNER2' });
    const result = await buildFeatureResult(agent, 'XLM/USDC', 300, { useCache: false });
    expect(result).toBeNull();
  });
});

describe('contextBuilder.buildAgentContext', () => {
  it('assembles a single immutable AgentContext for a real agent', async () => {
    vi.doMock('../decisionEngine.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../decisionEngine.js')>();
      return { ...actual, buildMarketContext: vi.fn().mockResolvedValue(makeMarketContext()) };
    });
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GOWNER3', role: 'yield' });

    const ctx = await buildAgentContext(agent.id);
    expect(ctx).not.toBeNull();
    expect(ctx!.agentId).toBe(agent.id);
    expect(ctx!.role).toBe('yield');
    expect(() => {
      (ctx as unknown as { agentId: string }).agentId = 'mutated';
    }).toThrow();
  });

  it('stamps immutable replay metadata (version, timestamp, marketId)', async () => {
    vi.doMock('../decisionEngine.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../decisionEngine.js')>();
      return { ...actual, buildMarketContext: vi.fn().mockResolvedValue(makeMarketContext()) };
    });
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { buildAgentContext, AGENT_CONTEXT_SCHEMA_VERSION } = await import('../agentContext/contextBuilder.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GOWNER3B', role: 'strategic' });

    const ctx = await buildAgentContext(agent.id);
    expect(ctx!.meta.version).toBe(AGENT_CONTEXT_SCHEMA_VERSION);
    expect(ctx!.meta.timestamp).toBeGreaterThan(0);
    expect(ctx!.meta.marketId).toBe('XLM/USDC@' + makeCandles(60)[59].time);
    expect(Object.isFrozen(ctx)).toBe(true);
  });

  it('returns null for a nonexistent agent id', async () => {
    const { buildAgentContext } = await import('../agentContext/contextBuilder.js');
    const ctx = await buildAgentContext('does-not-exist');
    expect(ctx).toBeNull();
  });
});

describe('featureCache behavior', () => {
  it('serves a cached result within TTL without recomputing', async () => {
    const marketContextMock = vi.fn().mockResolvedValue(makeMarketContext());
    vi.doMock('../decisionEngine.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../decisionEngine.js')>();
      return { ...actual, buildMarketContext: marketContextMock };
    });
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { buildFeatureResult } = await import('../agentContext/featureEngine.js');
    const { clearFeatureCache } = await import('../agentContext/featureCache.js');
    clearFeatureCache();

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GOWNER4' });

    const first = await buildFeatureResult(agent, 'XLM/USDC', 300);
    const second = await buildFeatureResult(agent, 'XLM/USDC', 300);
    expect(first).toEqual(second);
    expect(marketContextMock).toHaveBeenCalledTimes(1);
  });

  it('invalidateFeatureSet forces recomputation on next build', async () => {
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
    const agent = insertAgent(db, { owner: 'GOWNER5' });

    await buildFeatureResult(agent, 'XLM/USDC', 300);
    invalidateFeatureSet(agent.id, 'XLM/USDC');
    await buildFeatureResult(agent, 'XLM/USDC', 300);
    expect(marketContextMock).toHaveBeenCalledTimes(2);
  });
});

describe('cache abstraction', () => {
  it('featureEngine goes through a swappable FeatureCacheProvider, not a concrete cache', async () => {
    vi.doMock('../decisionEngine.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../decisionEngine.js')>();
      return { ...actual, buildMarketContext: vi.fn().mockResolvedValue(makeMarketContext()) };
    });
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { buildFeatureResult } = await import('../agentContext/featureEngine.js');
    const { setFeatureCacheProvider, resetFeatureCacheProvider, cacheKey } = await import('../agentContext/cache/index.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GOWNER6' });

    const calls: string[] = [];
    const fakeProvider = {
      async get(key: string) {
        calls.push(`get:${key}`);
        return null;
      },
      async set(key: string) {
        calls.push(`set:${key}`);
      },
      async invalidate() {},
      async clear() {},
      async size() {
        return 0;
      },
    };
    setFeatureCacheProvider(fakeProvider);

    await buildFeatureResult(agent, 'XLM/USDC', 300);
    expect(calls).toEqual([`get:${cacheKey(agent.id, 'XLM/USDC')}`, `set:${cacheKey(agent.id, 'XLM/USDC')}`]);

    resetFeatureCacheProvider();
  });
});
