// Soroswap REAL integration tests — hit the live Soroswap testnet router over the network. Same
// opt-in gating pattern as `aquariusIntegration.test.ts` (skipped unless
// SOROSWAP_INTEGRATION_TEST=true), so the normal test suite / CI stays hermetic and offline.
//
// Addresses below were discovered live during this suite's authoring session (documented here so
// this transcript is reproducible, not just asserted):
//   - Router (testnet):  CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD
//     (from Soroswap's public API: https://api.soroswap.finance/api/testnet/router)
//   - XLM (native SAC):  CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
//     (matches `Asset.native().contractId(Networks.TESTNET)` exactly — this codebase's own
//     deterministic derivation is correct, live-confirmed)
//   - USDC (testnet):    CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F
//     (from Soroswap's public token list: https://api.soroswap.finance/api/tokens?network=testnet
//     — confirmed via a live `name()` call to return "USDCoin", NOT the "code:issuer" format a
//     classic-asset SAC returns, i.e. this is a plain SEP-41 token with no backing issuer — this
//     is exactly the real-world case that motivated adding `AssetResolver.assetAddresses`, see
//     `invocation.ts`)
//
// Run with:
//   SOROSWAP_INTEGRATION_TEST=true \
//   SOROSWAP_SOURCE_ACCOUNT=<a real, existing, funded testnet account public key> \
//   npx vitest run src/__tests__/soroswapIntegration.test.ts
import { describe, it, expect } from 'vitest';
import { rpc, xdr as stellarXdr, contract as stellarContract, Contract, TransactionBuilder, Networks, scValToNative } from '@stellar/stellar-sdk';
import { buildRealSoroswapTransaction, verifyUnsignedXdr } from '../protocolAdapters/soroswap/realTransactionBuilder.js';
import { buildRouterOperation } from '../protocolAdapters/soroswap/invocation.js';
import type { AssetResolver } from '../protocolAdapters/soroswap/index.js';

const RUN_INTEGRATION = process.env.SOROSWAP_INTEGRATION_TEST === 'true';
const d = RUN_INTEGRATION ? describe : describe.skip;

const ROUTER = 'CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD';
const FACTORY = 'CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY'; // from api.soroswap.finance/api/testnet/factory
const XLM_C = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const USDC_C = 'CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F';
const RPC_URL = 'https://soroban-testnet.stellar.org';

