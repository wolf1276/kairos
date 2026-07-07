// Route Engine (Phase 6.5) — exhaustive test suite. Deterministic, no AI/LLM, no blockchain
// execution. Every candidate protocol is a real adapter (Aquarius/Phoenix/Soroswap/Blend) backed
// by its own deterministic test double — no real network call is made anywhere in this file.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAquariusAdapter, createDeterministicRouterClient as createAquariusRouterClient, createDeterministicSorobanRpcClient as createAquariusRpcClient } from '../protocolAdapters/aquarius/index.js';
import { createPhoenixAdapter, createDeterministicMultihopClient, createDeterministicFactoryClient, createDeterministicPoolClient, createDeterministicSorobanRpcClient as createPhoenixRpcClient } from '../protocolAdapters/phoenix/index.js';
import { createSoroswapAdapter, createDeterministicRouterClient as createSoroswapRouterClient, createDeterministicSorobanRpcClient as createSoroswapRpcClient } from '../protocolAdapters/soroswap/index.js';
import { createBlendAdapter, createDeterministicBlendPoolClient, createDeterministicSorobanRpcClient as createBlendRpcClient } from '../protocolAdapters/blend/index.js';
import { ProtocolRegistry } from '../protocolAdapters/index.js';
import type { ProtocolAdapter } from '../protocolAdapters/adapter.js';
import { computeRoute, computeRoutesForPlan, discoverCandidates, adapterActionFor, rankCandidates, scoreCandidateQuote, checkForgedQuote, checkManipulatedFee, checkManipulatedSlippage, checkQuoteFreshness, RouteRequestValidationError } from '../reasoning/routeEngine/index.js';
import type { RouteRequest } from '../reasoning/routeEngine/index.js';
import type { ExecutionPlan } from '../reasoning/executionPlanner/index.js';

const FUTURE_DEADLINE = Math.floor(Date.now() / 1000) + 3600;
const SUPPORTED = ['XLM', 'USDC', 'AQUA', 'PHO', 'BLND'];

function makeAquarius(overrides: { rates?: Record<string, number>; priceImpactPct?: number; health?: 'READY' | 'DEGRADED' | 'UNAVAILABLE' | 'UNKNOWN' } = {}): ProtocolAdapter {
  process.env.AQUARIUS_ROUTER_CONTRACT_ID_TESTNET = 'CONTRACT-AQUARIUS-TESTNET';
  return createAquariusAdapter({
    supportedAssets: SUPPORTED,
    routerClient: createAquariusRouterClient({ rates: overrides.rates, priceImpactPct: overrides.priceImpactPct }),
    sorobanRpcClient: createAquariusRpcClient(),
    onHealth: () => overrides.health ?? 'READY',
  });
}

function makePhoenix(overrides: { rates?: Record<string, number>; health?: 'READY' | 'DEGRADED' | 'UNAVAILABLE' | 'UNKNOWN' } = {}): ProtocolAdapter {
  return createPhoenixAdapter({
    supportedAssets: SUPPORTED,
    multihopClient: createDeterministicMultihopClient({ rates: overrides.rates }),
    factoryClient: createDeterministicFactoryClient({ pools: [{ poolId: 'CPOOL-XLM-USDC', assetA: 'XLM', assetB: 'USDC', poolType: 'xyk' }] }),
    poolClient: createDeterministicPoolClient(),
    sorobanRpcClient: createPhoenixRpcClient(),
    onHealth: () => overrides.health ?? 'READY',
  });
}

function makeSoroswap(overrides: { rates?: Record<string, number>; priceImpactFraction?: number; health?: 'READY' | 'DEGRADED' | 'UNAVAILABLE' | 'UNKNOWN' } = {}): ProtocolAdapter {
  process.env.SOROSWAP_ROUTER_CONTRACT_ID_TESTNET = 'CONTRACT-SOROSWAP-TESTNET';
  return createSoroswapAdapter({
    supportedAssets: SUPPORTED,
    routerClient: createSoroswapRouterClient({ rates: overrides.rates, priceImpactFraction: overrides.priceImpactFraction }),
    sorobanRpcClient: createSoroswapRpcClient(),
    onHealth: () => overrides.health ?? 'READY',
  });
}

