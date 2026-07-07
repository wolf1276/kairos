// Phoenix Protocol Adapter — exhaustive test suite. All chain interaction is through
// deterministic in-memory test doubles (testDoubles.ts) — no real Soroban/Phoenix network call
// is made anywhere in this file.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createPhoenixAdapter,
  createDeterministicMultihopClient,
  createDeterministicFactoryClient,
  createDeterministicPoolClient,
  createDeterministicSorobanRpcClient,
  PhoenixExecutionNotImplementedError,
  getPhoenixMultihopContractId,
} from '../protocolAdapters/phoenix/index.js';
import { ProtocolRegistry, MalformedAdapterError } from '../protocolAdapters/index.js';
import type { PhoenixAdapterOptions } from '../protocolAdapters/phoenix/index.js';
import type { AdapterActionRequest } from '../protocolAdapters/index.js';

const SUPPORTED_ASSETS = ['XLM', 'USDC', 'PHO'];

beforeEach(() => {
  process.env.PHOENIX_MULTIHOP_CONTRACT_ID_TESTNET = 'CONTRACT-TESTNET-PHOENIX-MULTIHOP';
  process.env.PHOENIX_MULTIHOP_CONTRACT_ID_MAINNET = 'CONTRACT-MAINNET-PHOENIX-MULTIHOP';
  process.env.PHOENIX_FACTORY_CONTRACT_ID_TESTNET = 'CONTRACT-TESTNET-PHOENIX-FACTORY';
});

afterEach(() => {
  delete process.env.PHOENIX_MULTIHOP_CONTRACT_ID_TESTNET;
  delete process.env.PHOENIX_MULTIHOP_CONTRACT_ID_MAINNET;
  delete process.env.PHOENIX_FACTORY_CONTRACT_ID_TESTNET;
});

function makeAdapter(overrides: Partial<PhoenixAdapterOptions> = {}) {
  return createPhoenixAdapter({
    supportedAssets: SUPPORTED_ASSETS,
    multihopClient: createDeterministicMultihopClient(),
    factoryClient: createDeterministicFactoryClient(),
    poolClient: createDeterministicPoolClient(),
    sorobanRpcClient: createDeterministicSorobanRpcClient(),
    ...overrides,
  });
}

const FUTURE_DEADLINE = Math.floor(Date.now() / 1000) + 3600;
const swapReq: AdapterActionRequest = { action: 'SWAP', asset: 'XLM', network: 'testnet', amount: '100.000000', params: { outputAsset: 'USDC', trustlineEstablished: true, deadline: FUTURE_DEADLINE, minOutput: '1' } };
const chainedReq: AdapterActionRequest = { action: 'SWAP_CHAINED', asset: 'XLM', network: 'testnet', amount: '100.000000', params: { path: ['XLM', 'USDC', 'PHO'], trustlineEstablished: true, deadline: FUTURE_DEADLINE, minOutput: '1' } };
const depositReq: AdapterActionRequest = { action: 'DEPOSIT', asset: 'XLM', network: 'testnet', amount: '100.000000', params: { assetB: 'USDC', trustlineEstablished: true } };
const withdrawReq: AdapterActionRequest = { action: 'WITHDRAW', asset: 'XLM', network: 'testnet', amount: '50.000000', params: { poolId: 'CPOOL-XLM-USDC' } };
const poolDiscoveryReq: AdapterActionRequest = { action: 'POOL_DISCOVERY', asset: 'XLM', network: 'testnet', amount: '0' };

// ── Registration ──────────────────────────────────────────────────────────────────────────────

describe('registration', () => {
  it('registers cleanly against the shared ProtocolRegistry, using the existing interface unchanged', () => {
    const registry = new ProtocolRegistry();
    const metadata = registry.register(makeAdapter());
    expect(metadata.protocol).toBe('phoenix');
  });

  it('rejects malformed metadata: empty supportedAssets', () => {
    const registry = new ProtocolRegistry();
    const adapter = makeAdapter({ supportedAssets: [] });
    expect(() => registry.register(adapter)).toThrow(MalformedAdapterError);
  });
});

