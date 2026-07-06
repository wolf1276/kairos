// Exhaustive validation / edge-case coverage for the Context Layer. Pure test expansion — no
// changes to validation.ts or any domain builder's logic. Every branch of validateAgentContext
// is exercised directly (unit-level, fast, precise), plus a handful of scenarios that only
// surface through the real domain builders (duplicate positions, malformed policy config, an
// empty/zero-value portfolio) are verified end-to-end via buildAgentContext.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { MarketContext } from '../decisionTypes.js';
import { validateAgentContext, type ContextValidationInput } from '../agentContext/validation.js';
import { AGENT_CONTEXT_SCHEMA_VERSION } from '../agentContext/types.js';

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

/** A fully valid baseline input — every test below mutates a copy of exactly one field so each
 *  test isolates exactly one validation branch. */
function baseInput(): ContextValidationInput {
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
    schemaVersion: AGENT_CONTEXT_SCHEMA_VERSION,
  };
}

function expectError(input: ContextValidationInput, substring: string) {
  const result = validateAgentContext(input);
  expect(result.ok).toBe(false);
  expect(result.errors.some((e) => e.includes(substring))).toBe(true);
}

function expectOk(input: ContextValidationInput) {
  const result = validateAgentContext(input);
  expect(result.ok).toBe(true);
  expect(result.errors).toEqual([]);
}

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'kairos-context-validation-coverage-test-'));
  process.env.AGENTS_DB_PATH = path.join(tmpDir, 'agents.db');
  delete process.env.SCHEDULER_INTERVAL_MS;
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('validation coverage — baseline sanity', () => {
  it('a fully well-formed input passes with zero errors', () => {
    expectOk(baseInput());
  });
});

// ── NaN across every numeric field validation touches ───────────────────────────────────────
describe('validation coverage — NaN', () => {
  it('NaN market.price', () => {
    const input = baseInput();
    input.market = { ...input.market, price: NaN };
    expectError(input, 'Market price');
  });

  it('NaN capital.totalManagedCapital', () => {
    const input = baseInput();
    input.capital = { ...input.capital, totalManagedCapital: NaN };
    expectError(input, 'Managed capital did not load');
  });

  it('NaN capital.deployableCapital', () => {
    const input = baseInput();
    input.capital = { ...input.capital, deployableCapital: NaN };
    expectError(input, 'Deployable capital');
  });

  it('NaN capital.idleCapital', () => {
    const input = baseInput();
    input.capital = { ...input.capital, idleCapital: NaN };
    expectError(input, 'Idle capital');
  });

  it('NaN capital.allocation.xlmPct', () => {
    const input = baseInput();
    input.capital = { ...input.capital, allocation: { xlmPct: NaN, usdcPct: 40 } };
    expectError(input, 'Portfolio allocation is incomplete');
  });

  it('NaN capital.allocation.usdcPct', () => {
    const input = baseInput();
    input.capital = { ...input.capital, allocation: { xlmPct: 60, usdcPct: NaN } };
    expectError(input, 'Portfolio allocation is incomplete');
  });

  it('NaN protocol exposure amount', () => {
    const input = baseInput();
    input.capital = { ...input.capital, protocolExposure: [{ protocolId: 'blend', kind: 'lend', asset: 'XLM', amount: 'NaN' }] };
    input.policy = { ...input.policy, allowedProtocols: ['blend'] };
    expectError(input, 'Protocol exposure amount');
  });
});

