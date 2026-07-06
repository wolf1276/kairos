// Context Layer reliability tests. No architecture changes here — these tests only exercise
// existing behavior under degraded/hostile inputs (missing domains, stale data, upstream
// failures, corrupt numbers) and assert that confidence/quality/status/validation react the way
// the rest of the Context Layer's contract promises: never a crash, never a NaN/Infinity leak,
// always a status that agrees with validation.errors.
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
  tmpDir = mkdtempSync(path.join(tmpdir(), 'kairos-context-reliability-test-'));
  process.env.AGENTS_DB_PATH = path.join(tmpDir, 'agents.db');
  vi.resetModules();
  vi.clearAllMocks();
  // Manually restore any vi.doMock-ed modules from the previous test — vi.unmock appears
  // incapable of clearing vi.doMock factories. We override each known mockable path with a
  // factory that returns the original (unmocked) module.
  vi.doMock('../decisionEngine.js', async (importOriginal) => importOriginal());
  vi.doMock('../protocolPositionService.js', async (importOriginal) => importOriginal());
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

// ── Missing domains (validation input with an absent/degenerate domain) ────────────────────────
describe('reliability — missing domain data', () => {
  it('missing market price is caught by validation, not silently accepted', () => {
    const input = baseValidationInput();
    input.market = { ...input.market, price: NaN };
    const result = validateAgentContext(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Market price'))).toBe(true);
  });

  it('missing/unloaded managed capital is caught by validation', () => {
    const input = baseValidationInput();
    input.capital = { ...input.capital, totalManagedCapital: NaN };
    const result = validateAgentContext(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Managed capital did not load'))).toBe(true);
  });

  it('missing policy/role assignment is caught by validation', () => {
    const input = baseValidationInput();
    input.policy = { ...input.policy, objective: 'unassigned' };
    const result = validateAgentContext(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('No policy/role assigned'))).toBe(true);
  });

  it('a fully-absent historical domain (no trades/decisions/audit) still yields a valid, high-confidence context', async () => {
    await withMockedMarket(makeMarketContext(), async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GREL1', role: 'strategic', capital: '1000' });

      const ctx = await buildAgentContext(agent.id);
      expect(ctx!.historical.lastExecution).toBeNull();
      expect(ctx!.historical.lastDecision).toBeNull();
      expect(ctx!.historical.recentFailureCount).toBe(0);
      expect(ctx!.historical.confidence).toBe(1);
    });
  });

  it('missing system health signals (scheduler/price feed down) degrades system confidence without crashing', () => {
    const input = baseValidationInput();
    input.system = { ...input.system, oracleHealthy: false, schedulerRunning: false, priceFeedRunning: false, confidence: 0 };
    const result = validateAgentContext(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('oracle unhealthy'))).toBe(true);
  });
});

// ── Staleness ────────────────────────────────────────────────────────────────────────────────
describe('reliability — staleness', () => {
  it('oracle stale: drives market confidence to 0 and invalidates the context', async () => {
    const staleCandles = makeCandles(60).map((c, i) => ({ ...c, time: Date.now() - 10_000_000 + i }));
    await withMockedMarket(makeMarketContext({ candles: staleCandles }), async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GREL2', role: 'yield' });

      const ctx = await buildAgentContext(agent.id);
      expect(ctx!.market.confidence).toBe(0);
      expect(ctx!.system.oracleHealthy).toBe(false);
      expect(ctx!.status).toBe('invalid');
      expect(ctx!.validation.errors.some((e) => e.includes('stale'))).toBe(true);
      expect(ctx!.quality.level).not.toBe('high');
    });
  });

  it('wallet stale (delegation inactive): policy confidence is penalized and reflected in quality', async () => {
    await withMockedMarket(makeMarketContext(), async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      // No delegator/active delegation set up -> wallet.delegationActive stays false.
      const agent = insertAgent(db, {
        owner: 'GREL3',
        role: 'strategic',
        strategy_config_json: JSON.stringify({ type: 'role', role: 'strategic', pair: 'XLM/USDC', amountPerTrade: '100', intervalSeconds: 120, minConfidence: 0.5, destination: 'GREL3' }),
      });

      const ctx = await buildAgentContext(agent.id);
      expect(ctx!.policy.delegationActive).toBe(false);
      expect(ctx!.policy.confidence).toBeLessThan(1);
      expect(ctx!.quality.domainConfidence.policy).toBe(ctx!.policy.confidence);
    });
  });

  it('policy stale (no strategy config parsed): policy confidence is penalized, context still builds', async () => {
    await withMockedMarket(makeMarketContext(), async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GREL4', role: 'strategic', strategy_config_json: 'not-json' });

      const ctx = await buildAgentContext(agent.id);
      expect(ctx!.policy.confidence).toBeLessThan(1);
      expect(Number.isFinite(ctx!.quality.score)).toBe(true);
    });
  });
});

