// End-to-end integration tests for the Context Layer — real HTTP server, real routing, real
// authMiddleware (real challenge/sign/verify JWT flow), real SQLite DB, real services. The only
// mocked boundary is decisionEngine.buildMarketContext (Horizon/oracle network call) — everything
// else (auth, agent resolution, all five Context domains, validation, quality, hashing, the
// metrics endpoint) runs for real, exercising the exact pipeline a frontend consumer hits:
//
//   HTTP -> auth -> agent resolution -> contextBuilder -> Market/Capital/Policy/System/Historical
//   -> validation -> confidence -> quality -> metadata -> JSON response
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { Keypair } from '@stellar/stellar-sdk';
import { createHash } from 'crypto';
import type { MarketContext } from '../decisionTypes.js';

let tmpDir: string;
let server: http.Server;
let baseUrl: string;

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

/** Exact wire format authService signs against — mirrors challengeMessage()/sep53Digest() there
 *  (private to that module) so a test keypair can produce a signature verifyChallenge() accepts,
 *  exercising the real auth flow instead of forging a JWT directly. */
function sep53Digest(message: string): Buffer {
  return createHash('sha256').update(`Stellar Signed Message:\n${message}`, 'utf8').digest();
}

async function buildTestApp() {
  const { authRouter } = await import('../routes/auth.js');
  const { agentContextRouter, contextMetricsRouter } = await import('../routes/context.js');
  const { requireAuth } = await import('../authMiddleware.js');

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use('/api', requireAuth, contextMetricsRouter);
  app.use('/api/agents', requireAuth, agentContextRouter);
  return app;
}

async function startServer(app: express.Express): Promise<string> {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

/** Real login: POST /challenge, sign the returned message with a real Stellar keypair exactly
 *  like a wallet would (SEP-53 wrapped digest), POST /verify, get back a real signed JWT. */
async function loginAndGetToken(url: string, keypair: Keypair): Promise<string> {
  const publicKey = keypair.publicKey();
  const challengeRes = await fetch(`${url}/api/auth/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publicKey }),
  });
  expect(challengeRes.status).toBe(200);
  const { message } = (await challengeRes.json()) as { message: string };

  const signature = keypair.sign(sep53Digest(message)).toString('base64');

  const verifyRes = await fetch(`${url}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publicKey, signature }),
  });
  expect(verifyRes.status).toBe(200);
  const { token } = (await verifyRes.json()) as { token: string };
  return token;
}

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'kairos-context-e2e-test-'));
  process.env.AGENTS_DB_PATH = path.join(tmpDir, 'agents.db');
  process.env.AUTH_JWT_SECRET = 'e2e-test-secret';
  // Other test files (scheduler.test.ts) set this to a few ms for their own purposes; since
  // process.env is shared across files in the same worker, reset to the real default here so
  // startScheduler() below doesn't tick mid-test against this test's agents/DB.
  delete process.env.SCHEDULER_INTERVAL_MS;
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(tmpDir, { recursive: true, force: true });
});

async function withMockedMarket(marketContext: MarketContext | null | (() => Promise<MarketContext | null>)) {
  vi.doMock('../decisionEngine.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../decisionEngine.js')>();
    const impl = typeof marketContext === 'function' ? marketContext : async () => marketContext;
    return { ...actual, buildMarketContext: vi.fn().mockImplementation(impl) };
  });
}

