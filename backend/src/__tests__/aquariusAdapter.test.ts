// Aquarius Protocol Adapter — exhaustive test suite. All chain interaction is through
// deterministic in-memory test doubles (testDoubles.ts) — no real Soroban/Aquarius network call
// is made anywhere in this file.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createAquariusAdapter,
  createDeterministicRouterClient,
  createDeterministicSorobanRpcClient,
  createDeterministicBackendApiClient,
  AquariusExecutionNotImplementedError,
  getAquariusRouterContractId,
} from '../protocolAdapters/aquarius/index.js';
import { ProtocolRegistry, MalformedAdapterError } from '../protocolAdapters/index.js';
import type { AquariusAdapterOptions } from '../protocolAdapters/aquarius/index.js';
import type { AdapterActionRequest } from '../protocolAdapters/index.js';

const SUPPORTED_ASSETS = ['XLM', 'USDC', 'AQUA'];

beforeEach(() => {
  process.env.AQUARIUS_ROUTER_CONTRACT_ID_TESTNET = 'CONTRACT-TESTNET-AQUARIUS-ROUTER';
  process.env.AQUARIUS_ROUTER_CONTRACT_ID_MAINNET = 'CONTRACT-MAINNET-AQUARIUS-ROUTER';
});

afterEach(() => {
  delete process.env.AQUARIUS_ROUTER_CONTRACT_ID_TESTNET;
  delete process.env.AQUARIUS_ROUTER_CONTRACT_ID_MAINNET;
  delete process.env.AQUARIUS_BACKEND_API_URL;
});

function makeAdapter(overrides: Partial<AquariusAdapterOptions> = {}) {
  return createAquariusAdapter({
    supportedAssets: SUPPORTED_ASSETS,
    routerClient: createDeterministicRouterClient(),
    sorobanRpcClient: createDeterministicSorobanRpcClient(),
    ...overrides,
  });
}

const swapReq: AdapterActionRequest = { action: 'SWAP', asset: 'XLM', network: 'testnet', amount: '100.000000', params: { outputAsset: 'USDC', trustlineEstablished: true } };
const chainedReq: AdapterActionRequest = { action: 'SWAP_CHAINED', asset: 'XLM', network: 'testnet', amount: '100.000000', params: { path: ['XLM', 'USDC', 'AQUA'], trustlineEstablished: true } };
const depositReq: AdapterActionRequest = { action: 'DEPOSIT', asset: 'XLM', network: 'testnet', amount: '100.000000', params: { assetB: 'USDC', trustlineEstablished: true } };
const withdrawReq: AdapterActionRequest = { action: 'WITHDRAW', asset: 'XLM', network: 'testnet', amount: '50.000000', params: { poolId: 'pool-xlm-usdc' } };
const claimReq: AdapterActionRequest = { action: 'CLAIM_REWARDS', asset: 'XLM', network: 'testnet', amount: '0', params: { poolId: 'pool-xlm-usdc' } };
const poolDiscoveryReq: AdapterActionRequest = { action: 'POOL_DISCOVERY', asset: 'XLM', network: 'testnet', amount: '0' };

// ── Registration ──────────────────────────────────────────────────────────────────────────────

describe('registration', () => {
  it('registers cleanly against the shared ProtocolRegistry, using the existing interface unchanged', () => {
    const registry = new ProtocolRegistry();
    const metadata = registry.register(makeAdapter());
    expect(metadata.protocol).toBe('aquarius');
    expect(metadata.capabilities.supportedActions).toEqual(expect.arrayContaining(['SWAP', 'SWAP_CHAINED', 'DEPOSIT', 'WITHDRAW', 'CLAIM_REWARDS', 'POOL_DISCOVERY']));
  });

  it('capabilities declare swaps, multi-hop swaps, deposits, withdrawals, reward claiming, pool discovery', () => {
    const adapter = makeAdapter();
    const caps = adapter.capabilities();
    expect(caps.supportedActions).toContain('SWAP');
    expect(caps.supportedActions).toContain('SWAP_CHAINED');
    expect(caps.supportedActions).toContain('DEPOSIT');
    expect(caps.supportedActions).toContain('WITHDRAW');
    expect(caps.supportedActions).toContain('CLAIM_REWARDS');
    expect(caps.supportedActions).toContain('POOL_DISCOVERY');
    expect(caps.batchingSupport).toBe(true);
    expect(caps.supportedNetworks).toEqual(['testnet', 'mainnet']);
  });
});

// ── Quote generation ──────────────────────────────────────────────────────────────────────────

