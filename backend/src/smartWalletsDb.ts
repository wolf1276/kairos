import pg from 'pg';
import { getDatabaseUrl } from './config.js';

export interface SmartWalletRow {
  owner: string;
  address: string;
  label: string | null;
  network: string | null;
  created_at: number;
  updated_at: number;
}

let pool: pg.Pool | null = null;
let initialized: Promise<void> | null = null;

/** Overridable by tests to point at pg-mem instead of a real network connection. */
export function setPoolFactory(factory: () => pg.Pool): void {
  poolFactory = factory;
  pool = null;
  initialized = null;
}

let poolFactory: () => pg.Pool = () => new pg.Pool({ connectionString: getDatabaseUrl() });

/**
 * Dev-only fallback so `pnpm dev` works out of the box without a local Postgres: if
 * DATABASE_URL is unset and we're not in production, spin up an in-memory pg-mem instance
 * instead of 503ing every /api/smart-wallets call (previously the only outcome — see
 * backend/.env.example: "Required — there is no SQLite fallback"). Production still requires a
 * real DATABASE_URL; this path is never reached there. Data doesn't survive a restart, same as
 * the message logged below makes explicit.
 */
async function devFallbackPool(): Promise<pg.Pool> {
  let newDb: typeof import('pg-mem').newDb;
  try {
    ({ newDb } = await import('pg-mem'));
  } catch {
    throw new Error(
      'DATABASE_URL is not set and the pg-mem dev fallback (devDependency) is not installed — ' +
        'set DATABASE_URL in backend/.env, or run `pnpm install` (not --prod) for local dev.'
    );
  }
  console.warn(
    '[smartWalletsDb] DATABASE_URL not set — using an in-memory pg-mem store for local dev. ' +
      'Smart wallet registrations will NOT survive a backend restart. Set DATABASE_URL in backend/.env for persistence.'
  );
  const mem = newDb();
  const adapter = mem.adapters.createPg();
  return new adapter.Pool();
}

async function getPool(): Promise<pg.Pool> {
  if (pool) return pool;
  try {
    pool = poolFactory();
  } catch (error) {
    if (process.env.NODE_ENV === 'production') throw error;
    pool = await devFallbackPool();
  }
  return pool;
}

async function ensureInitialized(): Promise<void> {
  if (!initialized) {
    initialized = getPool().then((p) =>
      p
        .query(
          `
      CREATE TABLE IF NOT EXISTS smart_wallets (
        owner TEXT NOT NULL,
        address TEXT NOT NULL,
        label TEXT,
        network TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (owner, address)
      );
      CREATE INDEX IF NOT EXISTS idx_smart_wallets_owner ON smart_wallets(owner);
    `
        )
        .then(() => undefined)
    );
  }
  await initialized;
}

export async function listSmartWallets(owner: string): Promise<SmartWalletRow[]> {
  await ensureInitialized();
  const p = await getPool();
  const res = await p.query<SmartWalletRow>(
    'SELECT owner, address, label, network, created_at, updated_at FROM smart_wallets WHERE owner = $1 ORDER BY created_at ASC',
    [owner]
  );
  return res.rows;
}

/**
 * Idempotent upsert, verified before returning: writes the row, then reads it back to confirm
 * it's actually persisted with the expected address before reporting success. Throws (never
 * silently swallows) if the post-write verification doesn't match, so callers can't report a
 * false success to the client — see backend/src/routes/smartWallets.ts.
 */
export async function upsertSmartWallet(
  owner: string,
  address: string,
  label: string | null,
  network: string | null = null
): Promise<void> {
  await ensureInitialized();
  const p = await getPool();
  const now = Date.now();
  await p.query(
    `INSERT INTO smart_wallets (owner, address, label, network, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (owner, address) DO UPDATE SET label = $3, network = COALESCE($4, smart_wallets.network), updated_at = $5`,
    [owner, address, label, network, now]
  );

  const verify = await p.query<SmartWalletRow>(
    'SELECT owner, address FROM smart_wallets WHERE owner = $1 AND address = $2',
    [owner, address]
  );
  if (verify.rows.length !== 1) {
    throw new Error(`Smart wallet write verification failed for owner=${owner} address=${address}`);
  }
}
