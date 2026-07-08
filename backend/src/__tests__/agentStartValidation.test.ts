// Regression tests for the unified live-agent start gate (validateStartPrerequisites).
// Money flows User Wallet -> Smart Wallet -> Delegation -> Agent -> Protocols, so the agent's
// own account balance is never checked here — only the Smart Wallet's. One gate covers every
// StrategyConfig type (dca/quant/limit/role); paper mode bypasses it entirely.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { newDb } from 'pg-mem';

let tmpDir: string;

function freshPgPool() {
  const mem = newDb();
  const adapter = mem.adapters.createPg();
  return new adapter.Pool();
}

vi.mock('../kairos.js', () => ({
  getKairosClient: vi.fn(),
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'kairos-agent-start-test-'));
  process.env.AGENTS_DB_PATH = path.join(tmpDir, 'agents.db');
  vi.clearAllMocks();
  vi.resetModules();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const OWNER = 'GOWNERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const SMART_WALLET = 'CSMARTWALLETAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const ROLE_STRATEGY = {
  type: 'role' as const,
  role: 'yield' as const,
  pair: 'XLM/USDC',
  amountPerTrade: '30000000',
  intervalSeconds: 120,
  minConfidence: 0.55,
  destination: 'placeholder',
};

async function setup(balance: bigint) {
  const { setPoolFactory } = await import('../smartWalletsDb.js');
  setPoolFactory(freshPgPool as any);

  const { getKairosClient } = await import('../kairos.js');
  vi.mocked(getKairosClient).mockReturnValue({
    networkPassphrase: 'Test SDF Network ; September 2015',
    wallet: { balance: vi.fn().mockResolvedValue(balance) },
  } as any);

  const { getDb } = await import('../db.js');
  const { insertAgent } = await import('./fixtures.js');
  const agentService = await import('../agentService.js');
  const smartWalletsDb = await import('../smartWalletsDb.js');
  const db = await import('../db.js');

  return { getDb, insertAgent, agentService, smartWalletsDb, db };
}

describe('validateStartPrerequisites / startAgent (live mode)', () => {
  it('rejects when no Smart Wallet is attached to the agent at all', async () => {
    const { getDb, insertAgent, agentService } = await setup(100n);
    const db = getDb();
    const row = insertAgent(db, {
      owner: OWNER,
      mode: 'live',
      status: 'new',
      delegator: null,
      strategy: 'role',
      strategy_config_json: JSON.stringify(ROLE_STRATEGY),
    });

    await expect(agentService.startAgent(row.id)).rejects.toThrow(/Smart Wallet/i);
    expect(agentService.getAgentRow(row.id)!.status).toBe('new');
  });

  it('rejects when the delegator address is not a registered Smart Wallet for this owner', async () => {
    const { getDb, insertAgent, agentService } = await setup(100n);
    const db = getDb();
    const row = insertAgent(db, {
      owner: OWNER,
      mode: 'live',
      status: 'new',
      delegator: SMART_WALLET,
      strategy: 'role',
      strategy_config_json: JSON.stringify(ROLE_STRATEGY),
    });
    // Note: no upsertSmartWallet() call — the address is not registered.

    await expect(agentService.startAgent(row.id)).rejects.toThrow(/Smart Wallet not found/i);
    expect(agentService.getAgentRow(row.id)!.status).toBe('new');
  });

  it('rejects when no Delegation exists for this agent', async () => {
    const { getDb, insertAgent, agentService, smartWalletsDb } = await setup(100n);
    await smartWalletsDb.upsertSmartWallet(OWNER, SMART_WALLET, null, 'testnet');
    const db = getDb();
    const row = insertAgent(db, {
      owner: OWNER,
      mode: 'live',
      status: 'new',
      delegator: SMART_WALLET,
      strategy: 'role',
      strategy_config_json: JSON.stringify(ROLE_STRATEGY),
    });
    // Note: no upsertWalletDelegation() call.

    await expect(agentService.startAgent(row.id)).rejects.toThrow(/No delegation found/i);
    expect(agentService.getAgentRow(row.id)!.status).toBe('new');
  });

  it('rejects when the Delegation exists but is disabled/inactive', async () => {
    const { getDb, insertAgent, agentService, db } = await setup(100n);
    const sqlite = getDb();
    const row = insertAgent(sqlite, {
      owner: OWNER,
      mode: 'live',
      status: 'new',
      delegator: SMART_WALLET,
      strategy: 'role',
      strategy_config_json: JSON.stringify(ROLE_STRATEGY),
    });
    await (await import('../smartWalletsDb.js')).upsertSmartWallet(OWNER, SMART_WALLET, null, 'testnet');
    db.upsertWalletDelegation(SMART_WALLET, row.public_key, 'hash123', JSON.stringify({ delegate: row.public_key, delegator: SMART_WALLET }));
    db.setWalletDelegationDisabled(SMART_WALLET, row.public_key, true);

    await expect(agentService.startAgent(row.id)).rejects.toThrow(/inactive/i);
    expect(agentService.getAgentRow(row.id)!.status).toBe('new');
  });

  it('rejects when the Smart Wallet balance is empty (0)', async () => {
    const { getDb, insertAgent, agentService, db } = await setup(0n);
    const sqlite = getDb();
    const row = insertAgent(sqlite, {
      owner: OWNER,
      mode: 'live',
      status: 'new',
      delegator: SMART_WALLET,
      strategy: 'role',
      strategy_config_json: JSON.stringify(ROLE_STRATEGY),
    });
    await (await import('../smartWalletsDb.js')).upsertSmartWallet(OWNER, SMART_WALLET, null, 'testnet');
    db.upsertWalletDelegation(SMART_WALLET, row.public_key, 'hash123', JSON.stringify({ delegate: row.public_key, delegator: SMART_WALLET }));

    await expect(agentService.startAgent(row.id)).rejects.toThrow(/no funds/i);
    expect(agentService.getAgentRow(row.id)!.status).toBe('new');
  });

  it('starts successfully when Smart Wallet + active Delegation + funds + configured strategy are all present', async () => {
    const { getDb, insertAgent, agentService, db } = await setup(500_000_000n);
    const sqlite = getDb();
    const row = insertAgent(sqlite, {
      owner: OWNER,
      mode: 'live',
      status: 'new',
      delegator: SMART_WALLET,
      strategy: 'role',
      strategy_config_json: JSON.stringify(ROLE_STRATEGY),
    });
    await (await import('../smartWalletsDb.js')).upsertSmartWallet(OWNER, SMART_WALLET, null, 'testnet');
    db.upsertWalletDelegation(SMART_WALLET, row.public_key, 'hash123', JSON.stringify({ delegate: row.public_key, delegator: SMART_WALLET }));

    const started = await agentService.startAgent(row.id);
    expect(started.status).toBe('running');
  });

  it('applies the same gate uniformly to a dca-strategy agent (no strategy-type special-casing)', async () => {
    const { getDb, insertAgent, agentService } = await setup(100n);
    const sqlite = getDb();
    const row = insertAgent(sqlite, {
      owner: OWNER,
      mode: 'live',
      status: 'new',
      delegator: null,
      strategy: 'dca',
      strategy_config_json: JSON.stringify({ type: 'dca', token: 'native', amountPerTick: '10000000', intervalSeconds: 3600, destination: 'x' }),
    });

    await expect(agentService.startAgent(row.id)).rejects.toThrow(/Smart Wallet/i);
  });

  it('does not run prerequisite validation for paper mode — starts unconditionally', async () => {
    const { getDb, insertAgent, agentService } = await setup(0n);
    const sqlite = getDb();
    const row = insertAgent(sqlite, {
      owner: OWNER,
      mode: 'paper',
      status: 'new',
      delegator: null,
      strategy: 'role',
      strategy_config_json: JSON.stringify(ROLE_STRATEGY),
    });

    const started = await agentService.startAgent(row.id);
    expect(started.status).toBe('running');
  });
});
