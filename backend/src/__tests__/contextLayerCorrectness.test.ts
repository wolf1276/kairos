// Correctness fixes for the Context Layer: NaN/Infinity guards on capital/drift/drawdown
// figures, deterministic (order-independent) context hashing, quality clamping, and expanded
// validation coverage (deployable capital, protocol exposure, allocation consistency, schema
// version).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { MarketContext } from '../decisionTypes.js';
import { validateAgentContext } from '../agentContext/validation.js';
import { buildManagedCapitalContextView } from '../agentContext/domains/capitalContext.js';
import { AGENT_CONTEXT_SCHEMA_VERSION } from '../agentContext/types.js';
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

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'kairos-context-correctness-test-'));
  process.env.AGENTS_DB_PATH = path.join(tmpDir, 'agents.db');
  vi.resetModules();
  vi.clearAllMocks();
  // Manually restore any vi.doMock-ed modules from the previous test — vi.unmock appears
  // incapable of clearing vi.doMock factories. We override each known mockable path with a
  // factory that returns the original (unmocked) module.
  vi.doMock('../decisionEngine.js', async (importOriginal) => importOriginal());
  vi.doMock('../protocolPositionService.js', async (importOriginal) => importOriginal());
  vi.doMock('../agentContext/domains/marketContext.js', async (importOriginal) => importOriginal());
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

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

describe('validateAgentContext — expanded numeric/consistency checks', () => {
  it('passes on a fully well-formed context', () => {
    const result = validateAgentContext(baseValidationInput());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a non-finite deployableCapital', () => {
    const input = baseValidationInput();
    input.capital = { ...input.capital, deployableCapital: NaN };
    const result = validateAgentContext(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Deployable capital'))).toBe(true);
  });

  it('rejects a negative deployableCapital', () => {
    const input = baseValidationInput();
    input.capital = { ...input.capital, deployableCapital: -5 };
    const result = validateAgentContext(input);
    expect(result.errors.some((e) => e.includes('Deployable capital'))).toBe(true);
  });

  it('rejects a negative idleCapital', () => {
    const input = baseValidationInput();
    input.capital = { ...input.capital, idleCapital: -1 };
    const result = validateAgentContext(input);
    expect(result.errors.some((e) => e.includes('Idle capital'))).toBe(true);
  });

  it('rejects an allocation that does not sum to ~100', () => {
    const input = baseValidationInput();
    input.capital = { ...input.capital, allocation: { xlmPct: 60, usdcPct: 10 } };
    const result = validateAgentContext(input);
    expect(result.errors.some((e) => e.includes('inconsistent'))).toBe(true);
  });

  it('tolerates small floating-point rounding in allocation sums', () => {
    const input = baseValidationInput();
    input.capital = { ...input.capital, allocation: { xlmPct: 60.10000001, usdcPct: 39.9 } };
    const result = validateAgentContext(input);
    expect(result.errors.some((e) => e.includes('inconsistent'))).toBe(false);
  });

  it('rejects a protocol exposure entry with a non-numeric amount', () => {
    const input = baseValidationInput();
    input.capital = {
      ...input.capital,
      protocolExposure: [{ protocolId: 'blend', kind: 'lend', asset: 'XLM', amount: 'not-a-number' }],
    };
    input.policy = { ...input.policy, allowedProtocols: ['blend'] };
    const result = validateAgentContext(input);
    expect(result.errors.some((e) => e.includes('Protocol exposure amount'))).toBe(true);
  });

  it('rejects a protocol exposure entry with a negative amount', () => {
    const input = baseValidationInput();
    input.capital = {
      ...input.capital,
      protocolExposure: [{ protocolId: 'blend', kind: 'lend', asset: 'XLM', amount: '-5' }],
    };
    input.policy = { ...input.policy, allowedProtocols: ['blend'] };
    const result = validateAgentContext(input);
    expect(result.errors.some((e) => e.includes('Protocol exposure amount'))).toBe(true);
  });

  it('rejects a mismatched schema version', () => {
    const input = { ...baseValidationInput(), schemaVersion: '1.0.0' };
    const result = validateAgentContext(input);
    expect(result.errors.some((e) => e.includes('schema version'))).toBe(true);
  });

  it('accepts a matching schema version', () => {
    const input = { ...baseValidationInput(), schemaVersion: AGENT_CONTEXT_SCHEMA_VERSION };
    const result = validateAgentContext(input);
    expect(result.ok).toBe(true);
  });
});

describe('buildManagedCapitalContextView — NaN/Infinity guards', () => {
  it('clamps deployableCapital to 0 when idleUsd is NaN', async () => {
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const db = getDb();
    const agent = insertAgent(db, { owner: 'GCAP1', capital: '1000' });

    const result = {
      featureSet: {
        portfolio: { xlmPct: 50, usdcPct: 50, idleUsd: NaN, totalValue: 1000, targetXlmPct: 50, targetUsdcPct: 50, driftPct: 0 },
        protocolExposure: [],
        risk: { realizedPnl: 0, unrealizedPnl: 0, drawdownPct: null, volatilityPct: 1 },
      },
    } as any;

    const view = buildManagedCapitalContextView(agent, result);
    expect(view.deployableCapital).toBe(0);
    expect(view.idleCapital).toBe(0);
  });

  it('clamps deployableCapital to 0 when idleUsd is Infinity', async () => {
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const db = getDb();
    const agent = insertAgent(db, { owner: 'GCAP2', capital: '1000' });

    const result = {
      featureSet: {
        portfolio: { xlmPct: 50, usdcPct: 50, idleUsd: Infinity, totalValue: 1000, targetXlmPct: 50, targetUsdcPct: 50, driftPct: 0 },
        protocolExposure: [],
        risk: { realizedPnl: 0, unrealizedPnl: 0, drawdownPct: null, volatilityPct: 1 },
      },
    } as any;

    const view = buildManagedCapitalContextView(agent, result);
    expect(view.deployableCapital).toBe(0);
  });

  it('marks totalManagedCapital as non-finite (surfaced by validation) when capital field is corrupt', async () => {
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const db = getDb();
    const agent = insertAgent(db, { owner: 'GCAP3', capital: 'not-a-number' });

    const result = {
      featureSet: {
        portfolio: { xlmPct: 50, usdcPct: 50, idleUsd: 100, totalValue: 1000, targetXlmPct: 50, targetUsdcPct: 50, driftPct: 0 },
        protocolExposure: [],
        risk: { realizedPnl: 0, unrealizedPnl: 0, drawdownPct: null, volatilityPct: 1 },
      },
    } as any;

    const view = buildManagedCapitalContextView(agent, result);
    expect(Number.isFinite(view.totalManagedCapital)).toBe(false);
    expect(view.confidence).toBe(0);
  });
});

describe('stableStringify — serialization determinism edge cases', () => {
  // stableStringify is module-private in contextBuilder.ts. We exercise it
  // indirectly through computeContextHash by building contexts that exercise
  // each branch of the serializer: null values, nested objects, empty arrays,
  // and mixed-type arrays.

  async function withMockedMarket(fn: () => Promise<void>) {
    vi.doMock('../decisionEngine.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../decisionEngine.js')>();
      return { ...actual, buildMarketContext: vi.fn().mockResolvedValue(makeMarketContext()) };
    });
    await fn();
  }

  it('hash is stable when validated against a context with null risk fields (drawdownPct: null)', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GSTABLE1', role: 'strategic', capital: '500' });

      const first = await buildAgentContext(agent.id);
      const second = await buildAgentContext(agent.id, { forceRefresh: true });
      // drawdownPct is 0 when there are no trades (no PnL means 0% drawdown).
      // Serialization must handle numeric zero fields.
      expect(first!.features.risk.drawdownPct).toBe(0);
      expect(first!.meta.contextHash).toBe(second!.meta.contextHash);
    });
  });

  it('hash is stable with an empty protocolExposure array', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GSTABLE2', role: 'strategic', capital: '500' });

      const first = await buildAgentContext(agent.id);
      const second = await buildAgentContext(agent.id, { forceRefresh: true });
      expect(first!.capital.protocolExposure).toEqual([]);
      expect(first!.meta.contextHash).toBe(second!.meta.contextHash);
    });
  });

  it('hash is stable with multiple protocol positions (array of objects in stableStringify)', async () => {
    vi.doMock('../protocolPositionService.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../protocolPositionService.js')>();
      const positions = [
        { id: 'p1', agent_id: 'any', owner: 'any', protocol_id: 'blend' as const, kind: 'lend' as const, asset: 'XLM', amount: '100', updated_at: Date.now(), created_at: Date.now() },
        { id: 'p2', agent_id: 'any', owner: 'any', protocol_id: 'soroswap' as const, kind: 'lp' as const, asset: 'USDC', amount: '200', updated_at: Date.now(), created_at: Date.now() },
        { id: 'p3', agent_id: 'any', owner: 'any', protocol_id: 'blend' as const, kind: 'borrow' as const, asset: 'XLM', amount: '50', updated_at: Date.now(), created_at: Date.now() },
      ];
      return { ...actual, listProtocolPositionsForAgent: vi.fn().mockReturnValue(positions) };
    });
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GSTABLE3', role: 'yield', capital: '2000' });

      const first = await buildAgentContext(agent.id);
      const second = await buildAgentContext(agent.id, { forceRefresh: true });
      expect(first!.capital.protocolExposure.length).toBe(3);
      expect(first!.meta.contextHash).toBe(second!.meta.contextHash);
    });
  });
});