describe('quote generation', () => {
  it('generates a standardized Quote for a direct SWAP (on-chain fallback, no backend API configured)', async () => {
    const adapter = makeAdapter();
    const quote = await adapter.quote!(swapReq);
    expect(quote.protocol).toBe('aquarius');
    expect(quote.inputAsset).toBe('XLM');
    expect(quote.outputAsset).toBe('USDC');
    expect(quote.source).toBe('on-chain');
    expect(typeof quote.quoteHash).toBe('string');
  });

  it('uses the backend API for path finding when available', async () => {
    const backend = createDeterministicBackendApiClient({ route: { path: ['XLM', 'AQUA', 'USDC'], estimatedOutput: '42.000000', priceImpactPct: 0.05 } });
    const adapter = makeAdapter({ backendApiClient: backend });
    const quote = await adapter.quote!(swapReq);
    expect(quote.source).toBe('backend-api');
    expect(quote.route).toEqual(['XLM', 'AQUA', 'USDC']);
  });

  it('falls back to on-chain routing when the backend API is unavailable', async () => {
    const backend = createDeterministicBackendApiClient({ unavailable: true });
    const adapter = makeAdapter({ backendApiClient: backend });
    const quote = await adapter.quote!(swapReq);
    expect(quote.source).toBe('on-chain');
  });

  it('falls back to on-chain routing when the backend API returns null (no route found)', async () => {
    const backend = createDeterministicBackendApiClient({ route: null });
    const adapter = makeAdapter({ backendApiClient: backend });
    const quote = await adapter.quote!(swapReq);
    expect(quote.source).toBe('on-chain');
  });

  it('rejects quoting an invalid request rather than returning a garbage quote', async () => {
    const adapter = makeAdapter();
    await expect(adapter.quote!({ ...swapReq, asset: 'DOGE' })).rejects.toThrow();
  });
});

// ── swap / swap_chained ──────────────────────────────────────────────────────────────────────

describe('swap and swap_chained', () => {
  it('simulate() succeeds for a valid direct SWAP', async () => {
    const adapter = makeAdapter();
    const result = await adapter.simulate(swapReq);
    expect(result.success).toBe(true);
    expect(result.estimatedOutputs.USDC).toBeDefined();
  });

  it('simulate() succeeds for a valid SWAP_CHAINED (multi-hop)', async () => {
    const adapter = makeAdapter();
    const result = await adapter.simulate(chainedReq);
    expect(result.success).toBe(true);
    expect(result.estimatedOutputs.AQUA).toBeDefined();
  });

  it('buildTransaction() for both SWAP and SWAP_CHAINED routes through swap_chained on the Router', async () => {
    const adapter = makeAdapter();
    const direct = await adapter.buildTransaction!(swapReq);
    const chained = await adapter.buildTransaction!(chainedReq);
    expect(direct.method).toBe('swap_chained');
    expect(chained.method).toBe('swap_chained');
    expect(direct.contractId).toBe(getAquariusRouterContractId('testnet'));
  });

  it('SWAP_CHAINED preserves the declared path in the built transaction args (token ordering)', async () => {
    const adapter = makeAdapter();
    const tx = await adapter.buildTransaction!(chainedReq);
    expect(tx.args.path).toEqual(['XLM', 'USDC', 'AQUA']);
  });
});

// ── Deposit / withdraw / claim rewards / pool discovery ─────────────────────────────────────

describe('deposit, withdraw, claim rewards, pool discovery', () => {
  it('simulate() succeeds for DEPOSIT and reports estimated LP tokens', async () => {
    const adapter = makeAdapter();
    const result = await adapter.simulate(depositReq);
    expect(result.success).toBe(true);
    expect(result.estimatedOutputs.lpTokens).toBeDefined();
  });

  it('simulate() succeeds for WITHDRAW and reports estimated underlying assets', async () => {
    const adapter = makeAdapter();
    const result = await adapter.simulate(withdrawReq);
    expect(result.success).toBe(true);
    expect(result.estimatedOutputs.assetA).toBeDefined();
    expect(result.estimatedOutputs.assetB).toBeDefined();
  });

  it('simulate() succeeds for CLAIM_REWARDS and reports the reward amount/asset', async () => {
    const adapter = makeAdapter();
    const result = await adapter.simulate(claimReq);
    expect(result.success).toBe(true);
    expect(result.estimatedOutputs.rewards).toBeDefined();
    expect(result.estimatedOutputs.rewardAsset).toBe('AQUA');
  });

  it('POOL_DISCOVERY simulate() lists pools without requiring an action-specific asset/poolId', async () => {
    const adapter = makeAdapter();
    const result = await adapter.simulate(poolDiscoveryReq);
    expect(result.success).toBe(true);
    expect(result.estimatedOutputs.poolCount).toBe('1');
  });

  it('buildTransaction() maps DEPOSIT/WITHDRAW/CLAIM_REWARDS to the correct Router methods', async () => {
    const adapter = makeAdapter();
    expect((await adapter.buildTransaction!(depositReq)).method).toBe('deposit');
    expect((await adapter.buildTransaction!(withdrawReq)).method).toBe('withdraw');
    expect((await adapter.buildTransaction!(claimReq)).method).toBe('claim_rewards');
  });

  it('buildTransaction() rejects POOL_DISCOVERY (read-only, no transaction to build)', async () => {
    const adapter = makeAdapter();
    await expect(adapter.buildTransaction!(poolDiscoveryReq)).rejects.toThrow(/read-only/);
  });
});

