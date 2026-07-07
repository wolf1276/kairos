// Real Soroban unsigned-transaction generation for Phoenix — offline unit tests, same mocking
// discipline as `aquariusRealTransactionBuilder.test.ts`/`soroswapRealTransactionBuilder.test.ts`
// (mocks only `rpc.Server.prototype`; everything else is the real `@stellar/stellar-sdk`).
// Source-verified against the real, tagged-release (v2.0.0) phoenix-contracts source — NOT
// live-testnet-verified (no public deployed Phoenix testnet contract address could be found; see
// `protocolAdapters/phoenix/invocation.ts` header for the exact search performed and why this
// stops short of Aquarius's/Soroswap's live-verified bar).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { rpc, Keypair, Account, SorobanDataBuilder } from '@stellar/stellar-sdk';
import { buildRealPhoenixTransaction, verifyUnsignedXdr } from '../protocolAdapters/phoenix/realTransactionBuilder.js';
import type { AssetResolver } from '../protocolAdapters/phoenix/index.js';

const MULTIHOP_CONTRACT_ID = 'CCEHJJXQE4EBFJWB4KNGTZGAYSOVVLEVWZKACA5ZMUPVXA4EHVUJBD5L';
const POOL_CONTRACT_ID = 'CCXO5K2ZCN4JVURRATYOTBIL7BWXWGXNIHLUZ4EIP2UARGDMWY3UYUZX';
const XLM_C = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const USDC_C = 'CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F';
const PHO_C = 'CCABHUCPVFTWD7ND3GCPKJ2YB3HBX6MQYROJFKODHVXQS66BXYGPO634';
const sourceKeypair = Keypair.random();
const sourcePublicKey = sourceKeypair.publicKey();
const assetResolver: AssetResolver = { assetAddresses: { XLM: XLM_C, USDC: USDC_C, PHO: PHO_C } };

function mockAccount(): Account {
  return new Account(sourcePublicKey, '123456789');
}

function mockSuccessfulSimulation() {
  const sorobanData = new SorobanDataBuilder().setResources(1_200_000, 1_800, 500).setResourceFee('55000').build();
  vi.spyOn(rpc.Server.prototype, 'getAccount').mockResolvedValue(mockAccount());
  vi.spyOn(rpc.Server.prototype, 'simulateTransaction').mockResolvedValue({
    _parsed: true,
    latestLedger: 1000,
    events: [],
    transactionData: { build: () => sorobanData } as never,
    minResourceFee: '55000',
    result: { auth: [], retval: {} as never },
    cost: { cpuInsns: '1200000', memBytes: '1800' },
  } as never);
}

