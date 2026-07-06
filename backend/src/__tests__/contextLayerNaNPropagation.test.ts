// Context Layer NaN/Infinity propagation tests. These are isolated in their own file to
// avoid vi.doMock state leakage from tests in other files that also mock the same modules.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { MarketContext } from '../decisionTypes.js';
import { validateAgentContext } from '../agentContext/validation.js';
import type { MarketContextView } from '../agentContext/domains/marketContext.js';
import type { ManagedCapitalContextView } from '../agentContext/domains/capitalContext.js';
import type { PolicyContextView } from '../agentContext/domains/policyContext.js';
import type { SystemContextView } from '../agentContext/domains/systemContext.js';

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

function baseValidationInput(): {
  market: MarketContextView;
  capital: ManagedCapitalContextView;
  policy: PolicyContextView;
  system: SystemContextView;
} {
  return {
    market: {
      pair: 'XLM/USDC',
      price: 0.1,
      oracle: { timestamp: Date.now(), ageSeconds: 5 },
      candles: { resolutionSeconds: 60 },
      trend: { ema20: 1, ema50: 1, sma20: 1, trendStrength: 1, direction: 'flat' },
      momentum: { rsi: 50, macdHistogram: 0, roc: 0 },
      volatility: { atr: 0.1, volatilityPct: 1, band: 'low' },
      volume: { window24h: 1000, changePct: 0 },
      liquidity: { recentVolume: 1000 },
      regime: { base: 'trending_up', label: 'trending_up', breakout: false, volatilityBand: 'low' },
      confidence: 1,
    },
    capital: {
      totalManagedCapital: 1000,
      idleCapital: 200,
      deployableCapital: 200,
      allocation: { xlmPct: 60, usdcPct: 40 },
      protocolExposure: [],
      realizedPnl: 0,
      unrealizedPnl: 0,
      pendingExecutions: [],
      confidence: 1,
    },
    policy: {
      objective: 'strategic',
      riskProfile: 'medium',
      allowedAssets: ['XLM', 'USDC'],
      allowedProtocols: [],
      delegationActive: true,
      spendingLimitPerTrade: null,
      minConfidence: null,
      positionLimit: { maxCapital: null },
      confidence: 1,
    },
    system: {
      oracleHealthy: true,
      schedulerRunning: true,
      priceFeedRunning: true,
      agentRunning: true,
      protocolExecutionAvailable: false,
      executionAvailable: true,
      featureFlags: {},
      confidence: 1,
    },
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'kairos-context-nan-test-'));
  process.env.AGENTS_DB_PATH = path.join(tmpDir, 'agents.db');
  vi.resetModules();
  vi.clearAllMocks();
  // Manually restore any vi.doMock-ed modules from the previous test — vi.unmock appears
  // incapable of clearing vi.doMock factories. We override each known mockable path with a
  // factory that returns the original (unmocked) module.
  vi.doMock('../decisionEngine.js', async (importOriginal) => importOriginal());
  vi.doMock('../agentContext/domains/marketContext.js', async (importOriginal) => importOriginal());
  vi.doMock('../agentContext/domains/systemContext.js', async (importOriginal) => importOriginal());
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

async function withMockedMarket(marketContext: MarketContext, fn: () => Promise<void>) {
  vi.doMock('../decisionEngine.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../decisionEngine.js')>();
    return { ...actual, buildMarketContext: vi.fn().mockResolvedValue(marketContext) };
  });
  await fn();
}

