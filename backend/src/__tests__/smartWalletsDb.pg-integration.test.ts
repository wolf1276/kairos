import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { setPoolFactory, listSmartWallets, upsertSmartWallet } from '../smartWalletsDb.js';

// Real-Postgres integration test — only runs when DATABASE_URL points at a live server.
// Skipped entirely otherwise (e.g. local dev, CI without a DB service) so this suite never
// blocks on a missing DB. Everything happens inside a dedicated, dropped-after schema so it
// never touches the `public` schema or any production table.
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('smartWalletsDb (real Postgres integration)', () => {
  const schema = `kairos_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  let adminPool: pg.Pool;

  beforeAll(async () => {
    adminPool = new pg.Pool({ connectionString: DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    // Point smartWalletsDb at a pool scoped to the temp schema via search_path, so its
    // CREATE TABLE IF NOT EXISTS / queries land only inside the throwaway schema.
    setPoolFactory(
      () =>
        new pg.Pool({
          connectionString: DATABASE_URL,
          options: `-c search_path=${schema}`,
        })
    );
  });

  afterAll(async () => {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminPool.end();
  });

  beforeEach(async () => {
    await adminPool.query(`DROP TABLE IF EXISTS "${schema}".smart_wallets`);
    setPoolFactory(
      () =>
        new pg.Pool({
          connectionString: DATABASE_URL,
          options: `-c search_path=${schema}`,
        })
    );
  });

  it('creates a mapping', async () => {
    await upsertSmartWallet('owner-1', 'GADDR1', 'primary', 'testnet');
    const rows = await listSmartWallets('owner-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ owner: 'owner-1', address: 'GADDR1', label: 'primary', network: 'testnet' });
  });

  it('reads a mapping back', async () => {
    await upsertSmartWallet('owner-1', 'GADDR1', 'primary', 'testnet');
    const rows = await listSmartWallets('owner-1');
    expect(rows[0].address).toBe('GADDR1');
  });

  it('prevents duplicates on re-upsert of the same owner/address', async () => {
    await upsertSmartWallet('owner-1', 'GADDR1', 'primary', 'testnet');
    await upsertSmartWallet('owner-1', 'GADDR1', 'primary', 'testnet');
    const rows = await listSmartWallets('owner-1');
    expect(rows).toHaveLength(1);
  });

  it('keeps owners isolated from each other', async () => {
    await upsertSmartWallet('owner-1', 'GADDR1', null, null);
    await upsertSmartWallet('owner-2', 'GADDR2', null, null);
    expect(await listSmartWallets('owner-1')).toHaveLength(1);
    expect(await listSmartWallets('owner-2')).toHaveLength(1);
    expect((await listSmartWallets('owner-1'))[0].address).toBe('GADDR1');
  });

  it('updates label/network on re-upsert instead of duplicating', async () => {
    await upsertSmartWallet('owner-1', 'GADDR1', 'primary', 'testnet');
    await upsertSmartWallet('owner-1', 'GADDR1', 'renamed', 'mainnet');
    const rows = await listSmartWallets('owner-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: 'renamed', network: 'mainnet' });
  });

  it('deletes a mapping', async () => {
    await upsertSmartWallet('owner-1', 'GADDR1', null, null);
    const rawPool = new pg.Pool({ connectionString: DATABASE_URL, options: `-c search_path=${schema}` });
    await rawPool.query('DELETE FROM smart_wallets WHERE owner = $1 AND address = $2', ['owner-1', 'GADDR1']);
    await rawPool.end();
    expect(await listSmartWallets('owner-1')).toEqual([]);
  });

  it('rolls back on failure, leaving no partial row', async () => {
    const rawPool = new pg.Pool({ connectionString: DATABASE_URL, options: `-c search_path=${schema}` });
    const client = await rawPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO smart_wallets (owner, address, label, network, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)`,
        ['owner-rollback', 'GADDR-ROLLBACK', 'temp', null, Date.now()]
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
      await rawPool.end();
    }
    expect(await listSmartWallets('owner-rollback')).toEqual([]);
  });
});
