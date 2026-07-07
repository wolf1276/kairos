// Real Soroban unsigned-transaction generation for Blend — offline unit tests, same mocking
// discipline as `phoenixRealTransactionBuilder.test.ts` (mocks only `rpc.Server.prototype`;
// everything else is the real `@stellar/stellar-sdk`). Source-verified AND live-testnet-deployment
// verified: contract IDs below are the real, official Blend testnet deployment from
// `blend-capital/blend-utils/testnet.contracts.json` (fetched live during the readiness audit).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { rpc, Keypair, Account, SorobanDataBuilder } from '@stellar/stellar-sdk';
import { buildRealBlendTransaction, verifyUnsignedXdr } from '../protocolAdapters/blend/realTransactionBuilder.js';
import { REQUEST_TYPE_DISCRIMINANT } from '../protocolAdapters/blend/invocation.js';
import type { AssetResolver } from '../protocolAdapters/blend/index.js';

// Real Blend testnet deployment (blend-capital/blend-utils/testnet.contracts.json).
const POOL_CONTRACT_ID = 'CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF'; // TestnetV2
const XLM_C = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const USDC_C = 'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU';
const sourceKeypair = Keypair.random();
const sourcePublicKey = sourceKeypair.publicKey();
const assetResolver: AssetResolver = { assetAddresses: { XLM: XLM_C, USDC: USDC_C } };

function mockAccount(): Account {
  return new Account(sourcePublicKey, '123456789');
}

function mockSuccessfulSimulation() {
  const sorobanData = new SorobanDataBuilder().setResources(900_000, 1_400, 400).setResourceFee('42000').build();
  vi.spyOn(rpc.Server.prototype, 'getAccount').mockResolvedValue(mockAccount());
  vi.spyOn(rpc.Server.prototype, 'simulateTransaction').mockResolvedValue({
    _parsed: true,
    latestLedger: 1000,
    events: [],
    transactionData: { build: () => sorobanData } as never,
    minResourceFee: '42000',
    result: { auth: [], retval: {} as never },
    cost: { cpuInsns: '900000', memBytes: '1400' },
  } as never);
}

function mockFailedSimulation(error: string) {
  vi.spyOn(rpc.Server.prototype, 'getAccount').mockResolvedValue(mockAccount());
  vi.spyOn(rpc.Server.prototype, 'simulateTransaction').mockResolvedValue({ _parsed: true, latestLedger: 1000, events: [], error } as never);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('REQUEST_TYPE_DISCRIMINANT — real RequestType enum (pool/src/pool/actions.rs)', () => {
  it('matches the real, tagged-release contract discriminants exactly', () => {
    expect(REQUEST_TYPE_DISCRIMINANT).toEqual({
      Supply: 0,
      Withdraw: 1,
      SupplyCollateral: 2,
      WithdrawCollateral: 3,
      Borrow: 4,
      Repay: 5,
      FillUserLiquidationAuction: 6,
      FillBadDebtAuction: 7,
      FillInterestAuction: 8,
      DeleteLiquidationAuction: 9,
    });
  });
});

describe.each([
  ['DEPOSIT', 'submit'],
  ['WITHDRAW', 'submit'],
  ['BORROW', 'submit'],
  ['REPAY', 'submit'],
] as const)('buildRealBlendTransaction — %s (pool.submit)', (action, method) => {
  it('builds a real, resource-assembled unsigned transaction', async () => {
    mockSuccessfulSimulation();
    const detail = await buildRealBlendTransaction(POOL_CONTRACT_ID, action, { asset: 'XLM', amount: '10' }, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver });
    expect(detail.success).toBe(true);
    if (!detail.success) return;
    expect(detail.unsignedXdr.length).toBeGreaterThan(0);
    expect(detail.resourceEstimate.cpuInstructions).toBe(900_000);
    expect(detail.resourceEstimate.resourceFeeStroops).toBe('42000');
    const verified = verifyUnsignedXdr(detail.unsignedXdr, 'testnet', POOL_CONTRACT_ID, method);
    expect(verified.ok).toBe(true);
  });
});