// ── Infinity across every numeric field ─────────────────────────────────────────────────────
describe('validation coverage — Infinity', () => {
  it('Infinity market.price', () => {
    const input = baseInput();
    input.market = { ...input.market, price: Infinity };
    expectError(input, 'Market price');
  });

  it('-Infinity market.price', () => {
    const input = baseInput();
    input.market = { ...input.market, price: -Infinity };
    expectError(input, 'Market price');
  });

  it('Infinity capital.totalManagedCapital', () => {
    const input = baseInput();
    input.capital = { ...input.capital, totalManagedCapital: Infinity };
    expectError(input, 'Managed capital did not load');
  });

  it('Infinity capital.deployableCapital', () => {
    const input = baseInput();
    input.capital = { ...input.capital, deployableCapital: Infinity };
    expectError(input, 'Deployable capital');
  });

  it('Infinity capital.idleCapital', () => {
    const input = baseInput();
    input.capital = { ...input.capital, idleCapital: Infinity };
    expectError(input, 'Idle capital');
  });

  it('Infinity in allocation percentages', () => {
    const input = baseInput();
    input.capital = { ...input.capital, allocation: { xlmPct: Infinity, usdcPct: 40 } };
    expectError(input, 'Portfolio allocation is incomplete');
  });

  it('Infinity protocol exposure amount', () => {
    const input = baseInput();
    input.capital = { ...input.capital, protocolExposure: [{ protocolId: 'blend', kind: 'lend', asset: 'XLM', amount: 'Infinity' }] };
    input.policy = { ...input.policy, allowedProtocols: ['blend'] };
    expectError(input, 'Protocol exposure amount');
  });
});

// ── Negative idle / deployable capital ───────────────────────────────────────────────────────
describe('validation coverage — negative idle/deployable capital', () => {
  it('negative deployableCapital', () => {
    const input = baseInput();
    input.capital = { ...input.capital, deployableCapital: -0.01 };
    expectError(input, 'Deployable capital');
  });

  it('negative idleCapital', () => {
    const input = baseInput();
    input.capital = { ...input.capital, idleCapital: -0.01 };
    expectError(input, 'Idle capital');
  });

  it('zero deployableCapital/idleCapital is valid (not negative)', () => {
    const input = baseInput();
    input.capital = { ...input.capital, deployableCapital: 0, idleCapital: 0 };
    expectOk(input);
  });

  it('large negative deployableCapital', () => {
    const input = baseInput();
    input.capital = { ...input.capital, deployableCapital: -1_000_000 };
    expectError(input, 'Deployable capital');
  });
});

// ── Allocation mismatch ───────────────────────────────────────────────────────────────────────
describe('validation coverage — allocation mismatch', () => {
  it('allocation summing far below 100', () => {
    const input = baseInput();
    input.capital = { ...input.capital, allocation: { xlmPct: 10, usdcPct: 10 } };
    expectError(input, 'inconsistent');
  });

  it('allocation summing far above 100', () => {
    const input = baseInput();
    input.capital = { ...input.capital, allocation: { xlmPct: 80, usdcPct: 80 } };
    expectError(input, 'inconsistent');
  });

  it('allocation summing to exactly 0 (empty/zero-value portfolio)', () => {
    const input = baseInput();
    input.capital = { ...input.capital, allocation: { xlmPct: 0, usdcPct: 0 } };
    expectError(input, 'inconsistent');
  });

  it('allocation within tolerance (100.3) passes', () => {
    const input = baseInput();
    input.capital = { ...input.capital, allocation: { xlmPct: 60.2, usdcPct: 40.1 } };
    expectOk(input);
  });

  it('allocation exactly at the tolerance boundary (100.5) passes', () => {
    const input = baseInput();
    input.capital = { ...input.capital, allocation: { xlmPct: 60.5, usdcPct: 40 } };
    expectOk(input);
  });

  it('allocation just past the tolerance boundary (100.51) fails', () => {
    const input = baseInput();
    input.capital = { ...input.capital, allocation: { xlmPct: 60.51, usdcPct: 40 } };
    expectError(input, 'inconsistent');
  });

  it('100/0 split (all XLM, no idle) passes', () => {
    const input = baseInput();
    input.capital = { ...input.capital, allocation: { xlmPct: 100, usdcPct: 0 } };
    expectOk(input);
  });

  it('0/100 split (all idle, no XLM) passes', () => {
    const input = baseInput();
    input.capital = { ...input.capital, allocation: { xlmPct: 0, usdcPct: 100 } };
    expectOk(input);
  });
});

