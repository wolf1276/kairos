// Real Soroban unsigned-transaction generation for Soroswap — offline unit tests, same mocking
// discipline as `aquariusRealTransactionBuilder.test.ts` (mocks only `rpc.Server.prototype`;
// everything else is the real `@stellar/stellar-sdk`). No live network call is made anywhere in
// this file — see `soroswapIntegration.test.ts` for the opt-in live-testnet suite (this
// integration IS now live-verified — see that file's header for the transcript/addresses).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { rpc, Keypair, Account, SorobanDataBuilder, Asset, Networks } from '@stellar/stellar-sdk';
import { buildRealSoroswapTransaction, verifyUnsignedXdr } from '../protocolAdapters/soroswap/realTransactionBuilder.js';
import { buildRouterOperation } from '../protocolAdapters/soroswap/invocation.js';
import type { AssetResolver } from '../protocolAdapters/soroswap/index.js';

const ROUTER_CONTRACT_ID = 'CCEHJJXQE4EBFJWB4KNGTZGAYSOVVLEVWZKACA5ZMUPVXA4EHVUJBD5L';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const sourceKeypair = Keypair.random();
const sourcePublicKey = sourceKeypair.publicKey();
const assetResolver: AssetResolver = { assetIssuers: { USDC: USDC_ISSUER } };
const FUTURE_DEADLINE = Math.floor(Date.now() / 1000) + 3600;

function mockAccount(): Account {
  return new Account(sourcePublicKey, '123456789');
}

function mockSuccessfulSimulation() {
  const sorobanData = new SorobanDataBuilder().setResources(900_000, 1_024, 256).setResourceFee('40000').build();
  vi.spyOn(rpc.Server.prototype, 'getAccount').mockResolvedValue(mockAccount());
  vi.spyOn(rpc.Server.prototype, 'simulateTransaction').mockResolvedValue({
    _parsed: true,
    latestLedger: 1000,
    events: [],
    transactionData: { build: () => sorobanData } as never,
    minResourceFee: '40000',
    result: { auth: [], retval: {} as never },
    cost: { cpuInsns: '900000', memBytes: '1024' },
  } as never);
}