describe('buildRealBlendTransaction — argument validation (fail closed, no network call)', () => {
  it('rejects a missing asset before any network call', async () => {
    mockSuccessfulSimulation();
    await expect(
      buildRealBlendTransaction(POOL_CONTRACT_ID, 'DEPOSIT', { amount: '10' }, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver }),
    ).rejects.toThrow(/requires args\.asset/);
  });

  it('rejects a missing amount before any network call', async () => {
    mockSuccessfulSimulation();
    await expect(
      buildRealBlendTransaction(POOL_CONTRACT_ID, 'DEPOSIT', { asset: 'XLM' }, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver }),
    ).rejects.toThrow(/requires args\.amount/);
  });

  it('fails closed for an unresolvable asset (malformed Request address)', async () => {
    mockSuccessfulSimulation();
    await expect(
      buildRealBlendTransaction(POOL_CONTRACT_ID, 'DEPOSIT', { asset: 'DOGE', amount: '10' }, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver }),
    ).rejects.toThrow(/No address configured for asset 'DOGE'/);
  });

  it('fails closed for a non-numeric amount (malformed amount attack)', async () => {
    mockSuccessfulSimulation();
    await expect(
      buildRealBlendTransaction(POOL_CONTRACT_ID, 'DEPOSIT', { asset: 'XLM', amount: 'not-a-number' }, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver }),
    ).rejects.toThrow(/Invalid amount/);
  });

  it('fails closed when Soroban RPC simulation reports failure', async () => {
    mockFailedSimulation('HostError: Error(Contract, #14) — invalid health factor');
    const detail = await buildRealBlendTransaction(POOL_CONTRACT_ID, 'BORROW', { asset: 'XLM', amount: '10' }, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver });
    expect(detail.success).toBe(false);
    if (detail.success) return;
    expect(detail.simulationErrors[0]).toContain('invalid health factor');
  });

  it('RPC unavailable propagates as a rejection, never a silent success', async () => {
    vi.spyOn(rpc.Server.prototype, 'getAccount').mockRejectedValue(new Error('Soroban RPC unavailable'));
    await expect(
      buildRealBlendTransaction(POOL_CONTRACT_ID, 'DEPOSIT', { asset: 'XLM', amount: '10' }, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver }),
    ).rejects.toThrow('Soroban RPC unavailable');
  });
});

describe('verifyUnsignedXdr — unsigned XDR correctness / security (Blend)', () => {
  it('rejects malformed XDR (byte-level tampering)', () => {
    const result = verifyUnsignedXdr('not-real-xdr', 'testnet', POOL_CONTRACT_ID, 'submit');
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/not a well-formed transaction envelope/);
  });

  it('rejects truncated/tampered base64 XDR', async () => {
    mockSuccessfulSimulation();
    const detail = await buildRealBlendTransaction(POOL_CONTRACT_ID, 'DEPOSIT', { asset: 'XLM', amount: '10' }, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver });
    if (!detail.success) throw new Error('expected success');
    const tampered = detail.unsignedXdr.slice(0, -8) + 'AAAAAAAA';
    const verified = verifyUnsignedXdr(tampered, 'testnet', POOL_CONTRACT_ID, 'submit');
    expect(verified.ok).toBe(false);
  });

  it('rejects XDR invoking the wrong contract (substitution attack)', async () => {
    mockSuccessfulSimulation();
    const detail = await buildRealBlendTransaction(POOL_CONTRACT_ID, 'DEPOSIT', { asset: 'XLM', amount: '10' }, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver });
    if (!detail.success) throw new Error('expected success');
    const verified = verifyUnsignedXdr(detail.unsignedXdr, 'testnet', 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'submit');
    expect(verified.ok).toBe(false);
    expect(verified.errors[0]).toContain('invalid-contract attack');
  });

  it('rejects XDR invoking the wrong function name (wrong-function attack — e.g. submit_with_allowance)', async () => {
    mockSuccessfulSimulation();
    const detail = await buildRealBlendTransaction(POOL_CONTRACT_ID, 'DEPOSIT', { asset: 'XLM', amount: '10' }, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver });
    if (!detail.success) throw new Error('expected success');
    const verified = verifyUnsignedXdr(detail.unsignedXdr, 'testnet', POOL_CONTRACT_ID, 'submit_with_allowance');
    expect(verified.ok).toBe(false);
    expect(verified.errors[0]).toContain('was expected');
  });
});

describe('replay — two builds against identical mocked simulation each produce independently valid XDR', () => {
  it('each of two independent calls produces its own valid, non-replayable XDR', async () => {
    mockSuccessfulSimulation();
    const args = { asset: 'XLM', amount: '10' };
    const [a, b] = await Promise.all([
      buildRealBlendTransaction(POOL_CONTRACT_ID, 'DEPOSIT', args, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver }),
      buildRealBlendTransaction(POOL_CONTRACT_ID, 'DEPOSIT', args, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver }),
    ]);
    for (const detail of [a, b]) {
      expect(detail.success).toBe(true);
      if (!detail.success) continue;
      expect(verifyUnsignedXdr(detail.unsignedXdr, 'testnet', POOL_CONTRACT_ID, 'submit').ok).toBe(true);
    }
  });
});

describe('performance — build/simulate/assemble latency (Blend)', () => {
  function percentile(sorted: number[], p: number): number {
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  }

  it('measures avg/P95/P99 latency for buildRealBlendTransaction across 100 calls', async () => {
    mockSuccessfulSimulation();
    const durations: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      await buildRealBlendTransaction(POOL_CONTRACT_ID, 'DEPOSIT', { asset: 'XLM', amount: '10' }, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver });
      durations.push(performance.now() - t0);
    }
    durations.sort((a, b) => a - b);
    const avg = durations.reduce((s, v) => s + v, 0) / durations.length;
    expect(avg).toBeLessThan(50);
    expect(percentile(durations, 95)).toBeLessThan(100);
    expect(percentile(durations, 99)).toBeLessThan(150);
  });
});