// ── Capabilities ──────────────────────────────────────────────────────────────────────────────

describe('capabilities', () => {
  it('declares swaps, multi-hop swaps, liquidity deposit/withdrawal, pool discovery', () => {
    const caps = makeAdapter().capabilities();
    expect(caps.supportedActions).toEqual(expect.arrayContaining(['SWAP', 'SWAP_CHAINED', 'DEPOSIT', 'WITHDRAW', 'POOL_DISCOVERY']));
    expect(caps.batchingSupport).toBe(true);
    expect(caps.supportedNetworks).toEqual(['testnet', 'mainnet']);
  });
});

// ── Quote generation ──────────────────────────────────────────────────────────────────────────

describe('quote generation', () => {
  it('generates a standardized Quote for a direct SWAP', async () => {
    const adapter = makeAdapter();
    const quote = await adapter.quote!(swapReq);
    expect(quote.protocol).toBe('phoenix');
    expect(quote.inputAsset).toBe('XLM');
    expect(quote.outputAsset).toBe('USDC');
    expect(quote.source).toBe('on-chain');
    expect(typeof quote.quoteHash).toBe('string');
  });

  it('generates a Quote for a multi-hop SWAP_CHAINED, route reflects the full path', async () => {
    const adapter = makeAdapter();
    const quote = await adapter.quote!(chainedReq);
    expect(quote.route).toEqual(['XLM', 'USDC', 'PHO']);
    expect(quote.outputAsset).toBe('PHO');
  });

  it('rejects quoting an invalid request rather than returning a garbage quote', async () => {
    const adapter = makeAdapter();
    await expect(adapter.quote!({ ...swapReq, asset: 'DOGE' })).rejects.toThrow();
  });
});

// ── Swap ──────────────────────────────────────────────────────────────────────────────────────

describe('swap', () => {
  it('simulate() succeeds for a valid direct SWAP', async () => {
    const adapter = makeAdapter();
    const result = await adapter.simulate(swapReq);
    expect(result.success).toBe(true);
    expect(result.estimatedOutputs.USDC).toBeDefined();
  });

  it('buildTransaction() for SWAP routes through the multihop contract\'s "swap" method', async () => {
    const adapter = makeAdapter();
    const tx = await adapter.buildTransaction!(swapReq);
    expect(tx.method).toBe('swap');
    expect(tx.contractId).toBe(getPhoenixMultihopContractId('testnet'));
  });

  it('simulate() succeeds for multi-hop SWAP_CHAINED', async () => {
    const adapter = makeAdapter();
    const result = await adapter.simulate(chainedReq);
    expect(result.success).toBe(true);
    expect(result.estimatedOutputs.PHO).toBeDefined();
  });

  it('SWAP_CHAINED preserves the declared path in the built transaction args (token ordering)', async () => {
    const adapter = makeAdapter();
    const tx = await adapter.buildTransaction!(chainedReq);
    expect(tx.args.path).toEqual(['XLM', 'USDC', 'PHO']);
  });
});

// ── Liquidity operations ─────────────────────────────────────────────────────────────────────