function mockFailedSimulation(error: string) {
  vi.spyOn(rpc.Server.prototype, 'getAccount').mockResolvedValue(mockAccount());
  vi.spyOn(rpc.Server.prototype, 'simulateTransaction').mockResolvedValue({ _parsed: true, latestLedger: 1000, events: [], error } as never);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildRealPhoenixTransaction — swap (multihop)', () => {
  it('builds a real, resource-assembled unsigned transaction for a single-hop swap', async () => {
    mockSuccessfulSimulation();
    const detail = await buildRealPhoenixTransaction(MULTIHOP_CONTRACT_ID, 'swap', { path: ['XLM', 'USDC'], amount: '1', minOutput: '0.5', poolType: 'xyk' }, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver });
    expect(detail.success).toBe(true);
    if (!detail.success) return;
    expect(detail.unsignedXdr.length).toBeGreaterThan(0);
    expect(detail.resourceEstimate.cpuInstructions).toBe(1_200_000);
    expect(detail.resourceEstimate.resourceFeeStroops).toBe('55000');
  });

  it('builds a real multi-hop swap (2 hops), the XDR is parseable and invokes the expected contract/function', async () => {
    mockSuccessfulSimulation();
    const detail = await buildRealPhoenixTransaction(MULTIHOP_CONTRACT_ID, 'swap', { path: ['XLM', 'USDC', 'PHO'], amount: '1', minOutput: '0.1', poolType: 'xyk' }, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver });
    if (!detail.success) throw new Error('expected success');
    const verified = verifyUnsignedXdr(detail.unsignedXdr, 'testnet', MULTIHOP_CONTRACT_ID, 'swap');
    expect(verified.ok).toBe(true);
  });

  it('supports the "stable" pool type (real PoolType::Stable = 1 discriminant)', async () => {
    mockSuccessfulSimulation();
    const detail = await buildRealPhoenixTransaction(MULTIHOP_CONTRACT_ID, 'swap', { path: ['XLM', 'USDC'], amount: '1', minOutput: '0', poolType: 'stable' }, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver });
    expect(detail.success).toBe(true);
  });

  it('rejects an unknown pool type before any network call', async () => {
    mockSuccessfulSimulation();
    await expect(
      buildRealPhoenixTransaction(MULTIHOP_CONTRACT_ID, 'swap', { path: ['XLM', 'USDC'], amount: '1', minOutput: '0', poolType: 'blend' }, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver }),
    ).rejects.toThrow(/Unknown Phoenix pool type 'blend'/);
  });

  it('fails closed for an unresolvable asset (invalid route)', async () => {
    mockSuccessfulSimulation();
    await expect(
      buildRealPhoenixTransaction(MULTIHOP_CONTRACT_ID, 'swap', { path: ['XLM', 'DOGE'], amount: '1', minOutput: '0', poolType: 'xyk' }, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver }),
    ).rejects.toThrow(/No address configured for asset 'DOGE'/);
  });

  it('fails closed when Soroban RPC simulation reports failure', async () => {
    mockFailedSimulation('HostError: Error(Contract, #4) — no liquidity pool for pair');
    const detail = await buildRealPhoenixTransaction(MULTIHOP_CONTRACT_ID, 'swap', { path: ['XLM', 'USDC'], amount: '1', minOutput: '0', poolType: 'xyk' }, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver });
    expect(detail.success).toBe(false);
    if (detail.success) return;
    expect(detail.simulationErrors[0]).toContain('no liquidity pool for pair');
  });

  it('RPC unavailable propagates as a rejection, never a silent success', async () => {
    vi.spyOn(rpc.Server.prototype, 'getAccount').mockRejectedValue(new Error('Soroban RPC unavailable'));
    await expect(
      buildRealPhoenixTransaction(MULTIHOP_CONTRACT_ID, 'swap', { path: ['XLM', 'USDC'], amount: '1', minOutput: '0', poolType: 'xyk' }, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver }),
    ).rejects.toThrow('Soroban RPC unavailable');
  });
});

describe('buildRealPhoenixTransaction — withdraw_liquidity (pool)', () => {
  it('builds a real unsigned transaction for withdraw_liquidity', async () => {
    mockSuccessfulSimulation();
    const detail = await buildRealPhoenixTransaction(POOL_CONTRACT_ID, 'withdraw_liquidity', { poolId: POOL_CONTRACT_ID, amount: '10' }, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver });
    expect(detail.success).toBe(true);
    if (!detail.success) return;
    const verified = verifyUnsignedXdr(detail.unsignedXdr, 'testnet', POOL_CONTRACT_ID, 'withdraw_liquidity');
    expect(verified.ok).toBe(true);
  });
});

describe('buildRealPhoenixTransaction — provide_liquidity (pool) — real args-shape gap found during verification', () => {
  it('fails closed when amountB is missing (real pool contract requires BOTH desired_a and desired_b > 0, confirmed from source)', async () => {
    mockSuccessfulSimulation();
    await expect(
      buildRealPhoenixTransaction(POOL_CONTRACT_ID, 'provide_liquidity', { assetA: 'XLM', assetB: 'USDC', amount: '10', amountB: null }, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver }),
    ).rejects.toThrow(/requires params\.amountB/);
  });

  it('succeeds when amountB is supplied', async () => {
    mockSuccessfulSimulation();
    const detail = await buildRealPhoenixTransaction(POOL_CONTRACT_ID, 'provide_liquidity', { assetA: 'XLM', assetB: 'USDC', amount: '10', amountB: '20' }, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver });
    expect(detail.success).toBe(true);
    if (!detail.success) return;
    const verified = verifyUnsignedXdr(detail.unsignedXdr, 'testnet', POOL_CONTRACT_ID, 'provide_liquidity');
    expect(verified.ok).toBe(true);
  });
});