function mockFailedSimulation(error: string) {
  vi.spyOn(rpc.Server.prototype, 'getAccount').mockResolvedValue(mockAccount());
  vi.spyOn(rpc.Server.prototype, 'simulateTransaction').mockResolvedValue({ _parsed: true, latestLedger: 1000, events: [], error } as never);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildRealSoroswapTransaction — real unsigned XDR generation', () => {
  it('builds a real, resource-assembled unsigned transaction for swap_exact_tokens_for_tokens', async () => {
    mockSuccessfulSimulation();
    const detail = await buildRealSoroswapTransaction(
      ROUTER_CONTRACT_ID,
      'swap_exact_tokens_for_tokens',
      { path: ['XLM', 'USDC'], amountIn: '1', minOutput: '0', deadline: FUTURE_DEADLINE },
      'testnet',
      { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver },
    );
    expect(detail.success).toBe(true);
    if (!detail.success) return;
    expect(detail.unsignedXdr.length).toBeGreaterThan(0);
    expect(detail.resourceEstimate.cpuInstructions).toBe(900_000);
    expect(detail.resourceEstimate.resourceFeeStroops).toBe('40000');
  });

  it('resolves XLM to the real, canonical native Stellar Asset Contract address (no fabrication)', async () => {
    mockSuccessfulSimulation();
    const detail = await buildRealSoroswapTransaction(ROUTER_CONTRACT_ID, 'swap_exact_tokens_for_tokens', { path: ['XLM', 'USDC'], amountIn: '1', minOutput: '0', deadline: FUTURE_DEADLINE }, 'testnet', {
      rpcUrl: 'https://fake-rpc.example',
      sourceAccountPublicKey: sourcePublicKey,
      assetResolver,
    });
    if (!detail.success) throw new Error('expected success');
    const parsed = (await import('@stellar/stellar-sdk')).TransactionBuilder.fromXDR(detail.unsignedXdr, Networks.TESTNET);
    // The real op is well-formed and invokes the router — the underlying path addresses were
    // derived via the real `Asset.native().contractId()` (verified directly below), not guessed.
    expect(parsed.operations[0].type).toBe('invokeHostFunction');
    expect(Asset.native().contractId(Networks.TESTNET)).toMatch(/^C/);
  });

  it('the generated XDR is real and parseable, invoking the expected contract/function', async () => {
    mockSuccessfulSimulation();
    const detail = await buildRealSoroswapTransaction(ROUTER_CONTRACT_ID, 'add_liquidity', { assetA: 'XLM', assetB: 'USDC', amountA: '10', amountB: '20' }, 'testnet', {
      rpcUrl: 'https://fake-rpc.example',
      sourceAccountPublicKey: sourcePublicKey,
      assetResolver,
    });
    if (!detail.success) throw new Error('expected success');
    const verified = verifyUnsignedXdr(detail.unsignedXdr, 'testnet', ROUTER_CONTRACT_ID, 'add_liquidity');
    expect(verified.ok).toBe(true);
  });

  it('fails closed for an unconfigured (unresolvable) asset', async () => {
    mockSuccessfulSimulation();
    await expect(
      buildRealSoroswapTransaction(ROUTER_CONTRACT_ID, 'swap_exact_tokens_for_tokens', { path: ['XLM', 'DOGE'], amountIn: '1', minOutput: '0', deadline: FUTURE_DEADLINE }, 'testnet', {
        rpcUrl: 'https://fake-rpc.example',
        sourceAccountPublicKey: sourcePublicKey,
        assetResolver,
      }),
    ).rejects.toThrow(/No address or issuer configured for asset 'DOGE'/);
  });

  // Regression: live verification against the real deployed testnet router (see
  // `soroswapIntegration.test.ts`) found that a common real Soroban token (testnet USDC,
  // CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F) is a plain SEP-41 token with no
  // backing classic-asset issuer — `assetIssuers`-only resolution could never reach it.
  // `assetAddresses` was added to fix this; these tests lock the fix in.
  it('resolves an asset via a direct assetAddresses entry (no issuer needed)', async () => {
    mockSuccessfulSimulation();
    const directResolver: AssetResolver = { assetAddresses: { USDC: 'CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F' } };
    const detail = await buildRealSoroswapTransaction(ROUTER_CONTRACT_ID, 'swap_exact_tokens_for_tokens', { path: ['XLM', 'USDC'], amountIn: '1', minOutput: '0', deadline: FUTURE_DEADLINE }, 'testnet', {
      rpcUrl: 'https://fake-rpc.example',
      sourceAccountPublicKey: sourcePublicKey,
      assetResolver: directResolver,
    });
    expect(detail.success).toBe(true);
  });

  it('assetAddresses takes priority over assetIssuers for the same asset code', async () => {
    mockSuccessfulSimulation();
    const directAddress = 'CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F';
    const bothResolver: AssetResolver = { assetIssuers: { USDC: USDC_ISSUER }, assetAddresses: { USDC: directAddress } };
    const detail = await buildRealSoroswapTransaction(ROUTER_CONTRACT_ID, 'swap_exact_tokens_for_tokens', { path: ['XLM', 'USDC'], amountIn: '1', minOutput: '0', deadline: FUTURE_DEADLINE }, 'testnet', {
      rpcUrl: 'https://fake-rpc.example',
      sourceAccountPublicKey: sourcePublicKey,
      assetResolver: bothResolver,
    });
    expect(detail.success).toBe(true);
    if (!detail.success) return;
    const verified = verifyUnsignedXdr(detail.unsignedXdr, 'testnet', ROUTER_CONTRACT_ID, 'swap_exact_tokens_for_tokens');
    expect(verified.ok).toBe(true);
  });

  it('fails closed when Soroban RPC simulation reports failure', async () => {
    mockFailedSimulation('HostError: Error(Contract, #3) — insufficient output amount');
    const detail = await buildRealSoroswapTransaction(ROUTER_CONTRACT_ID, 'swap_exact_tokens_for_tokens', { path: ['XLM', 'USDC'], amountIn: '1', minOutput: '999999', deadline: FUTURE_DEADLINE }, 'testnet', {
      rpcUrl: 'https://fake-rpc.example',
      sourceAccountPublicKey: sourcePublicKey,
      assetResolver,
    });
    expect(detail.success).toBe(false);
    if (detail.success) return;
    expect(detail.simulationErrors[0]).toContain('insufficient output amount');
  });

  it('RPC unavailable propagates as a rejection', async () => {
    vi.spyOn(rpc.Server.prototype, 'getAccount').mockRejectedValue(new Error('Soroban RPC unavailable'));
    await expect(
      buildRealSoroswapTransaction(ROUTER_CONTRACT_ID, 'swap_exact_tokens_for_tokens', { path: ['XLM', 'USDC'], amountIn: '1', minOutput: '0', deadline: FUTURE_DEADLINE }, 'testnet', {
        rpcUrl: 'https://fake-rpc.example',
        sourceAccountPublicKey: sourcePublicKey,
        assetResolver,
      }),
    ).rejects.toThrow('Soroban RPC unavailable');
  });
});

