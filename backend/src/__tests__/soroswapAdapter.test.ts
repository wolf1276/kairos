// Soroswap Protocol Adapter — exhaustive test suite. All chain interaction is through
// deterministic in-memory test doubles (testDoubles.ts) — no real Soroban/Soroswap network call
// is made anywhere in this file.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createSoroswapAdapter,
  createDeterministicRouterClient,
  createDeterministicSorobanRpcClient,
  SoroswapExecutionNotImplementedError,
  getSoroswapRouterContractId,
} from '../protocolAdapters/soroswap/index.js';
import { ProtocolRegistry, MalformedAdapterError } from '../protocolAdapters/index.js';
import type { SoroswapAdapterOptions } from '../protocolAdapters/soroswap/index.js';
import type { AdapterActionRequest } from '../protocolAdapters/index.js';

const SUPPORTED_ASSETS = ['XLM', 'USDC', 'AQUA'];
const FUTURE_DEADLINE = Math.floor(Date.now() / 1000) + 3600;

beforeEach(() => {
  process.env.SOROSWAP_ROUTER_CONTRACT_ID_TESTNET = 'CONTRACT-TESTNET-SOROSWAP-ROUTER';
  process.env.SOROSWAP_ROUTER_CONTRACT_ID_MAINNET = 'CONTRACT-MAINNET-SOROSWAP-ROUTER';
});

afterEach(() => {
  delete process.env.SOROSWAP_ROUTER_CONTRACT_ID_TESTNET;
  delete process.env.SOROSWAP_ROUTER_CONTRACT_ID_MAINNET;
});

function makeAdapter(overrides: Partial<SoroswapAdapterOptions> = {}) {
  return createSoroswapAdapter({
    supportedAssets: SUPPORTED_ASSETS,
    routerClient: createDeterministicRouterClient(),
    sorobanRpcClient: createDeterministicSorobanRpcClient(),
    ...overrides,
  });
}

const swapReq: AdapterActionRequest = { action: 'SWAP', asset: 'XLM', network: 'testnet', amount: '100.000000', params: { outputAsset: 'USDC', trustlineEstablished: true, deadline: FUTURE_DEADLINE, minOutput: '1' } };
const chainedReq: AdapterActionRequest = { action: 'SWAP_CHAINED', asset: 'XLM', network: 'testnet', amount: '100.000000', params: { path: ['XLM', 'USDC', 'AQUA'], trustlineEstablished: true, deadline: FUTURE_DEADLINE, minOutput: '1' } };
const addLiquidityReq: AdapterActionRequest = { action: 'ADD_LIQUIDITY', asset: 'XLM', network: 'testnet', amount: '100.000000', params: { assetB: 'USDC', amountB: '50.000000', trustlineEstablished: true } };
const removeLiquidityReq: AdapterActionRequest = { action: 'REMOVE_LIQUIDITY', asset: 'XLM', network: 'testnet', amount: '10.000000', params: { assetB: 'USDC' } };

// ── Registration ──────────────────────────────────────────────────────────────────────────────

describe('registration', () => {
  it('registers cleanly against the shared ProtocolRegistry, using the existing interface unchanged', () => {
    const registry = new ProtocolRegistry();
    const metadata = registry.register(makeAdapter());
    expect(metadata.protocol).toBe('soroswap');
  });

  it('rejects malformed metadata: empty supportedAssets', () => {
    const registry = new ProtocolRegistry();
    const adapter = makeAdapter({ supportedAssets: [] });
    expect(() => registry.register(adapter)).toThrow(MalformedAdapterError);
  });
});

// ── Capabilities ──────────────────────────────────────────────────────────────────────────────

describe('capabilities', () => {
  it('declares swaps, multi-hop swaps, add/remove liquidity', () => {
    const caps = makeAdapter().capabilities();
    expect(caps.supportedActions).toEqual(expect.arrayContaining(['SWAP', 'SWAP_CHAINED', 'ADD_LIQUIDITY', 'REMOVE_LIQUIDITY']));
    expect(caps.batchingSupport).toBe(true);
    expect(caps.supportedNetworks).toEqual(['testnet', 'mainnet']);
  });
});

// ── Quote generation ──────────────────────────────────────────────────────────────────────────