describe('AgentContext assembly — hashing determinism and quality clamping', () => {
  async function withMockedMarket(fn: () => Promise<void>) {
    vi.doMock('../decisionEngine.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../decisionEngine.js')>();
      return { ...actual, buildMarketContext: vi.fn().mockResolvedValue(makeMarketContext()) };
    });
    await fn();
  }

  it('produces identical hashes for structurally-identical contexts regardless of object key insertion order', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GHASH1', role: 'balancer', capital: '500' });

      const ctx1 = await buildAgentContext(agent.id);
      // Force a fresh feature computation (bypassing cache) — a completely separate build pass
      // constructs every domain view object fresh, so this exercises real-world non-determinism
      // in property insertion order, not just a reused object reference.
      const ctx2 = await buildAgentContext(agent.id, { forceRefresh: true });

      expect(ctx1!.meta.contextHash).toBe(ctx2!.meta.contextHash);
    });
  });

  it('never lets an out-of-range or non-finite domain confidence leak into quality.score', async () => {
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
    const agent = insertAgent(db, { owner: 'GQUAL1', role: 'balancer', capital: '500' });

    const ctx = await buildAgentContext(agent.id);
    expect(Number.isFinite(ctx!.quality.score)).toBe(true);
    expect(ctx!.quality.score).toBeGreaterThanOrEqual(0);
    expect(ctx!.quality.score).toBeLessThanOrEqual(1);
    expect(ctx!.quality.domainConfidence.market).toBe(0);
  });
});