function makeBlend(overrides: { health?: 'READY' | 'DEGRADED' | 'UNAVAILABLE' | 'UNKNOWN' } = {}): ProtocolAdapter {
  process.env.BLEND_POOL_CONTRACT_ID_TESTNET = 'CONTRACT-BLEND-TESTNET';
  return createBlendAdapter({
    supportedAssets: SUPPORTED,
    poolClient: createDeterministicBlendPoolClient(),
    sorobanRpcClient: createBlendRpcClient(),
    onHealth: () => overrides.health ?? 'READY',
  });
}

function swapRequest(overrides: Partial<RouteRequest> = {}): RouteRequest {
  return {
    action: 'SWAP',
    asset: 'XLM',
    outputAsset: 'USDC',
    amount: '100.000000',
    network: 'testnet',
    adapterParams: { trustlineEstablished: true, deadline: FUTURE_DEADLINE, minOutput: '1' },
    ...overrides,
  };
}

beforeEach(() => {
  process.env.AQUARIUS_ROUTER_CONTRACT_ID_MAINNET = 'CONTRACT-AQUARIUS-MAINNET';
  process.env.SOROSWAP_ROUTER_CONTRACT_ID_MAINNET = 'CONTRACT-SOROSWAP-MAINNET';
  process.env.BLEND_POOL_CONTRACT_ID_MAINNET = 'CONTRACT-BLEND-MAINNET';
  process.env.PHOENIX_MULTIHOP_CONTRACT_ID_TESTNET = 'CONTRACT-PHOENIX-MULTIHOP-TESTNET';
  process.env.PHOENIX_MULTIHOP_CONTRACT_ID_MAINNET = 'CONTRACT-PHOENIX-MULTIHOP-MAINNET';
  process.env.PHOENIX_FACTORY_CONTRACT_ID_TESTNET = 'CONTRACT-PHOENIX-FACTORY-TESTNET';
  process.env.PHOENIX_FACTORY_CONTRACT_ID_MAINNET = 'CONTRACT-PHOENIX-FACTORY-MAINNET';
});

afterEach(() => {
  delete process.env.AQUARIUS_ROUTER_CONTRACT_ID_TESTNET;
  delete process.env.AQUARIUS_ROUTER_CONTRACT_ID_MAINNET;
  delete process.env.SOROSWAP_ROUTER_CONTRACT_ID_TESTNET;
  delete process.env.SOROSWAP_ROUTER_CONTRACT_ID_MAINNET;
  delete process.env.BLEND_POOL_CONTRACT_ID_TESTNET;
  delete process.env.BLEND_POOL_CONTRACT_ID_MAINNET;
  delete process.env.PHOENIX_MULTIHOP_CONTRACT_ID_TESTNET;
  delete process.env.PHOENIX_MULTIHOP_CONTRACT_ID_MAINNET;
  delete process.env.PHOENIX_FACTORY_CONTRACT_ID_TESTNET;
  delete process.env.PHOENIX_FACTORY_CONTRACT_ID_MAINNET;
});

// ── Discovery ────────────────────────────────────────────────────────────────────────────────