describe('verifyUnsignedXdr — unsigned XDR correctness / security (Phoenix)', () => {
  it('rejects malformed XDR', () => {
    const result = verifyUnsignedXdr('not-real-xdr', 'testnet', MULTIHOP_CONTRACT_ID, 'swap');
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/not a well-formed transaction envelope/);
  });

  it('rejects XDR invoking the wrong contract (substitution attack)', async () => {
    mockSuccessfulSimulation();
    const detail = await buildRealPhoenixTransaction(MULTIHOP_CONTRACT_ID, 'swap', { path: ['XLM', 'USDC'], amount: '1', minOutput: '0', poolType: 'xyk' }, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver });
    if (!detail.success) throw new Error('expected success');
    const verified = verifyUnsignedXdr(detail.unsignedXdr, 'testnet', POOL_CONTRACT_ID, 'swap');
    expect(verified.ok).toBe(false);
    expect(verified.errors[0]).toContain('invalid-contract attack');
  });

  it('rejects XDR invoking the wrong function name (modified-XDR attack)', async () => {
    mockSuccessfulSimulation();
    const detail = await buildRealPhoenixTransaction(MULTIHOP_CONTRACT_ID, 'swap', { path: ['XLM', 'USDC'], amount: '1', minOutput: '0', poolType: 'xyk' }, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver });
    if (!detail.success) throw new Error('expected success');
    const verified = verifyUnsignedXdr(detail.unsignedXdr, 'testnet', MULTIHOP_CONTRACT_ID, 'withdraw_liquidity');
    expect(verified.ok).toBe(false);
    expect(verified.errors[0]).toContain('was expected');
  });
});

describe('replay — two builds against identical mocked simulation produce structurally valid, independently verifiable XDR', () => {
  it('each of two independent calls produces its own valid XDR', async () => {
    mockSuccessfulSimulation();
    const args = { path: ['XLM', 'USDC'], amount: '1', minOutput: '0', poolType: 'xyk' };
    const [a, b] = await Promise.all([
      buildRealPhoenixTransaction(MULTIHOP_CONTRACT_ID, 'swap', args, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver }),
      buildRealPhoenixTransaction(MULTIHOP_CONTRACT_ID, 'swap', args, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver }),
    ]);
    for (const detail of [a, b]) {
      expect(detail.success).toBe(true);
      if (!detail.success) continue;
      expect(verifyUnsignedXdr(detail.unsignedXdr, 'testnet', MULTIHOP_CONTRACT_ID, 'swap').ok).toBe(true);
    }
    // Not asserting exact XDR/hash equality: `swap`/`provide_liquidity`/`withdraw_liquidity`
    // deadlines are `Date.now()`-derived (this codebase's DEPOSIT/WITHDRAW/SWAP args don't carry
    // an explicit deadline field the way Aquarius's/Soroswap's do), so two calls at different
    // wall-clock instants legitimately produce different (still each individually valid) XDR.
  });
});

describe('performance — build/simulate/assemble latency (Phoenix)', () => {
  function percentile(sorted: number[], p: number): number {
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  }

  it('measures avg/P95/P99 latency for buildRealPhoenixTransaction across 100 calls', async () => {
    mockSuccessfulSimulation();
    const durations: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      await buildRealPhoenixTransaction(MULTIHOP_CONTRACT_ID, 'swap', { path: ['XLM', 'USDC'], amount: '1', minOutput: '0', poolType: 'xyk' }, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver });
      durations.push(performance.now() - t0);
    }
    durations.sort((a, b) => a - b);
    const avg = durations.reduce((s, v) => s + v, 0) / durations.length;
    expect(avg).toBeLessThan(50);
    expect(percentile(durations, 95)).toBeLessThan(100);
    expect(percentile(durations, 99)).toBeLessThan(150);
  });
});