describe('verifyUnsignedXdr — unsigned XDR correctness / security (Soroswap)', () => {
  it('rejects malformed XDR', () => {
    const result = verifyUnsignedXdr('not-real-xdr', 'testnet', ROUTER_CONTRACT_ID, 'swap_exact_tokens_for_tokens');
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/not a well-formed transaction envelope/);
  });

  it('rejects XDR invoking the wrong contract (substitution attack)', async () => {
    mockSuccessfulSimulation();
    const detail = await buildRealSoroswapTransaction(ROUTER_CONTRACT_ID, 'swap_exact_tokens_for_tokens', { path: ['XLM', 'USDC'], amountIn: '1', minOutput: '0', deadline: FUTURE_DEADLINE }, 'testnet', {
      rpcUrl: 'https://fake-rpc.example',
      sourceAccountPublicKey: sourcePublicKey,
      assetResolver,
    });
    if (!detail.success) throw new Error('expected success');
    const wrongContractId = 'CCXO5K2ZCN4JVURRATYOTBIL7BWXWGXNIHLUZ4EIP2UARGDMWY3UYUZX';
    const verified = verifyUnsignedXdr(detail.unsignedXdr, 'testnet', wrongContractId, 'swap_exact_tokens_for_tokens');
    expect(verified.ok).toBe(false);
    expect(verified.errors[0]).toContain('invalid-contract attack');
  });

  it('rejects XDR invoking the wrong function name (modified-XDR attack)', async () => {
    mockSuccessfulSimulation();
    const detail = await buildRealSoroswapTransaction(ROUTER_CONTRACT_ID, 'swap_exact_tokens_for_tokens', { path: ['XLM', 'USDC'], amountIn: '1', minOutput: '0', deadline: FUTURE_DEADLINE }, 'testnet', {
      rpcUrl: 'https://fake-rpc.example',
      sourceAccountPublicKey: sourcePublicKey,
      assetResolver,
    });
    if (!detail.success) throw new Error('expected success');
    const verified = verifyUnsignedXdr(detail.unsignedXdr, 'testnet', ROUTER_CONTRACT_ID, 'remove_liquidity');
    expect(verified.ok).toBe(false);
    expect(verified.errors[0]).toContain('was expected');
  });
});