// ── Protocol exposure mismatch (unauthorized exposure vs. policy) ──────────────────────────
describe('validation coverage — protocol exposure mismatch', () => {
  it('exposure present, no protocols allowed at all', () => {
    const input = baseInput();
    input.capital = { ...input.capital, protocolExposure: [{ protocolId: 'blend', kind: 'lend', asset: 'XLM', amount: '10' }] };
    input.policy = { ...input.policy, allowedProtocols: [] };
    expectError(input, 'no protocol is currently allowed');
  });

  it('exposure on a protocol not in the allowed list', () => {
    const input = baseInput();
    input.capital = { ...input.capital, protocolExposure: [{ protocolId: 'soroswap', kind: 'lp', asset: 'XLM', amount: '10' }] };
    // allowedProtocols check is "any exposure + zero allowed protocols" — it doesn't cross-check
    // per-protocol identity, so a non-empty allowedProtocols list (even for a different protocol)
    // suppresses this error; documented via the companion test below.
    input.policy = { ...input.policy, allowedProtocols: [] };
    expectError(input, 'no protocol is currently allowed');
  });

  it('exposure present and at least one protocol allowed (even if not a per-protocol match) passes this check', () => {
    const input = baseInput();
    input.capital = { ...input.capital, protocolExposure: [{ protocolId: 'soroswap', kind: 'lp', asset: 'XLM', amount: '10' }] };
    input.policy = { ...input.policy, allowedProtocols: ['blend'] };
    expectOk(input);
  });

  it('multiple exposures, no protocols allowed — still exactly the one exposure error (no duplicate error text)', () => {
    const input = baseInput();
    input.capital = {
      ...input.capital,
      protocolExposure: [
        { protocolId: 'blend', kind: 'lend', asset: 'XLM', amount: '10' },
        { protocolId: 'soroswap', kind: 'lp', asset: 'USDC', amount: '20' },
      ],
    };
    input.policy = { ...input.policy, allowedProtocols: [] };
    const result = validateAgentContext(input);
    expect(result.errors.filter((e) => e.includes('no protocol is currently allowed'))).toHaveLength(1);
  });

  it('no exposure, no protocols allowed — no error (nothing to authorize)', () => {
    const input = baseInput();
    input.capital = { ...input.capital, protocolExposure: [] };
    input.policy = { ...input.policy, allowedProtocols: [] };
    expectOk(input);
  });

  it('exposure present, protocols allowed — no error', () => {
    const input = baseInput();
    input.capital = { ...input.capital, protocolExposure: [{ protocolId: 'blend', kind: 'lend', asset: 'XLM', amount: '10' }] };
    input.policy = { ...input.policy, allowedProtocols: ['blend'] };
    expectOk(input);
  });
});

// ── Invalid prices ────────────────────────────────────────────────────────────────────────────
describe('validation coverage — invalid prices', () => {
  it('zero price is invalid', () => {
    const input = baseInput();
    input.market = { ...input.market, price: 0 };
    expectError(input, 'Market price');
  });

  it('negative price is invalid', () => {
    const input = baseInput();
    input.market = { ...input.market, price: -0.5 };
    expectError(input, 'Market price');
  });

  it('a tiny positive price is valid', () => {
    const input = baseInput();
    input.market = { ...input.market, price: 0.0000001 };
    expectOk(input);
  });
});

// ── Missing metadata / schema version mismatch ──────────────────────────────────────────────
describe('validation coverage — missing metadata / schema version', () => {
  it('schemaVersion omitted entirely is treated as "not checked", not an error', () => {
    const input = baseInput();
    delete input.schemaVersion;
    expectOk(input);
  });

  it('schemaVersion mismatched is an error', () => {
    const input = baseInput();
    input.schemaVersion = '0.0.1';
    expectError(input, 'schema version');
  });

  it('schemaVersion matching current version passes', () => {
    const input = baseInput();
    input.schemaVersion = AGENT_CONTEXT_SCHEMA_VERSION;
    expectOk(input);
  });

  it('empty-string schemaVersion is a mismatch, not treated as "omitted"', () => {
    const input = baseInput();
    input.schemaVersion = '';
    expectError(input, 'schema version');
  });
});