describe('quote generation', () => {
  it('generates a standardized Quote for a direct SWAP', async () => {
    const adapter = makeAdapter();
    const quote = await adapter.quote!(swapReq);
    expect(quote.protocol).toBe('soroswap');
    expect(quote.inputAsset).toBe('XLM');
    expect(quote.outputAsset).toBe('USDC');
    expect(quote.source).toBe('on-chain');
    expect(typeof quote.quoteHash).toBe('string');
  });

  it('generates a Quote for a multi-hop SWAP_CHAINED, route reflects the full path', async () => {
    const adapter = makeAdapter();
    const quote = await adapter.quote!(chainedReq);
    expect(quote.route).toEqual(['XLM', 'USDC', 'AQUA']);
    expect(quote.outputAsset).toBe('AQUA');
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

  it('buildTransaction() for SWAP routes through the router\'s swap_exact_tokens_for_tokens method', async () => {
    const adapter = makeAdapter();
    const tx = await adapter.buildTransaction!(swapReq);
    expect(tx.method).toBe('swap_exact_tokens_for_tokens');
    expect(tx.contractId).toBe(getSoroswapRouterContractId('testnet'));
    expect(tx.args.deadline).toBe(FUTURE_DEADLINE);
  });

  it('simulate() succeeds for multi-hop SWAP_CHAINED', async () => {
    const adapter = makeAdapter();
    const result = await adapter.simulate(chainedReq);
    expect(result.success).toBe(true);
    expect(result.estimatedOutputs.AQUA).toBeDefined();
  });

  it('SWAP_CHAINED preserves the declared path in the built transaction args (token ordering)', async () => {
    const adapter = makeAdapter();
    const tx = await adapter.buildTransaction!(chainedReq);
    expect(tx.args.path).toEqual(['XLM', 'USDC', 'AQUA']);
  });
});

// ── Slippage / deadline safety (swap-specific fund-loss protections) ───────────────────────────

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

  it('a swap with no minOutput is rejected — no slippage protection at all', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...swapReq, params: { ...swapReq.params, minOutput: undefined } });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('minOutput'))).toBe(true);
  });

  it('a swap with minOutput "0" is rejected', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...swapReq, params: { ...swapReq.params, minOutput: '0' } });
    expect(result.ok).toBe(false);
  });

  it('simulate() fails closed when the estimated output would be below minOutput (would revert on-chain)', async () => {
    const adapter = makeAdapter();
    const result = await adapter.simulate({ ...swapReq, params: { ...swapReq.params, minOutput: '999999' } });
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes('below params.minOutput'))).toBe(true);
  });

  it('slippage failure: params.maxSlippagePct above the adapter maximum is rejected', async () => {
    const adapter = makeAdapter({ maxSlippagePct: 2 });
    const result = await adapter.validate({ ...swapReq, params: { ...swapReq.params, maxSlippagePct: 10 } });
    expect(result.ok).toBe(false);
  });

  it('ADD_LIQUIDITY/REMOVE_LIQUIDITY do not require deadline/minOutput (not swap actions)', async () => {
    const adapter = makeAdapter();
    expect((await adapter.validate(addLiquidityReq)).ok).toBe(true);
    expect((await adapter.validate(removeLiquidityReq)).ok).toBe(true);
  });
});

// ── Liquidity operations ─────────────────────────────────────────────────────────────────────

describe('liquidity operations', () => {
  it('simulate() succeeds for ADD_LIQUIDITY and reports minted LP tokens', async () => {
    const adapter = makeAdapter();
    const result = await adapter.simulate(addLiquidityReq);
    expect(result.success).toBe(true);
    expect(result.estimatedOutputs.lpTokensMinted).toBeDefined();
  });

  it('simulate() succeeds for REMOVE_LIQUIDITY and reports returned assets', async () => {
    const adapter = makeAdapter();
    const result = await adapter.simulate(removeLiquidityReq);
    expect(result.success).toBe(true);
    expect(result.estimatedOutputs.assetAReturned).toBeDefined();
    expect(result.estimatedOutputs.assetBReturned).toBeDefined();
  });

  it('buildTransaction() for ADD_LIQUIDITY targets the router\'s add_liquidity method', async () => {
    const adapter = makeAdapter();
    const tx = await adapter.buildTransaction!(addLiquidityReq);
    expect(tx.method).toBe('add_liquidity');
  });

  it('ADD_LIQUIDITY is rejected when no pair exists for the asset pair (real liquidity check)', async () => {
    const adapter = makeAdapter({ routerClient: createDeterministicRouterClient({ pairs: new Set() }) });
    const result = await adapter.validate(addLiquidityReq);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('no Soroswap pair exists'))).toBe(true);
  });
});

// ── Validation ────────────────────────────────────────────────────────────────────────────────