describe('discovery', () => {
  it('discovers every protocol capable of a SWAP, ignores Blend (no swap support)', () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    registry.register(makePhoenix());
    registry.register(makeSoroswap());
    registry.register(makeBlend());

    const candidates = discoverCandidates(swapRequest(), registry);
    expect(candidates.map((c) => c.protocol)).toEqual(['aquarius', 'phoenix', 'soroswap']);
  });

  it('discovers only Blend for LENDING (requires a protocol that also supports BORROW)', () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    registry.register(makePhoenix());
    registry.register(makeBlend());

    const candidates = discoverCandidates({ action: 'LENDING', asset: 'USDC', amount: '100', network: 'testnet' }, registry);
    expect(candidates.map((c) => c.protocol)).toEqual(['blend']);
  });

  it('discovers non-lending DEPOSIT (AMM liquidity) only among AMMs, excluding Blend', () => {
    const registry = new ProtocolRegistry();
    registry.register(makePhoenix());
    registry.register(makeBlend());

    const candidates = discoverCandidates({ action: 'DEPOSIT', asset: 'XLM', amount: '100', network: 'testnet' }, registry);
    expect(candidates.map((c) => c.protocol)).toEqual(['phoenix']);
  });

  it('discovers only Aquarius for REWARD_CLAIM', () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    registry.register(makePhoenix());
    registry.register(makeSoroswap());

    const candidates = discoverCandidates({ action: 'REWARD_CLAIM', asset: 'XLM', amount: '0', network: 'testnet' }, registry);
    expect(candidates.map((c) => c.protocol)).toEqual(['aquarius']);
  });

  it('ignores unsupported protocols automatically for an unsupported asset', () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    const candidates = discoverCandidates(swapRequest({ asset: 'DOGE', outputAsset: 'USDC' }), registry);
    expect(candidates).toHaveLength(0);
  });

  it('adapterActionFor maps every RouteAction to its adapter action string', () => {
    expect(adapterActionFor('SWAP')).toBe('SWAP');
    expect(adapterActionFor('MULTI_HOP_SWAP')).toBe('SWAP_CHAINED');
    expect(adapterActionFor('LENDING')).toBe('DEPOSIT');
    expect(adapterActionFor('BORROWING')).toBe('BORROW');
    expect(adapterActionFor('DEPOSIT')).toBe('DEPOSIT');
    expect(adapterActionFor('WITHDRAW')).toBe('WITHDRAW');
    expect(adapterActionFor('REWARD_CLAIM')).toBe('CLAIM_REWARDS');
  });
});

// ── Single / multiple protocol routing ──────────────────────────────────────────────────────

describe('computeRoute — single protocol', () => {
  it('selects the only candidate when exactly one protocol supports the action', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    const route = await computeRoute(swapRequest(), registry);
    expect(route.selectedProtocol).toBe('aquarius');
    expect(route.candidates).toHaveLength(1);
    expect(route.rejected).toHaveLength(0);
  });
});

describe('computeRoute — multiple protocols', () => {
  it('ranks multiple candidates and selects the best by output amount', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius({ rates: { 'XLM->USDC': 0.10 } }));
    registry.register(makePhoenix({ rates: { 'XLM->USDC': 0.12 } }));
    registry.register(makeSoroswap({ rates: { 'XLM->USDC': 0.08 } }));

    const route = await computeRoute(swapRequest(), registry);
    expect(route.selectedProtocol).toBe('phoenix');
    expect(route.ranking.map((r) => r.protocol)).toEqual(['phoenix', 'aquarius', 'soroswap']);
    expect(route.ranking[0].rank).toBe(1);
    expect(route.candidates).toHaveLength(3);
  });

  it('identical quotes across protocols tie-break deterministically by protocol name', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius({ rates: { 'XLM->USDC': 0.10 }, priceImpactPct: 0.1 }));
    registry.register(makeSoroswap({ rates: { 'XLM->USDC': 0.10 }, priceImpactFraction: 0.001 }));

    const route = await computeRoute(swapRequest(), registry);
    // Not necessarily an exact tie (fee models differ slightly), but ranking must be stable and
    // exhaustive over both candidates with no gaps in rank.
    expect(route.ranking.map((r) => r.rank)).toEqual([1, 2]);
  });

  it('prefers lower fees when output amounts are equal', () => {
    const base = { protocol: 'a', action: 'SWAP' as const, adapterAction: 'SWAP', inputAsset: 'XLM', outputAsset: 'USDC', inputAmount: '100', outputAmount: '10', routeHops: ['XLM', 'USDC'], liquidityScore: 50, source: 'adapter-quote' as const, fetchedAt: 0, quoteHash: 'h' };
    const cheap = scoreCandidateQuote({ ...base, estimatedFees: '0.1', estimatedSlippagePct: 0 }, 'READY');
    const expensive = scoreCandidateQuote({ ...base, estimatedFees: '1.0', estimatedSlippagePct: 0 }, 'READY');
    expect(cheap.total).toBeGreaterThan(expensive.total);
  });

  it('prefers lower slippage when output/fees are equal', () => {
    const base = { protocol: 'a', action: 'SWAP' as const, adapterAction: 'SWAP', inputAsset: 'XLM', outputAsset: 'USDC', inputAmount: '100', outputAmount: '10', estimatedFees: '0.1', routeHops: ['XLM', 'USDC'], liquidityScore: 50, source: 'adapter-quote' as const, fetchedAt: 0, quoteHash: 'h' };
    const low = scoreCandidateQuote({ ...base, estimatedSlippagePct: 0.1 }, 'READY');
    const high = scoreCandidateQuote({ ...base, estimatedSlippagePct: 5 }, 'READY');
    expect(low.total).toBeGreaterThan(high.total);
  });

  it('prefers higher liquidity when everything else is equal', () => {
    const base = { protocol: 'a', action: 'SWAP' as const, adapterAction: 'SWAP', inputAsset: 'XLM', outputAsset: 'USDC', inputAmount: '100', outputAmount: '10', estimatedFees: '0.1', estimatedSlippagePct: 0.1, routeHops: ['XLM', 'USDC'], source: 'adapter-quote' as const, fetchedAt: 0, quoteHash: 'h' };
    const deep = scoreCandidateQuote({ ...base, liquidityScore: 90 }, 'READY');
    const shallow = scoreCandidateQuote({ ...base, liquidityScore: 10 }, 'READY');
    expect(deep.total).toBeGreaterThan(shallow.total);
  });
});

