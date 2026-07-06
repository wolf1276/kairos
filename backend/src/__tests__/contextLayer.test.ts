// Context Layer tests: the five domain builders, validation gate, and full AgentContext
// assembly (hash/snapshot reproducibility, invalid-context rejection semantics).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { MarketContext } from '../decisionTypes.js';

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
  tmpDir = mkdtempSync(path.join(tmpdir(), 'kairos-context-layer-test-'));
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

describe('AgentContext — full assembly', () => {
  it('builds a valid context for a fully-configured role agent', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');
      const { startScheduler, stopScheduler } = await import('../runner.js');

      const db = getDb();
      const agent = insertAgent(db, {
        owner: 'GCTX1',
        role: 'strategic',
        capital: '1000',
        // Stopped so the scheduler tick (started below just to prove schedulerRunning=true in
        // System Context) doesn't also try to run this agent's real tick, which needs a Turnkey/
        // Horizon-backed owner this test doesn't set up.
        status: 'stopped',
        strategy_config_json: JSON.stringify({ type: 'role', role: 'strategic', pair: 'XLM/USDC', amountPerTrade: '100', intervalSeconds: 120, minConfidence: 0.5, destination: 'GCTX1' }),
      });

      startScheduler();
      try {
        const ctx = await buildAgentContext(agent.id);
        expect(ctx).not.toBeNull();
        expect(ctx!.status).toBe('valid');
        expect(ctx!.validation.errors).toEqual([]);
        expect(ctx!.market.price).toBe(100);
        expect(ctx!.capital.totalManagedCapital).toBe(1000);
        expect(ctx!.policy.objective).toBe('strategic');
        expect(ctx!.policy.allowedAssets).toEqual(['XLM', 'USDC']);
        expect(ctx!.system.schedulerRunning).toBe(true);
        expect(ctx!.historical.lastExecution).toBeNull();
        expect(ctx!.meta.snapshotId).toBeTruthy();
        expect(ctx!.meta.contextHash).toHaveLength(64);
      } finally {
        stopScheduler();
      }
    });
  });

  it('marks context invalid when the agent has no role/policy assigned', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GCTX2', role: null });

      const ctx = await buildAgentContext(agent.id);
      expect(ctx!.status).toBe('invalid');
      expect(ctx!.validation.errors.some((e) => e.includes('No policy/role assigned'))).toBe(true);
      // status must be derived from validation.errors, never disagree with it.
      expect(ctx!.status).toBe(ctx!.validation.errors.length === 0 ? 'valid' : 'invalid');
      expect(ctx!.policy.confidence).toBeLessThan(1);
    });
  });

  it('marks context invalid when the oracle is stale', async () => {
    vi.doMock('../decisionEngine.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../decisionEngine.js')>();
      const staleCandles = makeCandles(60).map((c, i) => ({ ...c, time: Date.now() - 10_000_000 + i }));
      return { ...actual, buildMarketContext: vi.fn().mockResolvedValue(makeMarketContext({ candles: staleCandles })) };
    });
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GCTX3', role: 'yield' });

    const ctx = await buildAgentContext(agent.id);
    expect(ctx!.status).toBe('invalid');
    expect(ctx!.status).toBe(ctx!.validation.errors.length === 0 ? 'valid' : 'invalid');
    expect(ctx!.system.oracleHealthy).toBe(false);
    expect(ctx!.validation.errors.some((e) => e.includes('stale'))).toBe(true);
    expect(ctx!.market.confidence).toBe(0);
    expect(ctx!.quality.level).not.toBe('high');
  });

  it('exposes a per-domain confidence and an aggregate context quality', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');
      const { startScheduler, stopScheduler } = await import('../runner.js');

      const db = getDb();
      const agent = insertAgent(db, {
        owner: 'GCTX6',
        role: 'yield',
        status: 'stopped',
        capital: '1000',
        strategy_config_json: JSON.stringify({ type: 'role', role: 'yield', pair: 'XLM/USDC', amountPerTrade: '50', intervalSeconds: 120, minConfidence: 0.5, destination: 'GCTX6' }),
      });

      startScheduler();
      try {
        const ctx = await buildAgentContext(agent.id);
        for (const domain of ['market', 'capital', 'policy', 'system', 'historical'] as const) {
          expect(ctx![domain].confidence).toBeGreaterThanOrEqual(0);
          expect(ctx![domain].confidence).toBeLessThanOrEqual(1);
        }
        const expectedScore =
          (ctx!.market.confidence + ctx!.capital.confidence + ctx!.policy.confidence + ctx!.system.confidence + ctx!.historical.confidence) / 5;
        expect(ctx!.quality.score).toBeCloseTo(expectedScore, 10);
        expect(ctx!.quality.domainConfidence.market).toBe(ctx!.market.confidence);
        expect(['high', 'medium', 'low']).toContain(ctx!.quality.level);
      } finally {
        stopScheduler();
      }
    });
  });

  it('produces the same contextHash for two builds of the same underlying snapshot, taken apart in wall-clock time', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GCTX4', role: 'balancer', capital: '500' });

      const first = await buildAgentContext(agent.id);
      await new Promise((r) => setTimeout(r, 5));
      const second = await buildAgentContext(agent.id, { forceRefresh: true });

      expect(first!.meta.contextHash).toBe(second!.meta.contextHash);
      expect(first!.meta.snapshotId).not.toBe(second!.meta.snapshotId);
    });
  });

  it('never exposes wallet addresses/contract ids in the Managed Capital or Policy views', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GCTX5', role: 'yield', delegator: 'GSMARTWALLETADDR' });

      const ctx = await buildAgentContext(agent.id);
      const capitalJson = JSON.stringify(ctx!.capital);
      const policyJson = JSON.stringify(ctx!.policy);
      expect(capitalJson).not.toContain('GSMARTWALLETADDR');
      expect(policyJson).not.toContain('GSMARTWALLETADDR');
    });
  });
});
