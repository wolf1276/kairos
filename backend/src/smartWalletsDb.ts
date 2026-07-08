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

function getPool(): pg.Pool {
  if (!pool) pool = poolFactory();
  return pool;
}

async function ensureInitialized(): Promise<void> {
  if (!initialized) {
    initialized = getPool().query(`
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
    `).then(() => undefined);
  }
  await initialized;
}

export async function listSmartWallets(owner: string): Promise<SmartWalletRow[]> {
  await ensureInitialized();
  const res = await getPool().query<SmartWalletRow>(
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
  const now = Date.now();
  await getPool().query(
    `INSERT INTO smart_wallets (owner, address, label, network, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (owner, address) DO UPDATE SET label = $3, network = COALESCE($4, smart_wallets.network), updated_at = $5`,
    [owner, address, label, network, now]
  );

  const verify = await getPool().query<SmartWalletRow>(
    'SELECT owner, address FROM smart_wallets WHERE owner = $1 AND address = $2',
    [owner, address]
  );
  if (verify.rows.length !== 1) {
    throw new Error(`Smart wallet write verification failed for owner=${owner} address=${address}`);
  }
}
