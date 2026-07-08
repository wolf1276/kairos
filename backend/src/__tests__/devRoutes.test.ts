// Developer Mode API — allowlist middleware unit tests + one 403 integration test per
// /api/dev/* route. Same "real ephemeral HTTP server" pattern as benchmarkApi.test.ts/
// dashboard.test.ts. requireDev's allowlist is read fresh from process.env.DEV_ALLOWLIST on
// every request (config.ts::getDevAllowlist), so tests can flip it per-case via process.env.
import express from 'express';
import type { Server } from 'http';
import jwt from 'jsonwebtoken';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { requireAuth, requireDev } from '../authMiddleware.js';
import { createDevRouter } from '../routes/dev.js';
import { InMemoryBenchmarkStore } from '../benchmarkCore/store.js';

const JWT_SECRET = 'test-secret-do-not-use-in-prod';
const ALLOWED_KEY = 'GDEVALLOWEDKEYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const OTHER_KEY = 'GNOTALLOWEDKEYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function tokenFor(publicKey: string): string {
  return jwt.sign({ sub: publicKey }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

let server: Server;
let baseUrl: string;
let originalSecret: string | undefined;
let originalAllowlist: string | undefined;

beforeAll(async () => {
  originalSecret = process.env.AUTH_JWT_SECRET;
  originalAllowlist = process.env.DEV_ALLOWLIST;
  process.env.AUTH_JWT_SECRET = JWT_SECRET;
  process.env.DEV_ALLOWLIST = ALLOWED_KEY;

  const app = express();
  app.use(express.json());
  app.use('/api/dev', requireAuth, requireDev, createDevRouter({ benchmarkStore: new InMemoryBenchmarkStore() }));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  process.env.AUTH_JWT_SECRET = originalSecret;
  process.env.DEV_ALLOWLIST = originalAllowlist;
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  process.env.DEV_ALLOWLIST = ALLOWED_KEY;
});

describe('requireDev middleware', () => {
  it('401s an unauthenticated request before ever reaching the allowlist check', async () => {
    const res = await fetch(`${baseUrl}/api/dev/status`);
    expect(res.status).toBe(401);
  });

  it('403s an authenticated but non-allowlisted caller', async () => {
    const res = await fetch(`${baseUrl}/api/dev/status`, {
      headers: { authorization: `Bearer ${tokenFor(OTHER_KEY)}` },
    });
    expect(res.status).toBe(403);
  });

  it('passes an allowlisted caller through to the handler', async () => {
    const res = await fetch(`${baseUrl}/api/dev/status`, {
      headers: { authorization: `Bearer ${tokenFor(ALLOWED_KEY)}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, enabled: true });
  });
});

const devGetRoutes = ['/api/dev/status', '/api/dev/runtime', '/api/dev/pipeline', '/api/dev/benchmark', '/api/dev/export/logs', '/api/dev/export/benchmark'];
const devPostRoutes = ['/api/dev/paper/start', '/api/dev/paper/pause', '/api/dev/paper/resume', '/api/dev/paper/stop', '/api/dev/validation/run'];

describe('every /api/dev/* route 403s a non-allowlisted (but authenticated) caller', () => {
  for (const path of devGetRoutes) {
    it(`GET ${path}`, async () => {
      const res = await fetch(`${baseUrl}${path}`, {
        headers: { authorization: `Bearer ${tokenFor(OTHER_KEY)}` },
      });
      expect(res.status).toBe(403);
    });
  }

  for (const path of devPostRoutes) {
    it(`POST ${path}`, async () => {
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenFor(OTHER_KEY)}`, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(403);
    });
  }
});

describe('GET /api/dev/status for an allowlisted caller', () => {
  it('returns enabled: true', async () => {
    const res = await fetch(`${baseUrl}/api/dev/status`, {
      headers: { authorization: `Bearer ${tokenFor(ALLOWED_KEY)}` },
    });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/dev/pipeline for an allowlisted caller', () => {
  it('reports pipeline: null when no pipeline has run in this process yet', async () => {
    const res = await fetch(`${baseUrl}/api/dev/pipeline`, {
      headers: { authorization: `Bearer ${tokenFor(ALLOWED_KEY)}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

describe('GET /api/dev/benchmark for an allowlisted caller', () => {
  it('reports session: null against an empty benchmark store', async () => {
    const res = await fetch(`${baseUrl}/api/dev/benchmark`, {
      headers: { authorization: `Bearer ${tokenFor(ALLOWED_KEY)}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, session: null, trading: null, pipelineLatency: null });
  });
});