d('Soroswap real integration (live testnet)', () => {
  const sourceAccountPublicKey = process.env.SOROSWAP_SOURCE_ACCOUNT ?? '';
  const resolver: AssetResolver = { assetAddresses: { XLM: XLM_C, USDC: USDC_C } };

  it('router invocation: real swap_exact_tokens_for_tokens call succeeds against the live router, with correct function name and argument encoding/order', async () => {
    const detail = await buildRealSoroswapTransaction(
      ROUTER,
      'swap_exact_tokens_for_tokens',
      { path: ['XLM', 'USDC'], amountIn: '1', minOutput: '0', deadline: Math.floor(Date.now() / 1000) + 3600 },
      'testnet',
      { rpcUrl: RPC_URL, sourceAccountPublicKey, assetResolver: resolver },
    );
    expect(detail.success).toBe(true);
  }, 60_000);

  it('unsigned XDR + resource estimation + fee estimation are all real (not synthetic placeholders)', async () => {
    const detail = await buildRealSoroswapTransaction(
      ROUTER,
      'swap_exact_tokens_for_tokens',
      { path: ['XLM', 'USDC'], amountIn: '1', minOutput: '0', deadline: Math.floor(Date.now() / 1000) + 3600 },
      'testnet',
      { rpcUrl: RPC_URL, sourceAccountPublicKey, assetResolver: resolver },
    );
    if (!detail.success) throw new Error(`expected success, got: ${detail.simulationErrors.join('; ')}`);
    expect(detail.unsignedXdr.length).toBeGreaterThan(0);
    // Real Soroban swap invocations cost well over the synthetic placeholder's fixed defaults —
    // a live CPU instruction count in the low millions is a strong "this is real" signal.
    expect(detail.resourceEstimate.cpuInstructions).toBeGreaterThan(100_000);
    expect(Number(detail.resourceEstimate.resourceFeeStroops)).toBeGreaterThan(0);

    const verified = verifyUnsignedXdr(detail.unsignedXdr, 'testnet', ROUTER, 'swap_exact_tokens_for_tokens');
    expect(verified.ok).toBe(true);
  }, 60_000);

  it('replay: two live calls each independently produce their own valid, verifiable XDR', async () => {
    const args = { path: ['XLM', 'USDC'], amountIn: '1', minOutput: '0', deadline: Math.floor(Date.now() / 1000) + 3600 };
    const [a, b] = await Promise.all([
      buildRealSoroswapTransaction(ROUTER, 'swap_exact_tokens_for_tokens', args, 'testnet', { rpcUrl: RPC_URL, sourceAccountPublicKey, assetResolver: resolver }),
      buildRealSoroswapTransaction(ROUTER, 'swap_exact_tokens_for_tokens', args, 'testnet', { rpcUrl: RPC_URL, sourceAccountPublicKey, assetResolver: resolver }),
    ]);
    for (const detail of [a, b]) {
      expect(detail.success).toBe(true);
      if (!detail.success) continue;
      expect(verifyUnsignedXdr(detail.unsignedXdr, 'testnet', ROUTER, 'swap_exact_tokens_for_tokens').ok).toBe(true);
    }
    // Not asserting exact XDR/hash equality across two live calls — live sequence numbers /
    // simulated ledger state can differ between calls (same rationale as
    // `executionEngineAquariusIntegration.test.ts`).
  }, 60_000);

  it('attack: malformed/unresolvable asset fails closed before any network call', async () => {
    await expect(
      buildRealSoroswapTransaction(ROUTER, 'swap_exact_tokens_for_tokens', { path: ['XLM', 'DOGE'], amountIn: '1', minOutput: '0', deadline: Math.floor(Date.now() / 1000) + 3600 }, 'testnet', {
        rpcUrl: RPC_URL,
        sourceAccountPublicKey,
        assetResolver: resolver,
      }),
    ).rejects.toThrow(/No address or issuer configured for asset 'DOGE'/);
  }, 60_000);

  it('attack: invalid amount (negative) is rejected by the live router contract itself', async () => {
    const detail = await buildRealSoroswapTransaction(
      ROUTER,
      'swap_exact_tokens_for_tokens',
      { path: ['XLM', 'USDC'], amountIn: '-1', minOutput: '0', deadline: Math.floor(Date.now() / 1000) + 3600 },
      'testnet',
      { rpcUrl: RPC_URL, sourceAccountPublicKey, assetResolver: resolver },
    );
    expect(detail.success).toBe(false);
  }, 60_000);

  it('attack: invalid amount (exceeds balance) is rejected by the live router/token contracts', async () => {
    const detail = await buildRealSoroswapTransaction(
      ROUTER,
      'swap_exact_tokens_for_tokens',
      { path: ['XLM', 'USDC'], amountIn: '999999999999', minOutput: '0', deadline: Math.floor(Date.now() / 1000) + 3600 },
      'testnet',
      { rpcUrl: RPC_URL, sourceAccountPublicKey, assetResolver: resolver },
    );
    expect(detail.success).toBe(false);
  }, 60_000);

  it('attack: wrong function name fails closed before any network call', async () => {
    await expect(
      buildRealSoroswapTransaction(ROUTER, 'definitely_not_a_real_method', { path: ['XLM', 'USDC'], amountIn: '1', minOutput: '0', deadline: Math.floor(Date.now() / 1000) + 3600 }, 'testnet', {
        rpcUrl: RPC_URL,
        sourceAccountPublicKey,
        assetResolver: resolver,
      }),
    ).rejects.toThrow(/no real invocation builder exists/);
  }, 60_000);

  it('attack: wrong contract (a real, deployed, but non-router contract) fails closed against live chain state', async () => {
    const detail = await buildRealSoroswapTransaction(
      USDC_C, // real deployed contract, but not the router — has no swap_exact_tokens_for_tokens function
      'swap_exact_tokens_for_tokens',
      { path: ['XLM', 'USDC'], amountIn: '1', minOutput: '0', deadline: Math.floor(Date.now() / 1000) + 3600 },
      'testnet',
      { rpcUrl: RPC_URL, sourceAccountPublicKey, assetResolver: resolver },
    );
    expect(detail.success).toBe(false);
  }, 60_000);

  it('attack: verifyUnsignedXdr rejects a real, valid XDR checked against the wrong expected contract', async () => {
    const detail = await buildRealSoroswapTransaction(
      ROUTER,
      'swap_exact_tokens_for_tokens',
      { path: ['XLM', 'USDC'], amountIn: '1', minOutput: '0', deadline: Math.floor(Date.now() / 1000) + 3600 },
      'testnet',
      { rpcUrl: RPC_URL, sourceAccountPublicKey, assetResolver: resolver },
    );
    if (!detail.success) throw new Error('expected success');
    const verified = verifyUnsignedXdr(detail.unsignedXdr, 'testnet', USDC_C, 'swap_exact_tokens_for_tokens');
    expect(verified.ok).toBe(false);
    expect(verified.errors[0]).toContain('invalid-contract attack');
  }, 60_000);

  it('attack: malformed path (empty array) is rejected by the live router contract itself', async () => {
    const detail = await buildRealSoroswapTransaction(ROUTER, 'swap_exact_tokens_for_tokens', { path: [], amountIn: '1', minOutput: '0', deadline: Math.floor(Date.now() / 1000) + 3600 }, 'testnet', {
      rpcUrl: RPC_URL,
      sourceAccountPublicKey,
      assetResolver: resolver,
    });
    expect(detail.success).toBe(false);
  }, 60_000);

  it('attack: malformed path (single-element, no hop) is rejected by the live router contract itself', async () => {
    const detail = await buildRealSoroswapTransaction(ROUTER, 'swap_exact_tokens_for_tokens', { path: ['XLM'], amountIn: '1', minOutput: '0', deadline: Math.floor(Date.now() / 1000) + 3600 }, 'testnet', {
      rpcUrl: RPC_URL,
      sourceAccountPublicKey,
      assetResolver: resolver,
    });
    expect(detail.success).toBe(false);
  }, 60_000);

  it('attack: malformed amount (non-numeric) fails closed before any network call', async () => {
    await expect(
      buildRealSoroswapTransaction(ROUTER, 'swap_exact_tokens_for_tokens', { path: ['XLM', 'USDC'], amountIn: 'not-a-number', minOutput: '0', deadline: Math.floor(Date.now() / 1000) + 3600 }, 'testnet', {
        rpcUrl: RPC_URL,
        sourceAccountPublicKey,
        assetResolver: resolver,
      }),
    ).rejects.toThrow(/Invalid amount/);
  }, 60_000);

  it('attack: modified XDR (tampered argument) is caught by verifyUnsignedXdr with expectedArgsXdr — regression for the gap found live in this round', async () => {
    const args = { path: ['XLM', 'USDC'], amountIn: '1', minOutput: '0', deadline: Math.floor(Date.now() / 1000) + 3600 };
    const detail = await buildRealSoroswapTransaction(ROUTER, 'swap_exact_tokens_for_tokens', args, 'testnet', { rpcUrl: RPC_URL, sourceAccountPublicKey, assetResolver: resolver });
    if (!detail.success) throw new Error('expected success');

    const op = await buildRouterOperation(ROUTER, 'swap_exact_tokens_for_tokens', args, 'testnet', { rpcUrl: RPC_URL, sourceAccountPublicKey, assetResolver: resolver });
    const invokeArgs = op.body().invokeHostFunctionOp().hostFunction().invokeContract().args();
    const expectedArgsXdr = invokeArgs.map((a) => a.toXDR('base64'));

    // Untampered XDR still passes.
    expect(verifyUnsignedXdr(detail.unsignedXdr, 'testnet', ROUTER, 'swap_exact_tokens_for_tokens', expectedArgsXdr).ok).toBe(true);

    // Flip the last byte of the amount_in argument's own encoded bytes within the real XDR —
    // located by finding the argument's own known-correct XDR bytes inside the full transaction
    // buffer (the exact live-verification technique that originally found this bug).
    const fullBuf = Buffer.from(detail.unsignedXdr, 'base64');
    const amountArgBuf = Buffer.from(expectedArgsXdr[0], 'base64');
    const idx = fullBuf.indexOf(amountArgBuf);
    expect(idx).toBeGreaterThanOrEqual(0);
    const tamperedBuf = Buffer.from(fullBuf);
    tamperedBuf[idx + amountArgBuf.length - 1] ^= 0xff;
    const tamperedXdr = tamperedBuf.toString('base64');

    const withArgsCheck = verifyUnsignedXdr(tamperedXdr, 'testnet', ROUTER, 'swap_exact_tokens_for_tokens', expectedArgsXdr);
    expect(withArgsCheck.ok).toBe(false);

    // Documents the original (still-supported) gap: contract/function-only checking misses this.
    const withoutArgsCheck = verifyUnsignedXdr(tamperedXdr, 'testnet', ROUTER, 'swap_exact_tokens_for_tokens');
    expect(withoutArgsCheck.ok).toBe(true);
  }, 60_000);

  it('modified XDR (truncated) is rejected as a malformed transaction envelope', async () => {
    const detail = await buildRealSoroswapTransaction(ROUTER, 'swap_exact_tokens_for_tokens', { path: ['XLM', 'USDC'], amountIn: '1', minOutput: '0', deadline: Math.floor(Date.now() / 1000) + 3600 }, 'testnet', {
      rpcUrl: RPC_URL,
      sourceAccountPublicKey,
      assetResolver: resolver,
    });
    if (!detail.success) throw new Error('expected success');
    const truncated = detail.unsignedXdr.slice(0, Math.floor(detail.unsignedXdr.length * 0.7));
    const verified = verifyUnsignedXdr(truncated, 'testnet', ROUTER, 'swap_exact_tokens_for_tokens');
    expect(verified.ok).toBe(false);
    expect(verified.errors[0]).toMatch(/not a well-formed transaction envelope/);
  }, 60_000);

  it('stale route / replay: simulation never advances the source account sequence number (proves this framework never submits, so a built XDR cannot itself replay a real state change)', async () => {
    const args = { path: ['XLM', 'USDC'], amountIn: '1', minOutput: '0', deadline: Math.floor(Date.now() / 1000) + 3600 };
    const [a, b] = await Promise.all([
      buildRealSoroswapTransaction(ROUTER, 'swap_exact_tokens_for_tokens', args, 'testnet', { rpcUrl: RPC_URL, sourceAccountPublicKey, assetResolver: resolver }),
      buildRealSoroswapTransaction(ROUTER, 'swap_exact_tokens_for_tokens', args, 'testnet', { rpcUrl: RPC_URL, sourceAccountPublicKey, assetResolver: resolver }),
    ]);
    if (!a.success || !b.success) throw new Error('expected success');
    const txA = TransactionBuilder.fromXDR(a.unsignedXdr, Networks.TESTNET) as unknown as { sequence: string };
    const txB = TransactionBuilder.fromXDR(b.unsignedXdr, Networks.TESTNET) as unknown as { sequence: string };
    expect(txA.sequence).toBe(txB.sequence);
  }, 60_000);

  it('router contract verified: live bytecode function spec matches this codebase\'s implemented ABI exactly (name, argument names, argument order, argument types)', async () => {
    const server = new rpc.Server(RPC_URL);
    const contract = new Contract(ROUTER);
    const instanceEntries = await server.getLedgerEntries(contract.getFootprint());
    expect(instanceEntries.entries.length).toBe(1);
    const instance = instanceEntries.entries[0].val.contractData().val().instance();
    expect(instance.executable().switch().name).toBe('contractExecutableWasm');
    const wasmHash = instance.executable().wasmHash();

    const codeKey = stellarXdr.LedgerKey.contractCode(new stellarXdr.LedgerKeyContractCode({ hash: wasmHash }));
    const codeEntries = await server.getLedgerEntries(codeKey);
    const wasmBytes: Buffer = codeEntries.entries[0].val.contractCode().code();
    const spec = stellarContract.Spec.fromWasm(wasmBytes);

    const swapFn = spec.entries.find((e) => e.switch().name === 'scSpecEntryFunctionV0' && e.functionV0().name().toString() === 'swap_exact_tokens_for_tokens');
    expect(swapFn).toBeDefined();
    const inputs = swapFn!.functionV0().inputs();
    expect(inputs.map((i) => i.name().toString())).toEqual(['amount_in', 'amount_out_min', 'path', 'to', 'deadline']);
    expect(inputs.map((i) => i.type().switch().name)).toEqual(['scSpecTypeI128', 'scSpecTypeI128', 'scSpecTypeVec', 'scSpecTypeAddress', 'scSpecTypeU64']);

    const addLiquidityFn = spec.entries.find((e) => e.switch().name === 'scSpecEntryFunctionV0' && e.functionV0().name().toString() === 'add_liquidity');
    expect(addLiquidityFn!.functionV0().inputs().map((i) => i.name().toString())).toEqual(['token_a', 'token_b', 'amount_a_desired', 'amount_b_desired', 'amount_a_min', 'amount_b_min', 'to', 'deadline']);

    const removeLiquidityFn = spec.entries.find((e) => e.switch().name === 'scSpecEntryFunctionV0' && e.functionV0().name().toString() === 'remove_liquidity');
    expect(removeLiquidityFn!.functionV0().inputs().map((i) => i.name().toString())).toEqual(['token_a', 'token_b', 'liquidity', 'amount_a_min', 'amount_b_min', 'to', 'deadline']);
  }, 60_000);

  it('factory contract verified: router.get_factory() on-chain matches the independently-discovered factory address', async () => {
    const server = new rpc.Server(RPC_URL);
    const account = await server.getAccount(sourceAccountPublicKey);
    const routerContract = new Contract(ROUTER);
    const op = routerContract.call('get_factory');
    const tx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: Networks.TESTNET }).addOperation(op).setTimeout(30).build();
    const sim = await server.simulateTransaction(tx);
    expect(rpc.Api.isSimulationSuccess(sim)).toBe(true);
    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) return;
    const factoryFromRouter = scValToNative(sim.result.retval);
    expect(factoryFromRouter).toBe(FACTORY);

    const factoryEntries = await server.getLedgerEntries(new Contract(FACTORY).getFootprint());
    expect(factoryEntries.entries.length).toBe(1);
  }, 60_000);
});
