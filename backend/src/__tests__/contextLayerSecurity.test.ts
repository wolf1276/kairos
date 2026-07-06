// Security hardening tests for the Context Layer: pair parameter validation, stopped-agent
// context generation, auth edge cases, and cache-provider hardening. No execution paths are
// touched — these tests only verify read/reporting/auth behavior.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import jwt from 'jsonwebtoken';
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
  tmpDir = mkdtempSync(path.join(tmpdir(), 'kairos-context-security-test-'));
  process.env.AGENTS_DB_PATH = path.join(tmpDir, 'agents.db');
  process.env.AUTH_JWT_SECRET = 'test-secret-do-not-use-in-prod';
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

// ── Stopped agent context generation ────────────────────────────────────────────────────────
describe('security — stopped agent context generation', () => {
  it('a stopped agent never reports executionAvailable: true, even when the platform is fully healthy', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');
      const { startScheduler, stopScheduler } = await import('../runner.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GSEC1', role: 'strategic', capital: '1000', status: 'stopped' });

      // Scheduler/oracle are both healthy platform-wide — only this agent's own status differs.
      startScheduler();
      try {
        const ctx = await buildAgentContext(agent.id);
        expect(ctx!.system.agentRunning).toBe(false);
        expect(ctx!.system.executionAvailable).toBe(false);
        expect(ctx!.system.schedulerRunning).toBe(true);
        expect(ctx!.system.oracleHealthy).toBe(true);
      } finally {
        stopScheduler();
      }
    });
  });

  it('a running agent reports executionAvailable: true when the platform is healthy', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');
      const { startScheduler, stopScheduler } = await import('../runner.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GSEC2', role: 'strategic', capital: '1000', status: 'running' });

      startScheduler();
      try {
        const ctx = await buildAgentContext(agent.id);
        expect(ctx!.system.agentRunning).toBe(true);
        expect(ctx!.system.executionAvailable).toBe(true);
      } finally {
        stopScheduler();
      }
    });
  });

  it('an errored agent never reports executionAvailable: true', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');
      const { startScheduler, stopScheduler } = await import('../runner.js');

      const db = getDb();
      const agent = insertAgent(db, { owner: 'GSEC3', role: 'strategic', capital: '1000', status: 'error' });

      startScheduler();
      try {
        const ctx = await buildAgentContext(agent.id);
        expect(ctx!.system.agentRunning).toBe(false);
        expect(ctx!.system.executionAvailable).toBe(false);
      } finally {
        stopScheduler();
      }
    });
  });

  it('context is still readable (not blocked) for a stopped agent — visibility is not execution', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agent = insertAgent(db, {
        owner: 'GSEC4',
        role: 'strategic',
        capital: '1000',
        status: 'stopped',
        strategy_config_json: JSON.stringify({ type: 'role', role: 'strategic', pair: 'XLM/USDC', amountPerTrade: '100', intervalSeconds: 120, minConfidence: 0.5, destination: 'GSEC4' }),
      });

      const ctx = await buildAgentContext(agent.id);
      expect(ctx).not.toBeNull();
      expect(ctx!.status).toBe('valid');
      expect(ctx!.system.executionAvailable).toBe(false);
    });
  });
});