// ── Unsupported assets / invalid routes / slippage / router unavailable ─────────────────────

describe('validation: unsupported assets, invalid routes, slippage, router unavailable', () => {
  it('rejects an unsupported input asset', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...swapReq, asset: 'DOGE' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('DOGE'))).toBe(true);
  });

  it('rejects an unsupported output asset', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...swapReq, params: { outputAsset: 'SHIB' } });
    expect(result.ok).toBe(false);
  });

  it('rejects an unsupported action', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...swapReq, action: 'TELEPORT' });
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid route: path shorter than 2 hops', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...chainedReq, params: { path: ['XLM'] } });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/at least 2/);
  });

  it('rejects an invalid route: path not starting at the declared input asset (token ordering)', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...chainedReq, params: { path: ['USDC', 'XLM', 'AQUA'] } });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('token ordering'))).toBe(true);
  });

  it('rejects an invalid route: repeated adjacent hop', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...chainedReq, params: { path: ['XLM', 'XLM', 'USDC'] } });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('repeated hop'))).toBe(true);
  });

  it('rejects an invalid route: unsupported asset in the path', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...chainedReq, params: { path: ['XLM', 'DOGE', 'USDC'] } });
    expect(result.ok).toBe(false);
  });

  it('slippage failure: params.maxSlippagePct above the adapter maximum is rejected', async () => {
    const adapter = makeAdapter({ maxSlippagePct: 2 });
    const result = await adapter.validate({ ...swapReq, params: { ...swapReq.params, maxSlippagePct: 10 } });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('maxSlippagePct'))).toBe(true);
  });

  it('slippage within the limit is accepted', async () => {
    const adapter = makeAdapter({ maxSlippagePct: 5 });
    const result = await adapter.validate({ ...swapReq, params: { ...swapReq.params, maxSlippagePct: 2 } });
    expect(result.ok).toBe(true);
  });

  it('router unavailable: health() reporting UNAVAILABLE rejects every request, fail-closed', async () => {
    const adapter = makeAdapter({ onHealth: () => 'UNAVAILABLE' });
    const result = await adapter.validate(swapReq);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('not available'))).toBe(true);
  });

  it('router health UNKNOWN also fails closed (never treated as an implicit READY)', async () => {
    const adapter = makeAdapter({ onHealth: () => 'UNKNOWN' });
    const result = await adapter.validate(swapReq);
    expect(result.ok).toBe(false);
  });

  it('DEGRADED health does not by itself reject a request (still usable, just not optimal)', async () => {
    const adapter = makeAdapter({ onHealth: () => 'DEGRADED' });
    const result = await adapter.validate(swapReq);
    expect(result.ok).toBe(true);
  });

  it('trustline requirement: a non-native asset without trustlineEstablished is rejected', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...swapReq, params: { outputAsset: 'USDC' } }); // no trustlineEstablished param
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('trustline'))).toBe(true);
  });

  it('trustline requirement: XLM (native) never requires a trustline', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ action: 'WITHDRAW', asset: 'XLM', network: 'testnet', amount: '10', params: { poolId: 'pool-xlm-usdc' } });
    expect(result.ok).toBe(true);
  });

  it('trustline requirement satisfied: a swap with trustlineEstablished on both legs is accepted', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...swapReq, params: { ...swapReq.params, trustlineEstablished: true } });
    expect(result.ok).toBe(true);
  });
});

// ── Malformed responses ──────────────────────────────────────────────────────────────────────

