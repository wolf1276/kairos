// Real Soroban unsigned-transaction generation — offline unit tests. Mocks only the network
// boundary (`rpc.Server.prototype.getAccount`/`simulateTransaction`) via `vi.spyOn`; everything
// else (operation building, ScVal encoding, transaction assembly, XDR parsing/verification) is
// the real `@stellar/stellar-sdk` doing real work — this is what makes the resulting XDR a
// genuine unsigned Soroban transaction, not a synthetic stand-in. No live network call is made
// anywhere in this file (see `aquariusIntegration.test.ts` for the opt-in live-testnet suite).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { rpc, Keypair, Account, SorobanDataBuilder } from '@stellar/stellar-sdk';
import { buildRealAquariusTransaction, verifyUnsignedXdr } from '../protocolAdapters/aquarius/realTransactionBuilder.js';
import type { AssetPoolRegistry } from '../protocolAdapters/aquarius/index.js';

const ROUTER_CONTRACT_ID = 'CCEHJJXQE4EBFJWB4KNGTZGAYSOVVLEVWZKACA5ZMUPVXA4EHVUJBD5L';
const XLM_ADDRESS = 'CCQ7NUYOGVFE47FQ42WFFLY3QM45ISZC3WDEI7VNOLBEHDOB7JTIAGLO';
const AQUA_ADDRESS = 'CCABHUCPVFTWD7ND3GCPKJ2YB3HBX6MQYROJFKODHVXQS66BXYGPO634';
const POOL_ID = '9ac7a9cde23ac2ada11105eeaa42e43c2ea8332ca0aa8f41f58d7160274d718e';

const sourceKeypair = Keypair.random();
const sourcePublicKey = sourceKeypair.publicKey();

const fakeRegistry: AssetPoolRegistry = {
  async listPools() {
    return [{ poolId: POOL_ID, assetA: 'XLM', assetB: 'AQUA', concentratedLiquidity: false }];
  },
  async resolveAddress(assetCode: string) {
    if (assetCode === 'XLM') return XLM_ADDRESS;
    if (assetCode === 'AQUA') return AQUA_ADDRESS;
    throw new Error(`no fake address for '${assetCode}'`);
  },
  async findPool(assetA: string, assetB: string) {
    if ((assetA === 'XLM' && assetB === 'AQUA') || (assetA === 'AQUA' && assetB === 'XLM')) {
      return { poolId: POOL_ID, assetA: 'XLM', assetB: 'AQUA', concentratedLiquidity: false };
    }
    return null;
  },
  async findPoolByIndex(poolIndex: string) {
    return poolIndex === POOL_ID ? { poolId: POOL_ID, assetA: 'XLM', assetB: 'AQUA', concentratedLiquidity: false } : null;
  },
};

function mockAccount(): Account {
  return new Account(sourcePublicKey, '123456789');
}

function mockSuccessfulSimulation() {
  const sorobanData = new SorobanDataBuilder().setResources(1_500_000, 2_048, 512).setResourceFee('50000').build();
  vi.spyOn(rpc.Server.prototype, 'getAccount').mockResolvedValue(mockAccount());
  vi.spyOn(rpc.Server.prototype, 'simulateTransaction').mockResolvedValue({
    _parsed: true,
    latestLedger: 1000,
    events: [],
    transactionData: { build: () => sorobanData } as never,
    minResourceFee: '50000',
    result: { auth: [], retval: {} as never },
    cost: { cpuInsns: '1500000', memBytes: '2048' },
  } as never);
}