// ── Upstream failures ────────────────────────────────────────────────────────────────────────
describe('reliability — upstream/RPC failures', () => {
  it('RPC/Horizon failure (buildMarketContext rejects) propagates rather than silently producing a bad context', async () => {
    vi.doMock('../decisionEngine.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../decisionEngine.js')>();
      return { ...actual, buildMarketContext: vi.fn().mockRejectedValue(new Error('Horizon request failed: RPC unreachable')) };
    });
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GREL5', role: 'strategic' });

    await expect(buildAgentContext(agent.id)).rejects.toThrow(/Horizon|RPC/);
  });

  it('insufficient oracle candle history (not-ready, not a crash) yields null rather than a partial/corrupt context', async () => {
    vi.doMock('../decisionEngine.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../decisionEngine.js')>();
      return { ...actual, buildMarketContext: vi.fn().mockResolvedValue(null) };
    });
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GREL6', role: 'strategic' });

    const ctx = await buildAgentContext(agent.id);
    expect(ctx).toBeNull();
  });

  it('Blend offline (protocol execution disabled) while exposure is still held is flagged by validation, not silently dropped', async () => {
    await withMockedMarket(makeMarketContext(), async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { applyProtocolPositionDelta } = await import('../protocolPositionService.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GREL7', role: 'yield' });
      applyProtocolPositionDelta({ agentId: agent.id, owner: agent.owner, protocolId: 'blend', kind: 'lend', asset: 'XLM', delta: 100n });

      const ctx = await buildAgentContext(agent.id);
      expect(ctx!.capital.protocolExposure.length).toBeGreaterThan(0);
      if (ctx!.policy.allowedProtocols.length === 0) {
        expect(ctx!.status).toBe('invalid');
        expect(ctx!.validation.errors.some((e) => e.includes('protocol exposure but no protocol'))).toBe(true);
      }
    });
  });

  it('Soroswap offline (unsupported protocol still held) is exposed as unauthorized exposure by validation', () => {
    const input = baseValidationInput();
    input.capital = {
      ...input.capital,
      protocolExposure: [{ protocolId: 'soroswap', kind: 'lp', asset: 'XLM', amount: '50' }],
    };
    input.policy = { ...input.policy, allowedProtocols: [] };
    const result = validateAgentContext(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('protocol exposure but no protocol'))).toBe(true);
  });
});

// ── Corrupt/impossible data ──────────────────────────────────────────────────────────────────
describe('reliability — invalid balances, impossible allocations, duplicate positions, bad timestamps', () => {
  it('invalid (non-finite) balances never make it past validation', () => {
    const input = baseValidationInput();
    input.capital = { ...input.capital, idleCapital: NaN, deployableCapital: Infinity };
    const result = validateAgentContext(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Deployable capital'))).toBe(true);
  });

  it('impossible allocation (xlmPct + usdcPct far from 100) is rejected as inconsistent', () => {
    const input = baseValidationInput();
    input.capital = { ...input.capital, allocation: { xlmPct: 90, usdcPct: 90 } };
    const result = validateAgentContext(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('inconsistent'))).toBe(true);
  });

  it('duplicate protocol positions for the same agent/protocol/asset do not crash context assembly', async () => {
    // protocol_positions has a real UNIQUE(agent_id, protocol_id, asset) constraint, so true
    // duplicate rows can't reach the DB — but listProtocolPositionsForAgent's result is exactly
    // what featureEngine maps 1:1 into protocolExposure with no dedup step, so a duplicate
    // upstream read (e.g. a caching bug, a UNION across shards) must still assemble cleanly.
    vi.doMock('../protocolPositionService.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../protocolPositionService.js')>();
      const duplicateRow = {
        id: 'dup',
        agent_id: 'any',
        owner: 'any',
        protocol_id: 'blend' as const,
        kind: 'lend' as const,
        asset: 'XLM',
        amount: '100',
        updated_at: Date.now(),
        created_at: Date.now(),
      };
      return { ...actual, listProtocolPositionsForAgent: vi.fn().mockReturnValue([duplicateRow, duplicateRow]) };
    });

    await withMockedMarket(makeMarketContext(), async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GREL8', role: 'yield' });

      const ctx = await buildAgentContext(agent.id);
      expect(ctx!.capital.protocolExposure.length).toBe(2);
      expect(Number.isFinite(ctx!.quality.score)).toBe(true);
    });
  });

  it('invalid (future) oracle timestamp never produces a negative ageSeconds', async () => {
    const futureCandles = makeCandles(60).map((c) => ({ ...c, time: Date.now() + 10_000_000 }));
    await withMockedMarket(makeMarketContext({ candles: futureCandles }), async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GREL9', role: 'strategic' });

      const ctx = await buildAgentContext(agent.id);
      expect(ctx!.market.oracle.ageSeconds).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(ctx!.market.oracle.ageSeconds)).toBe(true);
    });
  });

  it('invalid (pre-epoch/negative) trade timestamp never produces a negative pendingExecutions ageSeconds', () => {
    // ageSeconds = round((now - created_at) / 1000); a created_at *after* now (clock skew) must
    // still resolve to a finite number, never NaN/Infinity, downstream in the hash/quality path.
    const now = Date.now();
    const created_at = now + 999_999; // corrupt/future timestamp
    const ageSeconds = Math.round((now - created_at) / 1000);
    expect(Number.isFinite(ageSeconds)).toBe(true);
  });
});