// ── Pair parameter validation ────────────────────────────────────────────────────────────────
describe('security — pair parameter validation', () => {
  function invokeContextHandler(query: Record<string, unknown>) {
    return async (agentId: string, ownerPublicKey: string) => {
      const { agentContextRouter } = await import('../routes/context.js');
      const layer = agentContextRouter.stack.find((l) => l.route?.path === '/:id/context');
      const handler = layer!.route!.stack[0].handle as (req: any, res: any, next: any) => Promise<void>;

      const req: any = { params: { id: agentId }, query, auth: { publicKey: ownerPublicKey } };
      let statusCode = 200;
      let body: unknown;
      const res: any = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(b: unknown) {
          body = b;
        },
      };
      await handler(req, res, () => {});
      return { statusCode, body };
    };
  }

  it('rejects a pair containing path/command-injection-shaped characters', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const db = getDb();
      const agent = insertAgent(db, { owner: 'GSEC6', role: 'strategic' });

      const { statusCode, body } = await invokeContextHandler({ pair: '../../etc/passwd' })(agent.id, 'GSEC6');
      expect(statusCode).toBe(400);
      expect(body).toEqual(expect.objectContaining({ error: expect.stringMatching(/Invalid pair/) }));
    });
  });

  it('rejects an overlong pair string', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const db = getDb();
      const agent = insertAgent(db, { owner: 'GSEC7', role: 'strategic' });

      const { statusCode } = await invokeContextHandler({ pair: 'A'.repeat(500) + '/USDC' })(agent.id, 'GSEC7');
      expect(statusCode).toBe(400);
    });
  });

  it('rejects a pair supplied as a non-string (array/object query injection)', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const db = getDb();
      const agent = insertAgent(db, { owner: 'GSEC8', role: 'strategic' });

      const { statusCode } = await invokeContextHandler({ pair: ['XLM/USDC', 'extra'] })(agent.id, 'GSEC8');
      expect(statusCode).toBe(400);
    });
  });

  it('accepts a well-formed pair and omitting pair entirely', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const db = getDb();
      const agent = insertAgent(db, { owner: 'GSEC9', role: 'strategic' });

      const withPair = await invokeContextHandler({ pair: 'XLM/USDC' })(agent.id, 'GSEC9');
      expect(withPair.statusCode).toBe(200);

      const withoutPair = await invokeContextHandler({})(agent.id, 'GSEC9');
      expect(withoutPair.statusCode).toBe(200);
    });
  });

  it('cacheKey never collides across different (agentId, pair) pairs even when either contains a delimiter-like character', async () => {
    const { cacheKey } = await import('../agentContext/cache/index.js');
    // Old naive `${agentId}:${pair}` concatenation would collide here: 'a:b' + ':' + 'c' ===
    // 'a' + ':' + 'b:c'. The JSON-array-based key must keep these distinct.
    const k1 = cacheKey('a:b', 'c');
    const k2 = cacheKey('a', 'b:c');
    expect(k1).not.toBe(k2);
  });

  it('cacheKey is still a pure/deterministic function of its inputs', async () => {
    const { cacheKey } = await import('../agentContext/cache/index.js');
    expect(cacheKey('agent1', 'XLM/USDC')).toBe(cacheKey('agent1', 'XLM/USDC'));
  });

  it('an unsupported/malformed pair passed through to buildFeatureResult fails closed (throws), never returns a partial context', async () => {
    vi.doMock('../decisionEngine.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../decisionEngine.js')>();
      return {
        ...actual,
        buildMarketContext: vi.fn().mockImplementation(async (pair: string) => {
          if (pair !== 'XLM/USDC') throw new Error(`Unsupported pair: ${pair}`);
          return makeMarketContext();
        }),
      };
    });
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

    const db = getDb();
    const agent = insertAgent(db, { owner: 'GSEC5', role: 'strategic' });

    await expect(buildAgentContext(agent.id, { pair: '../../etc/passwd' })).rejects.toThrow(/Unsupported pair/);
  });
});

// ── Cache provider hardening ─────────────────────────────────────────────────────────────────
describe('security — cache provider hardening', () => {
  it('rejects an incomplete provider (missing a required method) instead of installing it', async () => {
    const { setFeatureCacheProvider, resetFeatureCacheProvider } = await import('../agentContext/cache/index.js');
    const incompleteProvider = {
      async get() {
        return null;
      },
      async set() {},
      // invalidate/clear/size intentionally missing
    } as any;

    expect(() => setFeatureCacheProvider(incompleteProvider)).toThrow(/missing required method/);
    resetFeatureCacheProvider();
  });

  it('a rejected provider swap leaves the previously-installed provider active', async () => {
    const { setFeatureCacheProvider, getFeatureCacheProvider, resetFeatureCacheProvider } = await import('../agentContext/cache/index.js');
    const goodProvider = {
      async get() {
        return null;
      },
      async set() {},
      async invalidate() {},
      async clear() {},
      async size() {
        return 0;
      },
    };
    setFeatureCacheProvider(goodProvider);

    const badProvider = { async get() { return null; } } as any;
    expect(() => setFeatureCacheProvider(badProvider)).toThrow();
    expect(getFeatureCacheProvider()).toBe(goodProvider);

    resetFeatureCacheProvider();
  });

  it('accepts a fully-conformant provider', async () => {
    const { setFeatureCacheProvider, getFeatureCacheProvider, resetFeatureCacheProvider } = await import('../agentContext/cache/index.js');
    const provider = {
      async get() {
        return null;
      },
      async set() {},
      async invalidate() {},
      async clear() {},
      async size() {
        return 0;
      },
    };
    setFeatureCacheProvider(provider);
    expect(getFeatureCacheProvider()).toBe(provider);
    resetFeatureCacheProvider();
  });
});