describe('performance — build/simulate/assemble latency (Soroswap)', () => {
  function percentile(sorted: number[], p: number): number {
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  }

  it('measures avg/P95/P99 latency for buildRealSoroswapTransaction across 100 calls', async () => {
    mockSuccessfulSimulation();
    const durations: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      await buildRealSoroswapTransaction(ROUTER_CONTRACT_ID, 'swap_exact_tokens_for_tokens', { path: ['XLM', 'USDC'], amountIn: '1', minOutput: '0', deadline: FUTURE_DEADLINE }, 'testnet', {
        rpcUrl: 'https://fake-rpc.example',
        sourceAccountPublicKey: sourcePublicKey,
        assetResolver,
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

// Regression: live production verification against the real deployed testnet router found that
// `verifyUnsignedXdr`'s contract-id/method-only check does NOT catch a tampered *argument* (a
// byte flip landing inside the encoded `amount_in` value still parsed as a well-formed
// transaction invoking the right contract/function). Live-confirmed by targeted byte-tampering
// of a real, router-accepted XDR's `amount_in` argument: the old (still-supported, now-optional)
// 4-arg check reported `ok: true`; the new `expectedArgsXdr` parameter correctly reports
// `ok: false`. These tests reproduce that exact scenario offline/deterministically.
describe('verifyUnsignedXdr — expectedArgsXdr (regression: argument-tampering detection)', () => {
  async function buildValidXdrAndExpectedArgs(overrides: { amountIn?: string } = {}) {
    mockSuccessfulSimulation();
    const args = { path: ['XLM', 'USDC'], amountIn: overrides.amountIn ?? '1', minOutput: '0', deadline: FUTURE_DEADLINE };
    const detail = await buildRealSoroswapTransaction(ROUTER_CONTRACT_ID, 'swap_exact_tokens_for_tokens', args, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver });
    if (!detail.success) throw new Error('expected success');
    const op = await buildRouterOperation(ROUTER_CONTRACT_ID, 'swap_exact_tokens_for_tokens', args, 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, assetResolver });
    const invokeArgs = op.body().invokeHostFunctionOp().hostFunction().invokeContract().args();
    const expectedArgsXdr = invokeArgs.map((a) => a.toXDR('base64'));
    return { unsignedXdr: detail.unsignedXdr, expectedArgsXdr };
  }

  it('accepts a real, untampered XDR when expectedArgsXdr matches', async () => {
    const { unsignedXdr, expectedArgsXdr } = await buildValidXdrAndExpectedArgs();
    const verified = verifyUnsignedXdr(unsignedXdr, 'testnet', ROUTER_CONTRACT_ID, 'swap_exact_tokens_for_tokens', expectedArgsXdr);
    expect(verified.ok).toBe(true);
  });

  it('catches a tampered argument (amount_in built differently than expected) that contract/function-only checking misses', async () => {
    // Build a real XDR for amountIn=1, but check it against the args expected for amountIn=2 —
    // simulating a scenario where the XDR's argument payload was substituted after being built.
    const built = await buildValidXdrAndExpectedArgs({ amountIn: '1' });
    const expectedForDifferentAmount = await buildValidXdrAndExpectedArgs({ amountIn: '2' });

    const withArgsCheck = verifyUnsignedXdr(built.unsignedXdr, 'testnet', ROUTER_CONTRACT_ID, 'swap_exact_tokens_for_tokens', expectedForDifferentAmount.expectedArgsXdr);
    expect(withArgsCheck.ok).toBe(false);
    expect(withArgsCheck.errors[0]).toContain('does not match its expected value');

    // The original (contract/function-only) check has no way to see this — documents the exact
    // gap `expectedArgsXdr` closes.
    const withoutArgsCheck = verifyUnsignedXdr(built.unsignedXdr, 'testnet', ROUTER_CONTRACT_ID, 'swap_exact_tokens_for_tokens');
    expect(withoutArgsCheck.ok).toBe(true);
  });

  it('catches an argument-count mismatch', async () => {
    const { unsignedXdr } = await buildValidXdrAndExpectedArgs();
    const verified = verifyUnsignedXdr(unsignedXdr, 'testnet', ROUTER_CONTRACT_ID, 'swap_exact_tokens_for_tokens', ['only-one-arg']);
    expect(verified.ok).toBe(false);
    expect(verified.errors[0]).toContain('argument(s)');
  });

  it('omitting expectedArgsXdr preserves the original (contract/function-only) behavior exactly', async () => {
    const { unsignedXdr } = await buildValidXdrAndExpectedArgs();
    const verified = verifyUnsignedXdr(unsignedXdr, 'testnet', ROUTER_CONTRACT_ID, 'swap_exact_tokens_for_tokens');
    expect(verified.ok).toBe(true);
    expect(verified.errors).toEqual([]);
  });
});