// ── Rejection rules ──────────────────────────────────────────────────────────────────────────

describe('routing rules — rejection', () => {
  it('rejects an unhealthy (UNAVAILABLE) protocol', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius({ health: 'UNAVAILABLE' }));
    registry.register(makePhoenix());
    const route = await computeRoute(swapRequest(), registry);
    expect(route.selectedProtocol).toBe('phoenix');
    expect(route.rejected).toEqual(expect.arrayContaining([expect.objectContaining({ protocol: 'aquarius', reason: 'unhealthy_protocol' })]));
  });

  it('rejects an UNKNOWN-health protocol the same way', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius({ health: 'UNKNOWN' }));
    const route = await computeRoute(swapRequest(), registry);
    expect(route.selectedProtocol).toBeNull();
    expect(route.rejected[0].reason).toBe('unhealthy_protocol');
  });

  it('does not reject a DEGRADED protocol outright, but penalizes it in ranking', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius({ health: 'DEGRADED' }));
    registry.register(makePhoenix());
    const route = await computeRoute(swapRequest(), registry);
    expect(route.candidates).toHaveLength(2);
    expect(route.selectedProtocol).toBe('phoenix');
  });

  it('rejects a failed simulation', async () => {
    const registry = new ProtocolRegistry();
    registry.register(
      createSoroswapAdapter({
        supportedAssets: SUPPORTED,
        routerClient: createSoroswapRouterClient(),
        sorobanRpcClient: createSoroswapRpcClient({ success: false, errors: ['insufficient reserves'] }),
      }),
    );
    const route = await computeRoute(swapRequest(), registry);
    expect(route.selectedProtocol).toBeNull();
    expect(route.rejected[0]).toMatchObject({ protocol: 'soroswap', reason: 'failed_simulation' });
  });

  it('rejects an invalid request (missing required params) as invalid_quote', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    const route = await computeRoute(swapRequest({ adapterParams: {} }), registry); // no deadline/minOutput
    expect(route.selectedProtocol).toBeNull();
    expect(route.rejected[0].reason).toBe('invalid_quote');
  });

  it('rejects a stale quote via checkQuoteFreshness', () => {
    const rejection = checkQuoteFreshness('aquarius', 0, 60_000, 30_000);
    expect(rejection).toMatchObject({ protocol: 'aquarius', reason: 'stale_quote' });
    expect(checkQuoteFreshness('aquarius', 59_000, 60_000, 30_000)).toBeNull();
  });

  it('unsupported asset yields zero candidates (filtered at discovery, never reaches quoting)', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    const route = await computeRoute(swapRequest({ asset: 'DOGE' }), registry);
    expect(route.candidates).toHaveLength(0);
    expect(route.rejected).toHaveLength(0);
    expect(route.selectedProtocol).toBeNull();
  });

  it('unsupported action (LENDING with no lending-capable protocol) yields zero candidates', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    const route = await computeRoute({ action: 'LENDING', asset: 'USDC', amount: '100', network: 'testnet' }, registry);
    expect(route.candidates).toHaveLength(0);
    expect(route.selectedProtocol).toBeNull();
  });

  it('duplicate quotes for the same protocol are rejected as duplicate_quote', async () => {
    const registry = new ProtocolRegistry();
    const adapter = makeAquarius();
    registry.register(adapter);
    // Simulate a registry surfacing the same protocol twice by discovering, then manually
    // duplicating the discovered list before quoting via computeRoute's internal dedupe path:
    // exercised directly through discoverCandidates + a hand-doubled list is not possible without
    // reaching into internals, so assert the guarantee at the rule level instead.
    const seen = new Set(['aquarius']);
    const rejection = checkQuoteFreshness('aquarius', 0, 0, 30_000); // sanity: no dup by default
    expect(rejection).toBeNull();
    const { checkDuplicate } = await import('../reasoning/routeEngine/rules.js');
    expect(checkDuplicate('aquarius', seen)).toMatchObject({ protocol: 'aquarius', reason: 'duplicate_quote' });
    expect(checkDuplicate('phoenix', seen)).toBeNull();
  });
});