describe('malformed responses', () => {
  it('a router client that returns a malformed (non-array) path degrades simulate() to a graceful failure, never a thrown rejection', async () => {
    const badRouter = createDeterministicRouterClient();
    (badRouter as { quoteSwapChained: unknown }).quoteSwapChained = async () => ({ path: 'not-an-array', estimatedOutput: '1', priceImpactPct: 0 });
    const adapter = makeAdapter({ routerClient: badRouter });
    const result = await adapter.simulate({ ...swapReq, params: { outputAsset: 'USDC', trustlineEstablished: true } });
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/router client failure/);
  });

  // Regression: a router-client exception (unreachable router, malformed response, etc.)
  // previously propagated out of simulate() as a thrown rejection instead of a SimulationResult
  // with success:false — inconsistent with how a Soroban RPC failure was already handled, and
  // surfaced by a real integration test against a syntactically valid but undeployed contract.
  it('quote()-path router failures (SWAP/direct) also degrade to a graceful simulate() failure, not a rejection', async () => {
    const failingRouter = createDeterministicRouterClient();
    (failingRouter as { quoteSwapChained: unknown }).quoteSwapChained = async () => {
      throw new Error('router unreachable');
    };
    const adapter = makeAdapter({ routerClient: failingRouter });
    const result = await adapter.simulate({ ...swapReq, params: { outputAsset: 'USDC', trustlineEstablished: true } });
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/router unreachable/);
  });

  it('Soroban RPC reporting failure surfaces as a failed simulation, not a thrown exception', async () => {
    const adapter = makeAdapter({ sorobanRpcClient: createDeterministicSorobanRpcClient({ success: false, errors: ['simulation reverted'] }) });
    const result = await adapter.simulate({ ...swapReq, params: { ...swapReq.params, trustlineEstablished: true } });
    expect(result.success).toBe(false);
    expect(result.errors).toContain('simulation reverted');
  });

  it('missing router contract env var throws a clear config error rather than silently using undefined', async () => {
    delete process.env.AQUARIUS_ROUTER_CONTRACT_ID_TESTNET;
    const adapter = makeAdapter();
    await expect(adapter.simulate({ ...swapReq, params: { ...swapReq.params, trustlineEstablished: true } })).rejects.toThrow(/Missing env var/);
  });
});

// ── Deterministic transaction / quote generation ─────────────────────────────────────────────

describe('deterministic generation', () => {
  it('identical requests produce identical quoteHash', async () => {
    const adapter = makeAdapter();
    const q1 = await adapter.quote!(swapReq);
    const q2 = await adapter.quote!(swapReq);
    expect(q1.quoteHash).toBe(q2.quoteHash);
  });

  it('identical requests produce identical transactionHash', async () => {
    const adapter = makeAdapter();
    const t1 = await adapter.buildTransaction!(depositReq);
    const t2 = await adapter.buildTransaction!(depositReq);
    expect(t1.transactionHash).toBe(t2.transactionHash);
  });

  it('different requests produce different transactionHash', async () => {
    const adapter = makeAdapter();
    const t1 = await adapter.buildTransaction!(depositReq);
    const t2 = await adapter.buildTransaction!({ ...depositReq, amount: '999.000000' });
    expect(t1.transactionHash).not.toBe(t2.transactionHash);
  });

  it('500 identical simulate() calls produce identical simulationHash', async () => {
    const adapter = makeAdapter();
    const req = { ...swapReq, params: { ...swapReq.params, trustlineEstablished: true } };
    const hashes = new Set<string>();
    for (let i = 0; i < 500; i++) hashes.add((await adapter.simulate(req)).simulationHash);
    expect(hashes.size).toBe(1);
  });
});

// ── Execution scope ──────────────────────────────────────────────────────────────────────────

describe('execution is explicitly out of scope', () => {
  it('execute() always throws AquariusExecutionNotImplementedError — no transaction is ever submitted', async () => {
    const adapter = makeAdapter();
    await expect(adapter.execute(swapReq)).rejects.toThrow(AquariusExecutionNotImplementedError);
  });
});

// ── Concurrency / stress ─────────────────────────────────────────────────────────────────────

describe('concurrency stress', () => {
  it.each([10, 50, 100])('%i parallel simulate() calls all produce the same deterministic simulationHash', async (n) => {
    const adapter = makeAdapter();
    const req = { ...swapReq, params: { ...swapReq.params, trustlineEstablished: true } };
    const results = await Promise.all(Array.from({ length: n }, () => adapter.simulate(req)));
    expect(results.every((r) => r.success)).toBe(true);
    expect(new Set(results.map((r) => r.simulationHash)).size).toBe(1);
  });

  it.each([10, 50, 100])('%i parallel quote() calls produce identical quoteHash for identical input', async (n) => {
    const adapter = makeAdapter();
    const results = await Promise.all(Array.from({ length: n }, () => adapter.quote!(swapReq)));
    expect(new Set(results.map((r) => r.quoteHash)).size).toBe(1);
  });

  it('registering 100 independent Aquarius adapter instances (one per registry) concurrently is race-free', async () => {
    const registries = await Promise.all(
      Array.from({ length: 100 }, async () => {
        const registry = new ProtocolRegistry();
        registry.register(makeAdapter());
        return registry;
      })
    );
    expect(registries.every((r) => r.has('aquarius'))).toBe(true);
  });
});

// ── Framework conformance (registry rejects malformed Aquarius configs too) ─────────────────

describe('framework conformance', () => {
  it('an Aquarius adapter with an empty supportedAssets list is rejected by the registry (malformed capabilities)', () => {
    const registry = new ProtocolRegistry();
    const adapter = makeAdapter({ supportedAssets: [] });
    expect(() => registry.register(adapter)).toThrow(MalformedAdapterError);
  });
});