describe('Context Layer E2E — full HTTP pipeline', () => {
  it('GET /api/agents/:id/context returns 200 with the full pipeline output for an authenticated owner', async () => {
    await withMockedMarket(makeMarketContext());
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');
    const { startScheduler, stopScheduler } = await import('../runner.js');

    const app = await buildTestApp();
    baseUrl = await startServer(app);

    const keypair = Keypair.random();
    const token = await loginAndGetToken(baseUrl, keypair);

    const db = getDb();
    const agent = insertAgent(db, {
      owner: keypair.publicKey(),
      role: 'strategic',
      capital: '1000',
      status: 'running',
      strategy_config_json: JSON.stringify({
        type: 'role',
        role: 'strategic',
        pair: 'XLM/USDC',
        amountPerTrade: '100',
        intervalSeconds: 120,
        minConfidence: 0.5,
        destination: keypair.publicKey(),
      }),
    });

    startScheduler();
    try {
      const res = await fetch(`${baseUrl}/api/agents/${agent.id}/context`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;

      // Response envelope
      expect(body.success).toBe(true);
      expect(body.context).toBeTruthy();
      const ctx = body.context;

      // Metadata
      expect(ctx.meta.version).toBeTruthy();
      expect(typeof ctx.meta.timestamp).toBe('number');
      expect(typeof ctx.meta.marketId).toBe('string');
      expect(typeof ctx.meta.snapshotId).toBe('string');
      expect(ctx.meta.snapshotId).toMatch(/^[0-9a-f-]{36}$/);
      expect(typeof ctx.meta.contextHash).toBe('string');
      expect(ctx.meta.contextHash).toHaveLength(64);

      // Every domain present with a confidence in [0,1]
      for (const domain of ['market', 'capital', 'policy', 'system', 'historical']) {
        expect(ctx[domain]).toBeTruthy();
        expect(ctx[domain].confidence).toBeGreaterThanOrEqual(0);
        expect(ctx[domain].confidence).toBeLessThanOrEqual(1);
      }

      // Validation / status / quality
      expect(ctx.validation).toEqual({ ok: true, errors: [] });
      expect(ctx.status).toBe('valid');
      expect(ctx.quality.level).toBe('high');
      expect(ctx.quality.score).toBeGreaterThan(0);
      expect(ctx.quality.domainConfidence.market).toBe(ctx.market.confidence);

      // Values actually threaded through end to end
      expect(ctx.market.price).toBe(100);
      expect(ctx.capital.totalManagedCapital).toBe(1000);
      expect(ctx.policy.objective).toBe('strategic');
      expect(ctx.system.schedulerRunning).toBe(true);
      expect(ctx.system.agentRunning).toBe(true);
      expect(ctx.system.executionAvailable).toBe(true);
      expect(ctx.owner).toBe(keypair.publicKey());
      expect(ctx.agentId).toBe(agent.id);
    } finally {
      stopScheduler();
    }
  });

  it('rejects with 401 when no Authorization header is sent (never reaches agent resolution)', async () => {
    await withMockedMarket(makeMarketContext());
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');

    const app = await buildTestApp();
    baseUrl = await startServer(app);
    const db = getDb();
    const agent = insertAgent(db, { owner: 'GNOAUTH', role: 'strategic' });

    const res = await fetch(`${baseUrl}/api/agents/${agent.id}/context`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/Missing or malformed Authorization header/);
  });

  it('rejects with 401 when the bearer token is forged/invalid', async () => {
    const app = await buildTestApp();
    baseUrl = await startServer(app);

    const res = await fetch(`${baseUrl}/api/agents/some-agent-id/context`, {
      headers: { authorization: 'Bearer not-a-real-jwt' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects with 403 when the authenticated owner does not own the requested agent', async () => {
    await withMockedMarket(makeMarketContext());
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');

    const app = await buildTestApp();
    baseUrl = await startServer(app);

    const owner = Keypair.random();
    const attacker = Keypair.random();
    const attackerToken = await loginAndGetToken(baseUrl, attacker);

    const db = getDb();
    const agent = insertAgent(db, { owner: owner.publicKey(), role: 'strategic' });

    const res = await fetch(`${baseUrl}/api/agents/${agent.id}/context`, {
      headers: { authorization: `Bearer ${attackerToken}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/Not authorized/);
  });

  it('returns 404 for an agent id that does not exist', async () => {
    const app = await buildTestApp();
    baseUrl = await startServer(app);

    const keypair = Keypair.random();
    const token = await loginAndGetToken(baseUrl, keypair);

    const res = await fetch(`${baseUrl}/api/agents/does-not-exist/context`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 for a malformed pair query parameter', async () => {
    await withMockedMarket(makeMarketContext());
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');

    const app = await buildTestApp();
    baseUrl = await startServer(app);
    const keypair = Keypair.random();
    const token = await loginAndGetToken(baseUrl, keypair);

    const db = getDb();
    const agent = insertAgent(db, { owner: keypair.publicKey(), role: 'strategic' });

    const res = await fetch(`${baseUrl}/api/agents/${agent.id}/context?pair=${encodeURIComponent('../../etc/passwd')}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
  });

  it('returns 503 when the oracle has insufficient candle history (buildMarketContext resolves null)', async () => {
    await withMockedMarket(null);
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');

    const app = await buildTestApp();
    baseUrl = await startServer(app);
    const keypair = Keypair.random();
    const token = await loginAndGetToken(baseUrl, keypair);

    const db = getDb();
    const agent = insertAgent(db, { owner: keypair.publicKey(), role: 'strategic' });

    const res = await fetch(`${baseUrl}/api/agents/${agent.id}/context`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(503);
  });

  it('surfaces validation errors/invalid status end to end for a role-less agent, without leaking internals on a downstream throw', async () => {
    await withMockedMarket(makeMarketContext());
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');

    const app = await buildTestApp();
    baseUrl = await startServer(app);
    const keypair = Keypair.random();
    const token = await loginAndGetToken(baseUrl, keypair);

    const db = getDb();
    const agent = insertAgent(db, { owner: keypair.publicKey(), role: null });

    const res = await fetch(`${baseUrl}/api/agents/${agent.id}/context`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.context.status).toBe('invalid');
    expect(body.context.validation.ok).toBe(false);
    expect(body.context.validation.errors.some((e: string) => e.includes('No policy/role assigned'))).toBe(true);
    expect(body.context.quality.level).not.toBe('high');
  });

  it('returns a generic 500 (no internal detail leaked) when the pipeline throws downstream', async () => {
    await withMockedMarket(async () => {
      throw new Error('Horizon request failed: internal RPC host unreachable at 10.0.0.7');
    });
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');

    const app = await buildTestApp();
    baseUrl = await startServer(app);
    const keypair = Keypair.random();
    const token = await loginAndGetToken(baseUrl, keypair);

    const db = getDb();
    const agent = insertAgent(db, { owner: keypair.publicKey(), role: 'strategic' });

    const res = await fetch(`${baseUrl}/api/agents/${agent.id}/context`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.error).toBe('Failed to build agent context');
    expect(JSON.stringify(body)).not.toMatch(/10\.0\.0\.7|Horizon/);
  });

  it('repeated requests for the same agent return the same contextHash (deterministic over real HTTP)', async () => {
    await withMockedMarket(makeMarketContext());
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');

    const app = await buildTestApp();
    baseUrl = await startServer(app);
    const keypair = Keypair.random();
    const token = await loginAndGetToken(baseUrl, keypair);

    const db = getDb();
    const agent = insertAgent(db, { owner: keypair.publicKey(), role: 'balancer', capital: '750' });

    const headers = { authorization: `Bearer ${token}` };
    const first = await (await fetch(`${baseUrl}/api/agents/${agent.id}/context`, { headers })).json() as any;
    const second = await (await fetch(`${baseUrl}/api/agents/${agent.id}/context`, { headers })).json() as any;

    expect(first.context.meta.contextHash).toBe(second.context.meta.contextHash);
    expect(first.context.meta.snapshotId).not.toBe(second.context.meta.snapshotId);
  });

  it('GET /api/context-metrics is reachable through the real authenticated pipeline and reflects a prior build', async () => {
    await withMockedMarket(makeMarketContext());
    const { getDb } = await import('../db.js');
    const { insertAgent } = await import('./fixtures.js');

    const app = await buildTestApp();
    baseUrl = await startServer(app);
    const keypair = Keypair.random();
    const token = await loginAndGetToken(baseUrl, keypair);

    const db = getDb();
    const agent = insertAgent(db, { owner: keypair.publicKey(), role: 'strategic' });
    const headers = { authorization: `Bearer ${token}` };

    await fetch(`${baseUrl}/api/agents/${agent.id}/context`, { headers });

    const res = await fetch(`${baseUrl}/api/context-metrics`, { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.metrics.contextBuild.count).toBeGreaterThanOrEqual(1);
  });

  it('unauthenticated request to /api/context-metrics is rejected', async () => {
    const app = await buildTestApp();
    baseUrl = await startServer(app);
    const res = await fetch(`${baseUrl}/api/context-metrics`);
    expect(res.status).toBe(401);
  });
});