describe('validation', () => {
  it('rejects an unsupported input asset', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...swapReq, asset: 'DOGE' });
    expect(result.ok).toBe(false);
  });

  it('rejects an unsupported action', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...swapReq, action: 'TELEPORT' });
    expect(result.ok).toBe(false);
  });

  it('invalid route: path shorter than 2 hops', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...chainedReq, params: { ...chainedReq.params, path: ['XLM'] } });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('at least 2'))).toBe(true);
  });

  it('invalid route: path not starting at the declared input asset', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...chainedReq, params: { ...chainedReq.params, path: ['USDC', 'XLM', 'AQUA'] } });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('token ordering'))).toBe(true);
  });

  it('invalid route: circular path is rejected', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...chainedReq, params: { ...chainedReq.params, path: ['XLM', 'USDC', 'XLM'] } });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('circular'))).toBe(true);
  });

  it('trustline requirement: a non-native asset without trustlineEstablished is rejected', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...swapReq, params: { ...swapReq.params, trustlineEstablished: undefined } });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('trustline'))).toBe(true);
  });

  it.each(['abc', '-50', 'Infinity', 'NaN', '', '0', '-0.0001'])('invalid amount %j is rejected by validate() and degrades simulate() to failure', async (amount) => {
    const adapter = makeAdapter();
    const validation = await adapter.validate({ ...swapReq, amount });
    expect(validation.ok).toBe(false);
    const result = await adapter.simulate({ ...swapReq, amount });
    expect(result.success).toBe(false);
    expect(result.estimatedFees).toBe('0.000000');
  });

  it('amount with more than 7 decimal places is rejected', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...swapReq, amount: '10.12345678' });
    expect(result.ok).toBe(false);
  });

  it('router unavailable: health() reporting UNAVAILABLE rejects every request, fail-closed', async () => {
    const adapter = makeAdapter({ onHealth: () => 'UNAVAILABLE' });
    const result = await adapter.validate(swapReq);
    expect(result.ok).toBe(false);
  });

  it('a throwing onHealth is treated as UNAVAILABLE, never an uncaught rejection', async () => {
    const adapter = makeAdapter({ onHealth: () => { throw new Error('health check RPC unreachable'); } });
    const validation = await adapter.validate(swapReq);
    expect(validation.ok).toBe(false);
    const result = await adapter.simulate(swapReq);
    expect(result.success).toBe(false);
  });
});

// ── Malformed responses ──────────────────────────────────────────────────────────────────────

describe('malformed responses', () => {
  it('a router client returning a malformed result (undefined outputAmount) is rejected, not silently accepted', async () => {
    const badRouter = createDeterministicRouterClient();
    (badRouter as { quoteSwap: unknown }).quoteSwap = async () => ({ path: ['XLM', 'USDC'], outputAmount: undefined, priceImpactPct: 0 });
    const adapter = makeAdapter({ routerClient: badRouter });
    const result = await adapter.simulate(swapReq);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/Malformed response/);
    await expect(adapter.quote!(swapReq)).rejects.toThrow(/Malformed response/);
  });

  it('missing router contract env var degrades simulate() to a graceful failure with a clear config error, not a thrown rejection', async () => {
    delete process.env.SOROSWAP_ROUTER_CONTRACT_ID_TESTNET;
    const adapter = makeAdapter();
    const result = await adapter.simulate(swapReq);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/Missing env var/);
  });

  it('buildTransaction() still throws for the same missing env var — only simulate() degrades', async () => {
    delete process.env.SOROSWAP_ROUTER_CONTRACT_ID_TESTNET;
    const adapter = makeAdapter();
    await expect(adapter.buildTransaction!(swapReq)).rejects.toThrow(/Missing env var/);
  });

  it('a router client that throws mid-swap degrades simulate() to a graceful failure', async () => {
    const failingRouter = createDeterministicRouterClient();
    (failingRouter as { quoteSwap: unknown }).quoteSwap = async () => { throw new Error('router unreachable'); };
    const adapter = makeAdapter({ routerClient: failingRouter });
    const result = await adapter.simulate(swapReq);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/router unreachable/);
  });

  it('Soroban RPC reporting failure surfaces as a failed simulation, not a thrown exception', async () => {
    const adapter = makeAdapter({ sorobanRpcClient: createDeterministicSorobanRpcClient({ success: false, errors: ['simulation reverted'] }) });
    const result = await adapter.simulate(swapReq);
    expect(result.success).toBe(false);
    expect(result.errors).toContain('simulation reverted');
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
    const t1 = await adapter.buildTransaction!(addLiquidityReq);
    const t2 = await adapter.buildTransaction!(addLiquidityReq);
    expect(t1.transactionHash).toBe(t2.transactionHash);
  });

  it('different requests produce different transactionHash', async () => {
    const adapter = makeAdapter();
    const t1 = await adapter.buildTransaction!(addLiquidityReq);
    const t2 = await adapter.buildTransaction!({ ...addLiquidityReq, amount: '999.000000' });
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
  it('execute() always throws SoroswapExecutionNotImplementedError — no transaction is ever submitted', async () => {
    const adapter = makeAdapter();
    await expect(adapter.execute(swapReq)).rejects.toThrow(SoroswapExecutionNotImplementedError);
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

  it('registering 100 independent Soroswap adapter instances (one per registry) concurrently is race-free', async () => {
    const registries = await Promise.all(
      Array.from({ length: 100 }, async () => {
        const registry = new ProtocolRegistry();
        registry.register(makeAdapter());
        return registry;
      })
    );
    expect(registries.every((r) => r.has('soroswap'))).toBe(true);
  });
});