// ── Auth edge cases ──────────────────────────────────────────────────────────────────────────
describe('security — auth edge cases', () => {
  it('rejects a token signed with a different algorithm than the one the app issues (alg confusion)', async () => {
    const { verifySessionToken } = await import('../authService.js');
    // Simulates an attacker-crafted token using a different (but still HMAC) algorithm than the
    // app's HS256 — verifySessionToken must reject rather than silently accept any algorithm.
    const rogueToken = jwt.sign({ sub: 'GATTACKER' }, 'test-secret-do-not-use-in-prod', { algorithm: 'HS384' });
    expect(() => verifySessionToken(rogueToken)).toThrow();
  });

  it('accepts a token signed with the expected HS256 algorithm', async () => {
    const { verifySessionToken } = await import('../authService.js');
    const token = jwt.sign({ sub: 'GVALIDUSER' }, 'test-secret-do-not-use-in-prod', { algorithm: 'HS256' });
    const result = verifySessionToken(token);
    expect(result.publicKey).toBe('GVALIDUSER');
  });

  it('rejects a token with a non-string sub claim', async () => {
    const { verifySessionToken } = await import('../authService.js');
    const token = jwt.sign({ sub: 12345 as unknown as string }, 'test-secret-do-not-use-in-prod', { algorithm: 'HS256' });
    expect(() => verifySessionToken(token)).toThrow(/Malformed session token/);
  });

  it('rejects an expired token', async () => {
    const { verifySessionToken } = await import('../authService.js');
    const token = jwt.sign({ sub: 'GEXPIRED' }, 'test-secret-do-not-use-in-prod', { algorithm: 'HS256', expiresIn: -10 });
    expect(() => verifySessionToken(token)).toThrow();
  });

  it('rejects a token signed with the wrong secret', async () => {
    const { verifySessionToken } = await import('../authService.js');
    const token = jwt.sign({ sub: 'GFORGED' }, 'wrong-secret', { algorithm: 'HS256' });
    expect(() => verifySessionToken(token)).toThrow();
  });

  it('requireAuth rejects a missing Authorization header', async () => {
    const { requireAuth } = await import('../authMiddleware.js');
    const req: any = { header: () => undefined };
    let statusCode: number | undefined;
    let body: unknown;
    const res: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(b: unknown) {
        body = b;
      },
    };
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(statusCode).toBe(401);
    expect(body).toEqual({ error: 'Missing or malformed Authorization header' });
  });

  it('requireAuth rejects a malformed (non-Bearer) Authorization header', async () => {
    const { requireAuth } = await import('../authMiddleware.js');
    const req: any = { header: () => 'Basic dXNlcjpwYXNz' };
    let statusCode: number | undefined;
    const res: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json() {},
    };
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(statusCode).toBe(401);
  });

  it('requireAuth rejects a syntactically well-formed but invalid token', async () => {
    const { requireAuth } = await import('../authMiddleware.js');
    const req: any = { header: () => 'Bearer not-a-real-jwt' };
    let statusCode: number | undefined;
    const res: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json() {},
    };
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(statusCode).toBe(401);
  });
});

// ── No context leakage across agents/owners ─────────────────────────────────────────────────
describe('security — no context leakage across agents', () => {
  it('two agents owned by different users never share a cached feature result', async () => {
    await withMockedMarket(async () => {
      const { getDb } = await import('../db.js');
      const { insertAgent } = await import('./fixtures.js');
      const { buildAgentContext } = await import('../agentContext/contextBuilder.js');

      const db = getDb();
      const agentA = insertAgent(db, { owner: 'GOWNERX', role: 'strategic', capital: '111' });
      const agentB = insertAgent(db, { owner: 'GOWNERY', role: 'strategic', capital: '222' });

      const ctxA = await buildAgentContext(agentA.id);
      const ctxB = await buildAgentContext(agentB.id);

      expect(ctxA!.capital.totalManagedCapital).toBe(111);
      expect(ctxB!.capital.totalManagedCapital).toBe(222);
      expect(ctxA!.owner).toBe('GOWNERX');
      expect(ctxB!.owner).toBe('GOWNERY');
      expect(ctxA!.agentId).not.toBe(ctxB!.agentId);
    });
  });
});