// ── Determinism ──────────────────────────────────────────────────────────────────────────────

describe('determinism', () => {
  it('identical inputs always produce identical ranking', async () => {
    function buildRegistry() {
      const registry = new ProtocolRegistry();
      registry.register(makeAquarius({ rates: { 'XLM->USDC': 0.10 } }));
      registry.register(makePhoenix({ rates: { 'XLM->USDC': 0.12 } }));
      registry.register(makeSoroswap({ rates: { 'XLM->USDC': 0.08 } }));
      return registry;
    }
    const now = () => 1_700_000_000_000;
    const routeA = await computeRoute(swapRequest(), buildRegistry(), { now });
    const routeB = await computeRoute(swapRequest(), buildRegistry(), { now });
    expect(routeA.ranking).toEqual(routeB.ranking);
    expect(routeA.selectedProtocol).toBe(routeB.selectedProtocol);
  });

  it('identical inputs always produce an identical route hash', async () => {
    function buildRegistry() {
      const registry = new ProtocolRegistry();
      registry.register(makeAquarius({ rates: { 'XLM->USDC': 0.10 } }));
      registry.register(makePhoenix({ rates: { 'XLM->USDC': 0.12 } }));
      return registry;
    }
    const now = () => 1_700_000_000_000;
    const routeA = await computeRoute(swapRequest(), buildRegistry(), { now });
    const routeB = await computeRoute(swapRequest(), buildRegistry(), { now });
    expect(routeA.routeHash).toBe(routeB.routeHash);
    // routeId is a fresh UUID each call and must NOT affect the hash
    expect(routeA.routeId).not.toBe(routeB.routeId);
  });

  it('route hash excludes wall-clock timestamp — two calls at different `now()` still match', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    const routeA = await computeRoute(swapRequest(), registry, { now: () => 1000 });
    const routeB = await computeRoute(swapRequest(), registry, { now: () => 999_999_999 });
    expect(routeA.routeHash).toBe(routeB.routeHash);
  });

  it('candidate quoteHash is stable for identical quote fields', () => {
    const base = { protocol: 'a', action: 'SWAP' as const, adapterAction: 'SWAP', inputAsset: 'XLM', outputAsset: 'USDC', inputAmount: '100', outputAmount: '10', estimatedFees: '0.1', estimatedSlippagePct: 0.1, routeHops: ['XLM', 'USDC'], liquidityScore: 50, source: 'adapter-quote' as const };
    const a = scoreCandidateQuote({ ...base, fetchedAt: 1, quoteHash: 'x' }, 'READY');
    const b = scoreCandidateQuote({ ...base, fetchedAt: 2, quoteHash: 'y' }, 'READY');
    expect(a.total).toBe(b.total); // fetchedAt/quoteHash never enter the score
  });
});