// ── Invalid timestamps (oracle staleness) ───────────────────────────────────────────────────
describe('validation coverage — invalid timestamps', () => {
  it('oracle age exactly at the staleness ceiling passes', () => {
    const input = baseInput();
    input.market = { ...input.market, oracle: { ...input.market.oracle, ageSeconds: 900 } };
    expectOk(input);
  });

  it('oracle age one second past the ceiling fails', () => {
    const input = baseInput();
    input.market = { ...input.market, oracle: { ...input.market.oracle, ageSeconds: 901 } };
    expectError(input, 'stale');
  });

  it('oracle age of 0 (just-arrived candle) passes', () => {
    const input = baseInput();
    input.market = { ...input.market, oracle: { ...input.market.oracle, ageSeconds: 0 } };
    expectOk(input);
  });

  it('a negative ageSeconds (clock skew) is not flagged as stale by this check (documents current behavior)', () => {
    const input = baseInput();
    input.market = { ...input.market, oracle: { ...input.market.oracle, ageSeconds: -5 } };
    expectOk(input);
  });
});

// ── Malformed policy ─────────────────────────────────────────────────────────────────────────
describe('validation coverage — malformed policy', () => {
  it('unassigned objective (no role) is an error', () => {
    const input = baseInput();
    input.policy = { ...input.policy, objective: 'unassigned' };
    expectError(input, 'No policy/role assigned');
  });

  it('a role objective other than unassigned passes regardless of other policy fields being minimal', () => {
    const input = baseInput();
    input.policy = {
      ...input.policy,
      objective: 'yield',
      riskProfile: 'unspecified',
      spendingLimitPerTrade: null,
      minConfidence: null,
      delegationActive: false,
      confidence: 0.4,
    };
    expectOk(input);
  });
});

// ── System health ────────────────────────────────────────────────────────────────────────────
describe('validation coverage — system health', () => {
  it('oracle unhealthy is an error independent of oracle age', () => {
    const input = baseInput();
    input.system = { ...input.system, oracleHealthy: false };
    expectError(input, 'oracle unhealthy');
  });

  it('scheduler/price-feed down does not by itself fail validation (only oracleHealthy does)', () => {
    const input = baseInput();
    input.system = { ...input.system, schedulerRunning: false, priceFeedRunning: false, executionAvailable: false, agentRunning: false };
    expectOk(input);
  });
});

// ── Multiple simultaneous failures ──────────────────────────────────────────────────────────
describe('validation coverage — multiple simultaneous failures', () => {
  it('accumulates every independent error, not just the first', () => {
    const input = baseInput();
    input.market = { ...input.market, price: NaN, oracle: { ...input.market.oracle, ageSeconds: 1000 } };
    input.capital = { ...input.capital, totalManagedCapital: NaN, deployableCapital: -1, idleCapital: -1 };
    input.policy = { ...input.policy, objective: 'unassigned' };
    input.system = { ...input.system, oracleHealthy: false };
    input.schemaVersion = 'bogus';

    const result = validateAgentContext(input);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(7);
    expect(result.errors.some((e) => e.includes('stale'))).toBe(true);
    expect(result.errors.some((e) => e.includes('Market price'))).toBe(true);
    expect(result.errors.some((e) => e.includes('Managed capital did not load'))).toBe(true);
    expect(result.errors.some((e) => e.includes('Deployable capital'))).toBe(true);
    expect(result.errors.some((e) => e.includes('Idle capital'))).toBe(true);
    expect(result.errors.some((e) => e.includes('No policy/role assigned'))).toBe(true);
    expect(result.errors.some((e) => e.includes('oracle unhealthy'))).toBe(true);
    expect(result.errors.some((e) => e.includes('schema version'))).toBe(true);
  });
});