describe('liquidity operations', () => {
  it('simulate() succeeds for DEPOSIT and reports estimated LP tokens (queried against the discovered pool contract)', async () => {
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

  it('buildTransaction() for DEPOSIT targets the pool contract discovered via the factory, not the multihop router', async () => {
    const adapter = makeAdapter();
    const tx = await adapter.buildTransaction!(depositReq);
    expect(tx.method).toBe('provide_liquidity');
    expect(tx.contractId).toBe('CPOOL-XLM-USDC');
  });

  it('buildTransaction() for WITHDRAW targets the given pool contract directly', async () => {
    const adapter = makeAdapter();
    const tx = await adapter.buildTransaction!(withdrawReq);
    expect(tx.method).toBe('withdraw_liquidity');
    expect(tx.contractId).toBe('CPOOL-XLM-USDC');
  });

  it('DEPOSIT is rejected when no pool exists for the asset pair (real liquidity check)', async () => {
    const adapter = makeAdapter({ factoryClient: createDeterministicFactoryClient({ pools: [] }) });
    const result = await adapter.validate(depositReq);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('no Phoenix pool exists'))).toBe(true);
  });

  it('pool discovery: POOL_DISCOVERY simulate() lists pools from the factory', async () => {
    const adapter = makeAdapter();
    const result = await adapter.simulate(poolDiscoveryReq);
    expect(result.success).toBe(true);
    expect(result.estimatedOutputs.poolCount).toBe('2');
  });

  it('buildTransaction() rejects POOL_DISCOVERY (read-only, no transaction to build)', async () => {
    const adapter = makeAdapter();
    await expect(adapter.buildTransaction!(poolDiscoveryReq)).rejects.toThrow(/read-only/);
  });
});

// ── Simulation ────────────────────────────────────────────────────────────────────────────────

describe('simulation', () => {
  it('simulate() fails closed for an invalid request, surfacing validation errors', async () => {
    const adapter = makeAdapter();
    const result = await adapter.simulate({ ...swapReq, action: 'TELEPORT' });
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('Soroban RPC reporting failure surfaces as a failed simulation, not a thrown exception', async () => {
    const adapter = makeAdapter({ sorobanRpcClient: createDeterministicSorobanRpcClient({ success: false, errors: ['simulation reverted'] }) });
    const result = await adapter.simulate(swapReq);
    expect(result.success).toBe(false);
    expect(result.errors).toContain('simulation reverted');
  });

  it('router unavailable: health() reporting UNAVAILABLE rejects every request, fail-closed', async () => {
    const adapter = makeAdapter({ onHealth: () => 'UNAVAILABLE' });
    const result = await adapter.validate(swapReq);
    expect(result.ok).toBe(false);
  });

  it('DEGRADED health does not by itself reject a request', async () => {
    const adapter = makeAdapter({ onHealth: () => 'DEGRADED' });
    const result = await adapter.validate(swapReq);
    expect(result.ok).toBe(true);
  });

  // Regression (final production audit): a throwing `onHealth` (e.g. a real health check whose
  // own RPC call fails) previously propagated as an uncaught rejection out of validate() and
  // simulate() — treated identically to a hard crash instead of the UNAVAILABLE status it
  // actually represents.
  it('a throwing onHealth is treated as UNAVAILABLE, never an uncaught rejection', async () => {
    const adapter = makeAdapter({ onHealth: () => { throw new Error('health check RPC unreachable'); } });
    const validation = await adapter.validate(swapReq);
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes('not available'))).toBe(true);
    const result = await adapter.simulate(swapReq);
    expect(result.success).toBe(false);
  });
});

// ── Unsupported assets / invalid routes ──────────────────────────────────────────────────────