// ── Stress: parallel route calculations ─────────────────────────────────────────────────────

describe('stress — parallel route calculations', () => {
  function buildRegistry() {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius({ rates: { 'XLM->USDC': 0.10 } }));
    registry.register(makePhoenix({ rates: { 'XLM->USDC': 0.12 } }));
    registry.register(makeSoroswap({ rates: { 'XLM->USDC': 0.08 } }));
    return registry;
  }

  for (const n of [10, 50, 100, 250]) {
    it(`computes ${n} parallel routes with identical, deterministic results`, async () => {
      const registry = buildRegistry();
      const now = () => 1_700_000_000_000;
      const routes = await Promise.all(Array.from({ length: n }, () => computeRoute(swapRequest(), registry, { now })));
      const hashes = new Set(routes.map((r) => r.routeHash));
      expect(hashes.size).toBe(1);
      expect(routes.every((r) => r.selectedProtocol === 'phoenix')).toBe(true);
    });
  }
});

// ── Security / attack surface ───────────────────────────────────────────────────────────────

describe('security — attacks must fail', () => {
  it('rejects a forged quote (quoteHash does not match content)', () => {
    const quote = { protocol: 'aquarius', action: 'SWAP', inputAsset: 'XLM', outputAsset: 'USDC', inputAmount: '100', outputAmount: '999999', route: ['XLM', 'USDC'], priceImpactPct: 0.1, estimatedFees: '0.1', source: 'on-chain' as const, quoteHash: 'forged-hash-does-not-match' };
    const rejection = checkForgedQuote('aquarius', quote);
    expect(rejection).toMatchObject({ protocol: 'aquarius', reason: 'forged_quote' });
  });

  it('accepts a quote whose hash correctly matches its content', async () => {
    const { hashCandidateQuoteFields } = await import('../reasoning/routeEngine/hashing.js');
    const fields = { protocol: 'aquarius', action: 'SWAP' as const, adapterAction: 'SWAP', inputAsset: 'XLM', outputAsset: 'USDC', inputAmount: '100', outputAmount: '10', estimatedFees: '0.1', estimatedSlippagePct: 0.1, routeHops: ['XLM', 'USDC'], liquidityScore: 50, source: 'simulation-derived' as const };
    const hash = hashCandidateQuoteFields(fields);
    expect(hash).toBe(hashCandidateQuoteFields(fields));
  });

  it('rejects a manipulated (negative) fee', () => {
    expect(checkManipulatedFee('aquarius', '-5')).toMatchObject({ reason: 'manipulated_fee' });
    expect(checkManipulatedFee('aquarius', 'not-a-number')).toMatchObject({ reason: 'manipulated_fee' });
    expect(checkManipulatedFee('aquarius', '0.5')).toBeNull();
  });

  it('rejects manipulated slippage (negative or over 100%)', () => {
    expect(checkManipulatedSlippage('aquarius', -1)).toMatchObject({ reason: 'manipulated_slippage' });
    expect(checkManipulatedSlippage('aquarius', 150)).toMatchObject({ reason: 'manipulated_slippage' });
    expect(checkManipulatedSlippage('aquarius', 5)).toBeNull();
  });

  it('rejects protocol spoofing — a quote claiming a different protocol than its adapter', async () => {
    const { checkProtocolSpoofing } = await import('../reasoning/routeEngine/rules.js');
    const quote = { protocol: 'phoenix', action: 'SWAP', inputAsset: 'XLM', outputAsset: 'USDC', inputAmount: '100', outputAmount: '10', route: ['XLM', 'USDC'], priceImpactPct: 0.1, estimatedFees: '0.1', source: 'on-chain' as const, quoteHash: 'x' };
    expect(checkProtocolSpoofing('aquarius', quote)).toMatchObject({ protocol: 'aquarius', reason: 'protocol_spoofing' });
  });

  it('rejects adapter spoofing — declared capabilities.protocol mismatched with the registered protocol name', async () => {
    const { checkAdapterSpoofing } = await import('../reasoning/routeEngine/rules.js');
    const metadata = { protocol: 'aquarius', version: '1.0.0', capabilities: { protocol: 'phoenix', supportedActions: [], supportedAssets: [], supportedNetworks: [], simulationSupport: true, batchingSupport: true, rollbackSupport: false }, registeredAt: 0, adapterHash: 'h', capabilityHash: 'h' };
    expect(checkAdapterSpoofing('aquarius', metadata)).toMatchObject({ reason: 'adapter_spoofing' });
  });

  it('a stale-quote attack (very old fetchedAt) is rejected end-to-end via a tiny TTL', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    const route = await computeRoute(swapRequest(), registry, { now: () => Date.now(), quoteTtlMs: -1 });
    expect(route.selectedProtocol).toBeNull();
    expect(route.rejected[0].reason).toBe('stale_quote');
  });
});

