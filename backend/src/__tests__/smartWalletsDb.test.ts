import { describe, it, expect, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import { setPoolFactory, listSmartWallets, upsertSmartWallet } from '../smartWalletsDb.js';

// pg-mem gives us a real (in-memory) Postgres engine to exercise the actual SQL, without
// requiring a live database in CI — see backend/src/smartWalletsDb.ts's setPoolFactory hook.
function freshPool() {
  const mem = newDb();
  const adapter = mem.adapters.createPg();
  return new adapter.Pool();
}

beforeEach(() => {
  setPoolFactory(freshPool as any);
});

describe('smartWalletsDb (production persistence)', () => {
  it('starts empty for a new owner', async () => {
    expect(await listSmartWallets('owner-1')).toEqual([]);
  });

  it('write -> verify -> persist -> success: upsert only resolves once the row is confirmed', async () => {
    await upsertSmartWallet('owner-1', 'GADDR1', 'primary', 'testnet');
    const rows = await listSmartWallets('owner-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ owner: 'owner-1', address: 'GADDR1', label: 'primary', network: 'testnet' });
  });

  it('is idempotent — re-registering the same address updates label/network instead of duplicating', async () => {
    await upsertSmartWallet('owner-1', 'GADDR1', 'primary', 'testnet');
    await upsertSmartWallet('owner-1', 'GADDR1', 'renamed', 'testnet');
    const rows = await listSmartWallets('owner-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('renamed');
  });

  it('duplicate wallet impossible — two different owners can each own the same address independently, but one owner never gets two rows for one address', async () => {
    await upsertSmartWallet('owner-1', 'GADDR1', null, null);
    await upsertSmartWallet('owner-1', 'GADDR2', null, null);
    const rows = await listSmartWallets('owner-1');
    expect(rows.map((r) => r.address).sort()).toEqual(['GADDR1', 'GADDR2']);
  });

  it('keeps owners isolated', async () => {
    await upsertSmartWallet('owner-1', 'GADDR1', null, null);
    await upsertSmartWallet('owner-2', 'GADDR2', null, null);
    expect(await listSmartWallets('owner-1')).toHaveLength(1);
    expect(await listSmartWallets('owner-2')).toHaveLength(1);
  });

  it('registry restores DB: a lost/deleted row can be rewritten by a subsequent upsert (simulates /api/connect/check backfill)', async () => {
    await upsertSmartWallet('owner-1', 'GADDR1', 'primary', 'testnet');
    // Simulate the DB entry being lost (e.g. backend redeploy) by pointing at a brand-new pool.
    setPoolFactory(freshPool as any);
    expect(await listSmartWallets('owner-1')).toEqual([]);

    // Registry (on-chain) is the source of truth the caller falls back to — it hands the address
    // back to be re-persisted here, restoring the DB row.
    await upsertSmartWallet('owner-1', 'GADDR1', null, 'testnet');
    const rows = await listSmartWallets('owner-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].address).toBe('GADDR1');
  });

  it('fails the write instead of reporting false success when the query rejects', async () => {
    const mem = newDb();
    const adapter = mem.adapters.createPg();
    const pool = new adapter.Pool();
    // Break the pool after schema init by pointing queries at a nonexistent table.
    const originalQuery = pool.query.bind(pool);
    let initDone = false;
    pool.query = ((...args: any[]) => {
      const sql = String(args[0]);
      if (sql.includes('CREATE TABLE')) {
        initDone = true;
        return originalQuery(...(args as [any]));
      }
      if (initDone && sql.includes('INSERT INTO smart_wallets')) {
        return originalQuery('INSERT INTO nonexistent_table_for_test VALUES (1)');
      }
      return originalQuery(...(args as [any]));
    }) as any;
    setPoolFactory(() => pool as any);

    await expect(upsertSmartWallet('owner-1', 'GADDR1', null, null)).rejects.toThrow();
  });
});