describe('unsupported assets and invalid routes', () => {
  it('rejects an unsupported input asset', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...swapReq, asset: 'DOGE' });
    expect(result.ok).toBe(false);
  });

  it('rejects an unsupported output asset', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...swapReq, params: { outputAsset: 'SHIB', trustlineEstablished: true } });
    expect(result.ok).toBe(false);
  });

  it('rejects an unsupported action', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...swapReq, action: 'TELEPORT' });
    expect(result.ok).toBe(false);
  });

  it('invalid route: path shorter than 2 hops', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...chainedReq, params: { path: ['XLM'], trustlineEstablished: true } });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/at least 2/);
  });

  it('invalid route: path not starting at the declared input asset (token ordering)', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...chainedReq, params: { path: ['USDC', 'XLM', 'PHO'], trustlineEstablished: true } });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('token ordering'))).toBe(true);
  });

  it('invalid route: repeated adjacent hop', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...chainedReq, params: { path: ['XLM', 'XLM', 'USDC'], trustlineEstablished: true } });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('repeated hop'))).toBe(true);
  });

  // Regression (Protocol Layer final production audit): a circular route (revisiting an asset
  // via a non-adjacent hop) previously passed validation — only immediately-adjacent repeats
  // were rejected.
  it('invalid route: circular (revisiting an asset non-adjacently)', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...chainedReq, params: { path: ['XLM', 'USDC', 'XLM'], trustlineEstablished: true } });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('circular'))).toBe(true);
  });

  it('amount with more than 7 decimal places is rejected (not a valid Stellar asset amount)', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...swapReq, amount: '10.12345678' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('decimal places'))).toBe(true);
  });

  it('amount with exactly 7 decimal places is accepted', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...swapReq, amount: '10.1234567' });
    expect(result.ok).toBe(true);
  });

  it('invalid route: no pool exists for a hop (liquidity check)', async () => {
    const adapter = makeAdapter({ factoryClient: createDeterministicFactoryClient({ pools: [] }) });
    const result = await adapter.validate(swapReq);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('no Phoenix pool exists'))).toBe(true);
  });

  it('slippage failure: params.maxSlippagePct above the adapter maximum is rejected', async () => {
    const adapter = makeAdapter({ maxSlippagePct: 2 });
    const result = await adapter.validate({ ...swapReq, params: { ...swapReq.params, maxSlippagePct: 10 } });
    expect(result.ok).toBe(false);
  });

  it('trustline requirement: a non-native asset without trustlineEstablished is rejected', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...swapReq, params: { outputAsset: 'USDC' } });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('trustline'))).toBe(true);
  });

  it('invalid pool type is rejected', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...swapReq, params: { ...swapReq.params, poolType: 'weighted' } });
    expect(result.ok).toBe(false);
  });
});

// ── Slippage / deadline safety (swap-specific fund-loss protections) ───────────────────────────
// Regression (Protocol Layer final production audit): the Soroswap adapter's audit found and
// fixed a missing swap deadline/minOutput check; Phoenix's SWAP/SWAP_CHAINED validation had the
// exact same gap (buildRouterArgs already threaded `minOutput` through, but nothing required the
// caller supply one or a deadline) — fixed identically here.

describe('slippage and deadline safety', () => {
  it('a swap with no deadline is rejected — an undated swap has no protection against stale-price execution', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...swapReq, params: { ...swapReq.params, deadline: undefined } });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('deadline'))).toBe(true);
  });

  it('a swap with a past deadline is rejected', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...swapReq, params: { ...swapReq.params, deadline: Math.floor(Date.now() / 1000) - 100 } });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('past'))).toBe(true);
  });

  it('a swap with no minOutput is rejected — no slippage protection', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...swapReq, params: { ...swapReq.params, minOutput: undefined } });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('minOutput'))).toBe(true);
  });

  it('a swap with a zero or negative minOutput is rejected', async () => {
    const adapter = makeAdapter();
    const zero = await adapter.validate({ ...swapReq, params: { ...swapReq.params, minOutput: '0' } });
    expect(zero.ok).toBe(false);
    const negative = await adapter.validate({ ...swapReq, params: { ...swapReq.params, minOutput: '-5' } });
    expect(negative.ok).toBe(false);
  });

  it('SWAP_CHAINED also requires deadline and minOutput', async () => {
    const adapter = makeAdapter();
    const noDeadline = await adapter.validate({ ...chainedReq, params: { ...chainedReq.params, deadline: undefined } });
    expect(noDeadline.ok).toBe(false);
    const noMinOutput = await adapter.validate({ ...chainedReq, params: { ...chainedReq.params, minOutput: undefined } });
    expect(noMinOutput.ok).toBe(false);
  });

  it('DEPOSIT/WITHDRAW/POOL_DISCOVERY do not require deadline/minOutput (not swap actions)', async () => {
    expect((await makeAdapter().validate(depositReq)).ok).toBe(true);
    expect((await makeAdapter().validate(withdrawReq)).ok).toBe(true);
    expect((await makeAdapter().validate(poolDiscoveryReq)).ok).toBe(true);
  });

  it('a swap with a valid future deadline and positive minOutput passes this check', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate(swapReq);
    expect(result.ok).toBe(true);
  });
});