// ── End-to-end: scenarios that only surface through real domain builders ───────────────────
describe('validation coverage — end-to-end via buildAgentContext', () => {
  async function withMockedMarket(fn: () => Promise<void>) {
    vi.doMock('../decisionEngine.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../decisionEngine.js')>();
      return { ...actual, buildMarketContext: vi.fn().mockResolvedValue(makeMarketContext()) };
    });
    await fn();
  }

  it('invalid managed capital (non-numeric capital field) fails end to end with correct status/quality', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GVAL1', role: 'strategic', capital: 'not-a-number' });

      const ctx = await buildAgentContext(agent.id);
      expect(ctx!.status).toBe('invalid');
      expect(ctx!.validation.ok).toBe(false);
      expect(ctx!.validation.errors).toContain('Managed capital did not load');
      expect(Number.isFinite(ctx!.capital.totalManagedCapital)).toBe(false);
      expect(ctx!.quality.level).not.toBe('high');
      // Health/system domain is unaffected by a bad capital field — independent signals.
      expect(ctx!.system.oracleHealthy).toBe(true);
    });
  });

  it('malformed policy config (invalid JSON) degrades policy confidence but does not itself invalidate the context', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GVAL2', role: 'strategic', strategy_config_json: '{not valid json' });

      const ctx = await buildAgentContext(agent.id);
      expect(ctx!.policy.confidence).toBeLessThan(1);
      // Falls back to the feature-set pair for allowedAssets when config didn't parse.
      expect(ctx!.policy.allowedAssets).toEqual(['XLM', 'USDC']);
      expect(ctx!.status).toBe('valid');
    });
  });

  it('malformed policy config (wrong "type" field) is treated the same as absent config', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, {
        owner: 'GVAL3',
        role: 'strategic',
        strategy_config_json: JSON.stringify({ type: 'strategy', pair: 'XLM/USDC' }),
      });

      const ctx = await buildAgentContext(agent.id);
      expect(ctx!.policy.spendingLimitPerTrade).toBeNull();
      expect(ctx!.policy.minConfidence).toBeNull();
      expect(ctx!.policy.confidence).toBeLessThan(1);
    });
  });

  it('duplicate protocol positions (data-integrity anomaly) never crash context assembly or corrupt quality', async () => {
    vi.doMock('../protocolPositionService.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../protocolPositionService.js')>();
      const dup = {
        id: 'dup',
        agent_id: 'any',
        owner: 'any',
        protocol_id: 'blend' as const,
        kind: 'lend' as const,
        asset: 'XLM',
        amount: '50',
        updated_at: Date.now(),
        created_at: Date.now(),
      };
      return { ...actual, listProtocolPositionsForAgent: vi.fn().mockReturnValue([dup, dup, dup]) };
    });
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GVAL4', role: 'yield' });

      const ctx = await buildAgentContext(agent.id);
      expect(ctx!.capital.protocolExposure).toHaveLength(3);
      expect(Number.isFinite(ctx!.quality.score)).toBe(true);
      expect(ctx!.quality.score).toBeGreaterThanOrEqual(0);
      expect(ctx!.quality.score).toBeLessThanOrEqual(1);
    });
  });

  it('empty/zero-value portfolio (brand-new agent, no capital deployed) never crashes and never leaks NaN/Infinity — FINDING: the allocation-sum check marks it invalid', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GVAL5', role: 'strategic', capital: '0' });

      const ctx = await buildAgentContext(agent.id);
      expect(ctx).not.toBeNull();
      expect(Number.isFinite(ctx!.capital.totalManagedCapital)).toBe(true);
      expect(ctx!.capital.totalManagedCapital).toBe(0);
      expect(ctx!.capital.deployableCapital).toBeGreaterThanOrEqual(0);
      // FINDING: a brand-new agent with zero capital has xlmPct=0 and usdcPct=0 (portfolioService's
      // totalValue fallback of 1 with zero xlm/usdc value produces 0/1=0 for both legs), which sums
      // to 0 — outside the allocation-consistency check's ~100 tolerance. So an empty portfolio is
      // marked 'invalid' by validation, not because anything is corrupt, but because the "should
      // sum to ~100" assumption doesn't hold at exactly zero. Documented here, not fixed (no
      // validation redesign in scope) — every value involved is still finite/non-negative/quality
      // is still well-formed, so nothing crashes or produces undefined behavior.
      expect(ctx!.capital.allocation.xlmPct + ctx!.capital.allocation.usdcPct).toBe(0);
      expect(ctx!.status).toBe('invalid');
      expect(ctx!.validation.errors.some((e) => e.includes('inconsistent'))).toBe(true);
      expect(Number.isFinite(ctx!.quality.score)).toBe(true);
    });
  });

  it('corrupted confidence on every domain simultaneously is clamped everywhere, never NaN/Infinity in quality', async () => {
    vi.doMock('../agentContext/domains/marketContext.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../agentContext/domains/marketContext.js')>();
      return { ...actual, buildMarketContextView: (...args: Parameters<typeof actual.buildMarketContextView>) => ({ ...actual.buildMarketContextView(...args), confidence: NaN }) };
    });
    vi.doMock('../agentContext/domains/capitalContext.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../agentContext/domains/capitalContext.js')>();
      return { ...actual, buildManagedCapitalContextView: (...args: Parameters<typeof actual.buildManagedCapitalContextView>) => ({ ...actual.buildManagedCapitalContextView(...args), confidence: NaN }) };
    });
    vi.doMock('../agentContext/domains/policyContext.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../agentContext/domains/policyContext.js')>();
      return { ...actual, buildPolicyContextView: (...args: Parameters<typeof actual.buildPolicyContextView>) => ({ ...actual.buildPolicyContextView(...args), confidence: NaN }) };
    });
    vi.doMock('../agentContext/domains/systemContext.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../agentContext/domains/systemContext.js')>();
      return { ...actual, buildSystemContextView: (...args: Parameters<typeof actual.buildSystemContextView>) => ({ ...actual.buildSystemContextView(...args), confidence: NaN }) };
    });
    vi.doMock('../agentContext/domains/historicalContext.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../agentContext/domains/historicalContext.js')>();
      return { ...actual, buildHistoricalContextView: (...args: Parameters<typeof actual.buildHistoricalContextView>) => ({ ...actual.buildHistoricalContextView(...args), confidence: NaN }) };
    });
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GVAL6', role: 'strategic', capital: '500' });

      const ctx = await buildAgentContext(agent.id);
      // Clamping happens where the aggregate is computed (quality.domainConfidence), not by
      // mutating each domain's own raw `confidence` field — the domain view itself still reports
      // whatever (possibly corrupt) value its builder produced.
      for (const domain of ['market', 'capital', 'policy', 'system', 'historical'] as const) {
        expect(Number.isNaN(ctx![domain].confidence)).toBe(true);
        expect(ctx!.quality.domainConfidence[domain]).toBe(0);
      }
      expect(Number.isFinite(ctx!.quality.score)).toBe(true);
      expect(ctx!.quality.score).toBe(0);
      expect(ctx!.quality.level).toBe('low');
    });
  });

  it('corrupted quality score inputs (Infinity confidence) still yield a finite, bounded quality.score', async () => {
    vi.doMock('../agentContext/domains/marketContext.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../agentContext/domains/marketContext.js')>();
      return {
        ...actual,
        buildMarketContextView: (...args: Parameters<typeof actual.buildMarketContextView>) => ({
          ...actual.buildMarketContextView(...args),
          confidence: Infinity,
        }),
      };
    });
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GVAL7', role: 'strategic', capital: '500' });

      const ctx = await buildAgentContext(agent.id);
      expect(ctx!.quality.domainConfidence.market).toBe(0);
      expect(Number.isFinite(ctx!.quality.score)).toBe(true);
      expect(ctx!.quality.score).toBeGreaterThanOrEqual(0);
      expect(ctx!.quality.score).toBeLessThanOrEqual(1);
    });
  });
});