describe('reliability — NaN/Infinity propagation', () => {
  it('NaN market price fails validation and is reflected in status', () => {
    const input = baseValidationInput();
    input.market = { ...input.market, price: NaN };
    const result = validateAgentContext(input);
    expect(result.ok).toBe(false);
  });

  it('Infinity market price fails validation', () => {
    const input = baseValidationInput();
    input.market = { ...input.market, price: Infinity };
    const result = validateAgentContext(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Market price'))).toBe(true);
  });

  it('NaN domain confidence never leaks into quality.score (clamped, not propagated)', async () => {
    vi.doMock('../decisionEngine.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../decisionEngine.js')>();
      return { ...actual, buildMarketContext: vi.fn().mockResolvedValue(makeMarketContext()) };
    });
    vi.doMock('../agentContext/domains/marketContext.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../agentContext/domains/marketContext.js')>();
      return {
        ...actual,
        buildMarketContextView: (...args: Parameters<typeof actual.buildMarketContextView>) => ({
          ...actual.buildMarketContextView(...args),
          confidence: NaN,
        }),
      };
    });

    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GREL10', role: 'balancer', capital: '500' });

    const ctx = await buildAgentContext(agent.id);
    expect(Number.isFinite(ctx!.quality.score)).toBe(true);
    expect(ctx!.quality.domainConfidence.market).toBe(0);
  });

  it('Infinity domain confidence is clamped to 1, never propagated as-is', async () => {
    vi.doMock('../decisionEngine.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../decisionEngine.js')>();
      return { ...actual, buildMarketContext: vi.fn().mockResolvedValue(makeMarketContext()) };
    });
    vi.doMock('../agentContext/domains/systemContext.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../agentContext/domains/systemContext.js')>();
      return {
        ...actual,
        buildSystemContextView: (...args: Parameters<typeof actual.buildSystemContextView>) => ({
          ...actual.buildSystemContextView(...args),
          confidence: Infinity,
        }),
      };
    });

    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GREL11', role: 'balancer', capital: '500' });

    const ctx = await buildAgentContext(agent.id);
    // clampConfidence treats any non-finite value (NaN or +/-Infinity) as "unknown", not "cap it
    // at the boundary" — so Infinity clamps to 0, exactly like NaN does.
    expect(ctx!.quality.domainConfidence.system).toBe(0);
    expect(Number.isFinite(ctx!.quality.score)).toBe(true);
    expect(ctx!.quality.score).toBeLessThanOrEqual(1);
  });

  it('NaN indicators from a corrupt oracle pass through the FeatureSet (documented behavior — validation does not check indicator fields, only price)', async () => {
    const freshNow = Date.now();
    const freshCandles = makeCandles(60);
    const candlesNow = freshCandles.map((c) => ({ ...c, time: freshNow }));
    const marketWithNan = makeMarketContext({ candles: candlesNow });
    marketWithNan.indicators.rsi = NaN;
    marketWithNan.indicators.macd.histogram = NaN;
    marketWithNan.indicators.ema20 = NaN;
    marketWithNan.indicators.atr = NaN;
    marketWithNan.regime.volatilityPct = NaN;
    await withMockedMarket(marketWithNan, async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GREL13', role: 'strategic', capital: '1000' });

      const ctx = await buildAgentContext(agent.id);
      expect(ctx).not.toBeNull();
      expect(Number.isNaN(ctx!.features.trend.ema20)).toBe(true);
      expect(Number.isNaN(ctx!.features.momentum.rsi)).toBe(true);
      expect(Number.isNaN(ctx!.features.volatility.volatilityPct)).toBe(true);
      expect(ctx!.market.price).toBe(100);
      expect(ctx!.status).toBe('valid');
      expect(Number.isFinite(ctx!.quality.score)).toBe(true);
      expect(Number.isFinite(ctx!.market.confidence)).toBe(true);
    });
  });

  it('NaN drawdownPct (corrupt capital string) never propagates into the FeatureSet risk view', async () => {
    await withMockedMarket(makeMarketContext(), async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GREL12', role: 'strategic', capital: 'garbage-not-a-number' });

      const ctx = await buildAgentContext(agent.id);
      expect(Number.isFinite(ctx!.capital.totalManagedCapital)).toBe(false);
      expect(ctx!.status).toBe('invalid');
      expect(ctx!.validation.errors.some((e) => e.includes('Managed capital did not load'))).toBe(true);
    });
  });
});