// ── Malformed responses ──────────────────────────────────────────────────────────────────────

describe('malformed responses', () => {
  it('a factory client that throws is surfaced as a graceful simulate() failure, not a crash', async () => {
    const adapter = makeAdapter({ factoryClient: createDeterministicFactoryClient({ failListPools: true }) });
    const result = await adapter.simulate(poolDiscoveryReq);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/client failure/);
  });

  // Regression (production audit): DEPOSIT/WITHDRAW's contractId resolution originally called
  // `factoryClient.findPoolByPair` *before* simulate()'s try/catch, so a factory failure during
  // that specific lookup propagated as an uncaught rejection instead of a graceful
  // SimulationResult — the same bug class fixed in the Aquarius integration. This must be
  // impossible for every action that resolves a contract id via a client call, not just
  // POOL_DISCOVERY.
  it('a factory client that throws while resolving the pool for DEPOSIT degrades to a graceful failure, not a rejection', async () => {
    const failingFactory = createDeterministicFactoryClient();
    (failingFactory as { findPoolByPair: unknown }).findPoolByPair = async () => {
      throw new Error('factory unreachable');
    };
    const adapter = makeAdapter({ factoryClient: failingFactory });
    const result = await adapter.simulate(depositReq);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/factory unreachable/);
  });

  it('missing multihop contract env var degrades simulate() to a graceful failure with a clear config error, not a thrown rejection', async () => {
    delete process.env.PHOENIX_MULTIHOP_CONTRACT_ID_TESTNET;
    const adapter = makeAdapter();
    const result = await adapter.simulate(swapReq);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/Missing env var/);
  });

  it('buildTransaction() still throws (not gracefully-failing) for the same missing env var — only simulate() degrades', async () => {
    delete process.env.PHOENIX_MULTIHOP_CONTRACT_ID_TESTNET;
    const adapter = makeAdapter();
    await expect(adapter.buildTransaction!(swapReq)).rejects.toThrow(/Missing env var/);
  });

  it('a multihop client that throws mid-swap degrades quote() building, and simulate() reports it gracefully', async () => {
    const failingMultihop = createDeterministicMultihopClient();
    (failingMultihop as { simulateSwap: unknown }).simulateSwap = async () => {
      throw new Error('multihop unreachable');
    };
    const adapter = makeAdapter({ multihopClient: failingMultihop });
    const result = await adapter.simulate(swapReq);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/multihop unreachable/);
  });

  // Regression (final production audit — found via adversarial testing, not by extending
  // existing test cases): `request.amount` was never validated. A non-numeric string, "NaN",
  // "Infinity", empty string, or a negative value all passed validate() cleanly and then produced
  // `estimatedFees: "NaN"` / `"Infinity"` / a negative fee inside an otherwise `success: true`
  // SimulationResult — a caller had no way to distinguish this from a real, trustworthy result.
  it.each(['abc', '-50', 'Infinity', 'NaN', '', '-0.0001'])('invalid amount %j is rejected by validate() and degrades simulate() to failure, never producing a NaN/Infinity/negative fee', async (amount) => {
    const adapter = makeAdapter();
    const validation = await adapter.validate({ ...swapReq, amount });
    expect(validation.ok).toBe(false);
    const result = await adapter.simulate({ ...swapReq, amount });
    expect(result.success).toBe(false);
    expect(result.estimatedFees).toBe('0.000000');
  });

  it('amount "0" is accepted (a zero-amount POOL_DISCOVERY-style request is legitimate, not an attack)', async () => {
    const adapter = makeAdapter();
    const validation = await adapter.validate({ ...poolDiscoveryReq, amount: '0' });
    expect(validation.ok).toBe(true);
  });

  // Regression: a multihop client returning a malformed MultihopSwapResult (missing/non-string
  // outputAmount) previously produced a `success: true` quote/simulation with the output amount
  // silently absent (dropped by JSON serialization, never surfaced as an error).
  it('a multihop client returning a malformed result (undefined outputAmount) is rejected, not silently accepted', async () => {
    const badMultihop = createDeterministicMultihopClient();
    (badMultihop as { simulateSwap: unknown }).simulateSwap = async () => ({ outputAmount: undefined, spreadAmount: '0', totalCommission: '0' });
    const adapter = makeAdapter({ multihopClient: badMultihop });
    const result = await adapter.simulate(swapReq);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/Malformed response/);
    await expect(adapter.quote!(swapReq)).rejects.toThrow(/Malformed response/);
  });

  it('a multihop client returning a non-numeric outputAmount string is rejected', async () => {
    const badMultihop = createDeterministicMultihopClient();
    (badMultihop as { simulateSwap: unknown }).simulateSwap = async () => ({ outputAmount: 'not-a-number', spreadAmount: '0', totalCommission: '0' });
    const adapter = makeAdapter({ multihopClient: badMultihop });
    const result = await adapter.simulate(swapReq);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/Malformed response/);
  });

  // Regression: a factory client returning a pool with a missing/non-string poolId previously
  // produced a `success: true` DEPOSIT simulation and a buildTransaction() result whose
  // contractId was silently absent.
  it('a factory client returning a pool with an undefined poolId is rejected, not silently accepted', async () => {
    const badFactory = createDeterministicFactoryClient();
    (badFactory as { findPoolByPair: unknown }).findPoolByPair = async () => ({ poolId: undefined, assetA: 'XLM', assetB: 'USDC', poolType: 'xyk' });
    const adapter = makeAdapter({ factoryClient: badFactory });
    const result = await adapter.simulate(depositReq);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/Malformed response/);
    await expect(adapter.buildTransaction!(depositReq)).rejects.toThrow(/Malformed response/);
  });
});