function mockFailedSimulation(error: string) {
  vi.spyOn(rpc.Server.prototype, 'getAccount').mockResolvedValue(mockAccount());
  vi.spyOn(rpc.Server.prototype, 'simulateTransaction').mockResolvedValue({
    latestLedger: 1000,
    events: [],
    error,
  } as never);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildRealAquariusTransaction — real unsigned XDR generation', () => {
  it('builds a real, resource-assembled unsigned transaction for a SWAP_CHAINED call', async () => {
    mockSuccessfulSimulation();
    const detail = await buildRealAquariusTransaction(
      ROUTER_CONTRACT_ID,
      'swap_chained',
      { path: ['XLM', 'AQUA'], amount: '1', minOutput: '0' },
      'testnet',
      { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, registry: fakeRegistry },
    );
    expect(detail.success).toBe(true);
    if (!detail.success) return;
    expect(typeof detail.unsignedXdr).toBe('string');
    expect(detail.unsignedXdr.length).toBeGreaterThan(0);
    expect(detail.resourceEstimate.cpuInstructions).toBe(1_500_000);
    expect(detail.resourceEstimate.diskReadBytes).toBe(2_048);
    expect(detail.resourceEstimate.writeBytes).toBe(512);
    expect(detail.resourceEstimate.resourceFeeStroops).toBe('50000');
  });

  it('the generated XDR is a real, parseable Soroban transaction invoking the expected contract/function', async () => {
    mockSuccessfulSimulation();
    const detail = await buildRealAquariusTransaction(ROUTER_CONTRACT_ID, 'swap_chained', { path: ['XLM', 'AQUA'], amount: '1', minOutput: '0' }, 'testnet', {
      rpcUrl: 'https://fake-rpc.example',
      sourceAccountPublicKey: sourcePublicKey,
      registry: fakeRegistry,
    });
    if (!detail.success) throw new Error('expected success');
    const verified = verifyUnsignedXdr(detail.unsignedXdr, 'testnet', ROUTER_CONTRACT_ID, 'swap_chained');
    expect(verified.ok).toBe(true);
    expect(verified.errors).toEqual([]);
  });

  it('fails closed when Soroban RPC simulation reports failure (invalid contract/asset, insufficient trustline, etc.)', async () => {
    mockFailedSimulation('HostError: Error(Contract, #8) — trustline not found');
    const detail = await buildRealAquariusTransaction(ROUTER_CONTRACT_ID, 'swap_chained', { path: ['XLM', 'AQUA'], amount: '1', minOutput: '0' }, 'testnet', {
      rpcUrl: 'https://fake-rpc.example',
      sourceAccountPublicKey: sourcePublicKey,
      registry: fakeRegistry,
    });
    expect(detail.success).toBe(false);
    if (detail.success) return;
    expect(detail.simulationErrors[0]).toContain('trustline not found');
  });

  it('fails closed for an unresolvable asset (invalid asset attack surface)', async () => {
    mockSuccessfulSimulation();
    await expect(
      buildRealAquariusTransaction(ROUTER_CONTRACT_ID, 'swap_chained', { path: ['XLM', 'DOGE'], amount: '1', minOutput: '0' }, 'testnet', {
        rpcUrl: 'https://fake-rpc.example',
        sourceAccountPublicKey: sourcePublicKey,
        registry: fakeRegistry,
      }),
    ).rejects.toThrow(/no fake address for 'DOGE'/);
  });

  it('RPC unavailable (getAccount throws) propagates as a rejection, never a silent success', async () => {
    vi.spyOn(rpc.Server.prototype, 'getAccount').mockRejectedValue(new Error('Soroban RPC unavailable'));
    await expect(
      buildRealAquariusTransaction(ROUTER_CONTRACT_ID, 'swap_chained', { path: ['XLM', 'AQUA'], amount: '1', minOutput: '0' }, 'testnet', {
        rpcUrl: 'https://fake-rpc.example',
        sourceAccountPublicKey: sourcePublicKey,
        registry: fakeRegistry,
      }),
    ).rejects.toThrow('Soroban RPC unavailable');
  });
});

describe('verifyUnsignedXdr — unsigned XDR correctness / security', () => {
  it('rejects malformed XDR (not a valid transaction envelope)', () => {
    const result = verifyUnsignedXdr('not-real-xdr-at-all', 'testnet', ROUTER_CONTRACT_ID, 'swap_chained');
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/not a well-formed transaction envelope/);
  });

  it('rejects XDR invoking the wrong contract (invalid-contract / substitution attack)', async () => {
    mockSuccessfulSimulation();
    const detail = await buildRealAquariusTransaction(ROUTER_CONTRACT_ID, 'swap_chained', { path: ['XLM', 'AQUA'], amount: '1', minOutput: '0' }, 'testnet', {
      rpcUrl: 'https://fake-rpc.example',
      sourceAccountPublicKey: sourcePublicKey,
      registry: fakeRegistry,
    });
    if (!detail.success) throw new Error('expected success');
    const wrongContractId = 'CCXO5K2ZCN4JVURRATYOTBIL7BWXWGXNIHLUZ4EIP2UARGDMWY3UYUZX';
    const verified = verifyUnsignedXdr(detail.unsignedXdr, 'testnet', wrongContractId, 'swap_chained');
    expect(verified.ok).toBe(false);
    expect(verified.errors[0]).toMatch(/possible invalid-contract attack/);
  });

  it('rejects XDR invoking the wrong function name (modified-XDR attack)', async () => {
    mockSuccessfulSimulation();
    const detail = await buildRealAquariusTransaction(ROUTER_CONTRACT_ID, 'swap_chained', { path: ['XLM', 'AQUA'], amount: '1', minOutput: '0' }, 'testnet', {
      rpcUrl: 'https://fake-rpc.example',
      sourceAccountPublicKey: sourcePublicKey,
      registry: fakeRegistry,
    });
    if (!detail.success) throw new Error('expected success');
    const verified = verifyUnsignedXdr(detail.unsignedXdr, 'testnet', ROUTER_CONTRACT_ID, 'claim_rewards');
    expect(verified.ok).toBe(false);
    expect(verified.errors[0]).toContain("was expected");
  });
});

// ── Performance (mocked RPC — measures the real ScVal/XDR/assembly pipeline's own overhead,
// not network latency, which is out of this suite's control by design — offline/hermetic) ──────

describe('performance — build/simulate/assemble latency', () => {
  function percentile(sorted: number[], p: number): number {
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  }

  it('measures avg/P95/P99 latency for buildRealAquariusTransaction across 100 calls', async () => {
    mockSuccessfulSimulation();
    const durations: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      await buildRealAquariusTransaction(ROUTER_CONTRACT_ID, 'swap_chained', { path: ['XLM', 'AQUA'], amount: '1', minOutput: '0' }, 'testnet', {
        rpcUrl: 'https://fake-rpc.example',
        sourceAccountPublicKey: sourcePublicKey,
        registry: fakeRegistry,
      });
      durations.push(performance.now() - t0);
    }
    durations.sort((a, b) => a - b);
    const avg = durations.reduce((s, v) => s + v, 0) / durations.length;
    expect(avg).toBeLessThan(50);
    expect(percentile(durations, 95)).toBeLessThan(100);
    expect(percentile(durations, 99)).toBeLessThan(150);
  });
});