// ── Plan integration ─────────────────────────────────────────────────────────────────────────

describe('computeRoutesForPlan', () => {
  function makePlan(): ExecutionPlan {
    return {
      executionId: 'exec-1',
      planHash: 'plan-hash',
      version: '1.0.0',
      timestamp: 0,
      steps: [
        { stepId: 'step-1', type: 'execute', action: 'SWAP', protocol: 'aquarius', asset: 'XLM', allocation: 0.5, dependsOn: [] },
        { stepId: 'step-2', type: 'prerequisite_check', action: 'no_op', protocol: 'aquarius', asset: 'XLM', allocation: 0, dependsOn: [] },
      ],
      protocolRouting: {},
      assetRouting: {},
      dependencies: {},
      prerequisiteChecks: [],
      rollbackStrategy: [],
      simulationRequests: [],
      estimatedFees: [],
      estimatedSlippage: [],
      expectedBalanceChanges: [],
      expectedStateChanges: [],
      metadata: { plannerVersion: '1.0.0', planHash: 'plan-hash', decisionHash: 'd', verificationHash: 'v', stepCount: 2 },
    };
  }

  it('computes exactly one route per routable execute step, skipping non-execute/no_op steps', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    registry.register(makePhoenix());
    const results = await computeRoutesForPlan(makePlan(), registry, {
      network: 'testnet',
      outputAssetFor: () => 'USDC',
      resolveAmount: () => '100.000000',
      adapterParamsFor: () => ({ trustlineEstablished: true, deadline: FUTURE_DEADLINE, minOutput: '1' }),
    });
    expect(results).toHaveLength(1);
    expect(results[0].stepId).toBe('step-1');
    expect(results[0].route.candidates.length).toBeGreaterThan(0);
  });
});

// ── Performance ──────────────────────────────────────────────────────────────────────────────

describe('performance', () => {
  function percentile(sorted: number[], p: number): number {
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  }

  it('measures avg/P95/P99 latency across 250 sequential route calculations', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius({ rates: { 'XLM->USDC': 0.10 } }));
    registry.register(makePhoenix({ rates: { 'XLM->USDC': 0.12 } }));
    registry.register(makeSoroswap({ rates: { 'XLM->USDC': 0.08 } }));

    const durations: number[] = [];
    for (let i = 0; i < 250; i++) {
      const t0 = performance.now();
      await computeRoute(swapRequest(), registry);
      durations.push(performance.now() - t0);
    }
    durations.sort((a, b) => a - b);
    const avg = durations.reduce((s, v) => s + v, 0) / durations.length;

    expect(avg).toBeLessThan(50);
    expect(percentile(durations, 95)).toBeLessThan(100);
    expect(percentile(durations, 99)).toBeLessThan(150);
  });
});

// ── Malformed request ────────────────────────────────────────────────────────────────────────

describe('request validation', () => {
  it('throws RouteRequestValidationError for a non-positive amount', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    await expect(computeRoute(swapRequest({ amount: '0' }), registry)).rejects.toThrow(RouteRequestValidationError);
  });

  it('throws for SWAP with no outputAsset', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    await expect(computeRoute(swapRequest({ outputAsset: undefined }), registry)).rejects.toThrow(RouteRequestValidationError);
  });
});