// ── Deterministic hashes / replay ────────────────────────────────────────────────────────────

describe('deterministic hashes and replay', () => {
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

  it('replay: 500 identical simulate() calls produce identical simulationHash', async () => {
    const adapter = makeAdapter();
    const hashes = new Set<string>();
    for (let i = 0; i < 500; i++) hashes.add((await adapter.simulate(swapReq)).simulationHash);
    expect(hashes.size).toBe(1);
  });
});

// ── Execution scope ──────────────────────────────────────────────────────────────────────────

describe('execution is explicitly out of scope', () => {
  it('execute() always throws PhoenixExecutionNotImplementedError — no transaction is ever submitted', async () => {
    const adapter = makeAdapter();
    await expect(adapter.execute(swapReq)).rejects.toThrow(PhoenixExecutionNotImplementedError);
  });
});

// ── Concurrency / stress ─────────────────────────────────────────────────────────────────────

describe('concurrency stress', () => {
  it.each([10, 50, 100, 250])('%i parallel simulate() calls all produce the same deterministic simulationHash', async (n) => {
    const adapter = makeAdapter();
    const results = await Promise.all(Array.from({ length: n }, () => adapter.simulate(swapReq)));
    expect(results.every((r) => r.success)).toBe(true);
    expect(new Set(results.map((r) => r.simulationHash)).size).toBe(1);
  });

  it.each([10, 50, 100, 250])('%i parallel quote() calls produce identical quoteHash for identical input', async (n) => {
    const adapter = makeAdapter();
    const results = await Promise.all(Array.from({ length: n }, () => adapter.quote!(swapReq)));
    expect(new Set(results.map((r) => r.quoteHash)).size).toBe(1);
  });

  it('registering 100 independent Phoenix adapter instances (one per registry) concurrently is race-free', async () => {
    const registries = await Promise.all(
      Array.from({ length: 100 }, async () => {
        const registry = new ProtocolRegistry();
        registry.register(makeAdapter());
        return registry;
      })
    );
    expect(registries.every((r) => r.has('phoenix'))).toBe(true);
  });
});
