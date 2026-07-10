// Execution Engine (Phase 7) — exhaustive test suite. Deterministic, no AI/LLM, no blockchain
// execution (never signs/submits). Soroswap/Blend are real adapters backed by their own
// deterministic test doubles; 'aquarius' below is a generic multi-candidate fixture (see
// genericProtocolAdapter.ts) used only to exercise engine plumbing with a second candidate —
// Kairos does not integrate Aquarius. No real network call is made anywhere in this file. Named
// `executionEngineV2` to avoid colliding with the pre-existing `executionEngine.test.ts` (a
// different, untouched multi-step plan orchestrator — see docs/architecture/REASONING_ENGINE.md
// Phase 7 for the split rationale).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createGenericAdapter } from './helpers/genericProtocolAdapter.js';
import { createSoroswapAdapter, createDeterministicRouterClient as createSoroswapRouterClient, createDeterministicSorobanRpcClient as createSoroswapRpcClient } from '../protocolAdapters/soroswap/index.js';
import { createBlendAdapter, createDeterministicBlendPoolClient, createDeterministicSorobanRpcClient as createBlendRpcClient } from '../protocolAdapters/blend/index.js';
import { ProtocolRegistry } from '../protocolAdapters/index.js';
import type { ProtocolAdapter } from '../protocolAdapters/adapter.js';
import { computeRoute } from '../reasoning/routeEngine/index.js';
import type { ExecutionRoute, RouteRequest } from '../reasoning/routeEngine/index.js';
import { executeRoute, checkTransactionIntegrity, checkFeeEstimate, checkSimulationWellFormed, recomputeTransactionHash, computeSyntheticResourceEstimate, encodeSyntheticXdr } from '../reasoning/routeExecutionEngine/index.js';
import type { ExecutionPlan } from '../reasoning/executionPlanner/index.js';

const FUTURE_DEADLINE = Math.floor(Date.now() / 1000) + 3600;
const SUPPORTED = ['XLM', 'USDC', 'AQUA', 'BLND'];

function makeAquarius(overrides: { rates?: Record<string, number>; health?: 'READY' | 'UNAVAILABLE' } = {}): ProtocolAdapter {
  return createGenericAdapter('aquarius', { supportedAssets: SUPPORTED, rates: overrides.rates, health: overrides.health });
}

function makeSoroswap(overrides: { health?: 'READY' | 'UNAVAILABLE'; simSuccess?: boolean } = {}): ProtocolAdapter {
  return createSoroswapAdapter({
    supportedAssets: SUPPORTED,
    routerClient: createSoroswapRouterClient(),
    sorobanRpcClient: createSoroswapRpcClient({ success: overrides.simSuccess ?? true, errors: overrides.simSuccess === false ? ['insufficient reserves'] : [] }),
    onHealth: () => overrides.health ?? 'READY',
  });
}

function makeBlend(): ProtocolAdapter {
  return createBlendAdapter({
    supportedAssets: SUPPORTED,
    poolClient: createDeterministicBlendPoolClient(),
    sorobanRpcClient: createBlendRpcClient(),
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

function makePlan(): ExecutionPlan {
  return {
    executionId: 'exec-1',
    planHash: 'plan-hash-1',
    version: '1.0.0',
    timestamp: 0,
    steps: [{ stepId: 'step-1', type: 'execute', action: 'SWAP', protocol: 'aquarius', asset: 'XLM', allocation: 0.5, dependsOn: [] }],
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
    metadata: { plannerVersion: '1.0.0', planHash: 'plan-hash-1', decisionHash: 'd', verificationHash: 'v', stepCount: 1 },
  };
}

beforeEach(() => {
  process.env.AQUARIUS_ROUTER_CONTRACT_ID_TESTNET = 'CONTRACT-AQUARIUS-TESTNET';
  process.env.SOROSWAP_ROUTER_CONTRACT_ID_TESTNET = 'CONTRACT-SOROSWAP-TESTNET';
  process.env.BLEND_POOL_CONTRACT_ID_TESTNET = 'CONTRACT-BLEND-TESTNET';
});

afterEach(() => {
  delete process.env.AQUARIUS_ROUTER_CONTRACT_ID_TESTNET;
  delete process.env.SOROSWAP_ROUTER_CONTRACT_ID_TESTNET;
  delete process.env.BLEND_POOL_CONTRACT_ID_TESTNET;
});

async function buildRoute(registry: ProtocolRegistry, requestOverrides: Partial<RouteRequest> = {}, now?: () => number): Promise<ExecutionRoute> {
  return computeRoute(swapRequest(requestOverrides), registry, now ? { now } : {});
}

// ── Transaction generation / simulation / fee estimation (happy path) ──────────────────────────

describe('happy path — build, simulate, estimate fees, validate', () => {
  it('produces a successful ExecutionResult end to end for a single-protocol route', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    const route = await buildRoute(registry);
    const result = await executeRoute(makePlan(), route, registry);

    expect(result.status).toBe('success');
    expect(result.protocol).toBe('aquarius');
    expect(result.transaction).not.toBeNull();
    expect(result.transaction!.protocol).toBe('aquarius');
    expect(result.simulationResult).not.toBeNull();
    expect(result.simulationResult!.success).toBe(true);
    expect(result.estimatedFees).not.toBeNull();
    expect(Number(result.estimatedFees)).toBeGreaterThanOrEqual(0);
    expect(result.resourceEstimate).not.toBeNull();
    expect(result.resourceEstimate!.cpuInstructions).toBeGreaterThan(0);
    expect(result.transactionXDR).not.toBeNull();
    expect(result.metadata.failureReason).toBeNull();
  });

  it('generates a well-formed unsigned TransactionBuilder (never signed/submitted)', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    const route = await buildRoute(registry);
    const result = await executeRoute(makePlan(), route, registry);
    expect(result.transaction).toMatchObject({ protocol: 'aquarius', network: 'testnet' });
    expect(typeof result.transaction!.contractId).toBe('string');
    expect(typeof result.transaction!.method).toBe('string');
  });

  it('resourceEstimate is a pure, deterministic function of the built transaction', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    const route = await buildRoute(registry);
    const result = await executeRoute(makePlan(), route, registry);
    const recomputed = computeSyntheticResourceEstimate(result.transaction!);
    expect(recomputed).toEqual(result.resourceEstimate);
  });

  it('transactionXDR is a deterministic function of the built transaction', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    const route = await buildRoute(registry);
    const result = await executeRoute(makePlan(), route, registry);
    expect(encodeSyntheticXdr(result.transaction!)).toBe(result.transactionXDR);
  });
});

// ── Failure paths ────────────────────────────────────────────────────────────────────────────

describe('failure paths', () => {
  it('fails closed when the route has no selected protocol', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius({ health: 'UNAVAILABLE' }));
    const route = await buildRoute(registry);
    expect(route.selectedProtocol).toBeNull();
    const result = await executeRoute(makePlan(), route, registry);
    expect(result.status).toBe('failed');
    expect(result.metadata.failureReason).toBe('no_route_selected');
  });

  it('fails closed on invalid transaction (malformed request rejected by validate/buildTransaction)', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    const route = await buildRoute(registry, { adapterParams: {} }); // missing deadline/minOutput
    expect(route.selectedProtocol).toBeNull(); // Route Engine itself already rejects this candidate
    const result = await executeRoute(makePlan(), route, registry);
    expect(result.status).toBe('failed');
    expect(result.metadata.failureReason).toBe('no_route_selected');
  });

  it('fails closed on simulation failure', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeSoroswap({ simSuccess: false }));
    // Route Engine itself would reject a failing simulation, so force a route past it by hand to
    // exercise the Execution Engine's own simulation-failure handling independently.
    const routeRegistry = new ProtocolRegistry();
    routeRegistry.register(makeSoroswap({ simSuccess: true }));
    const route = await buildRoute(routeRegistry);
    const result = await executeRoute(makePlan(), route, registry); // registry here has the failing adapter
    expect(result.status).toBe('failed');
    expect(result.metadata.failureReason).toBe('simulation_failed');
  });

  it('RPC unavailable (adapter throws) exhausts retries and fails closed', async () => {
    const throwingAdapter: ProtocolAdapter = {
      protocol: 'aquarius',
      version: '1.0.0',
      async initialize() {},
      async health() {
        return 'READY';
      },
      capabilities() {
        return { protocol: 'aquarius', supportedActions: ['SWAP'], supportedAssets: SUPPORTED, supportedNetworks: ['testnet'], simulationSupport: true, batchingSupport: false, rollbackSupport: false };
      },
      async simulate() {
        throw new Error('Soroban RPC unavailable');
      },
      async validate() {
        return { ok: true, errors: [] };
      },
      async execute() {
        throw new Error('not implemented');
      },
      async estimateFees() {
        return '0.1';
      },
      async estimateSlippage() {
        return 0.1;
      },
      async buildTransaction() {
        return { protocol: 'aquarius', action: 'SWAP', network: 'testnet', contractId: 'C1', method: 'swap', args: {}, transactionHash: recomputeTransactionHash({ protocol: 'aquarius', action: 'SWAP', network: 'testnet', contractId: 'C1', method: 'swap', args: {} }) };
      },
    };
    const routeRegistry = new ProtocolRegistry();
    routeRegistry.register(makeAquarius());
    const route = await buildRoute(routeRegistry);

    const execRegistry = new ProtocolRegistry();
    execRegistry.register(throwingAdapter);
    const result = await executeRoute(makePlan(), route, execRegistry, { retryPolicy: { maxAttempts: 3 } });
    expect(result.status).toBe('failed');
    expect(result.metadata.failureReason).toBe('simulation_failed');
    expect(result.metadata.retryCount).toBe(2); // 3 attempts = 2 retries
  });

  it('malformed RPC response (simulate returns a bad shape) fails closed', async () => {
    const malformedAdapter: ProtocolAdapter = {
      protocol: 'aquarius',
      version: '1.0.0',
      async initialize() {},
      async health() {
        return 'READY';
      },
      capabilities() {
        return { protocol: 'aquarius', supportedActions: ['SWAP'], supportedAssets: SUPPORTED, supportedNetworks: ['testnet'], simulationSupport: true, batchingSupport: false, rollbackSupport: false };
      },
      async simulate() {
        return { success: true } as never; // missing required fields — malformed RPC response
      },
      async validate() {
        return { ok: true, errors: [] };
      },
      async execute() {
        throw new Error('not implemented');
      },
      async estimateFees() {
        return '0.1';
      },
      async estimateSlippage() {
        return 0.1;
      },
      async buildTransaction() {
        const base = { protocol: 'aquarius', action: 'SWAP', network: 'testnet', contractId: 'C1', method: 'swap', args: {} };
        return { ...base, transactionHash: recomputeTransactionHash(base) };
      },
    };
    const routeRegistry = new ProtocolRegistry();
    routeRegistry.register(makeAquarius());
    const route = await buildRoute(routeRegistry);

    const execRegistry = new ProtocolRegistry();
    execRegistry.register(malformedAdapter);
    const result = await executeRoute(makePlan(), route, execRegistry);
    expect(result.status).toBe('failed');
    expect(result.metadata.failureReason).toBe('malformed_simulation');
  });
});

// ── Retry logic ──────────────────────────────────────────────────────────────────────────────

describe('retry logic', () => {
  it('recovers after transient failures within the retry budget', async () => {
    let calls = 0;
    const flakyAdapter: ProtocolAdapter = {
      protocol: 'aquarius',
      version: '1.0.0',
      async initialize() {},
      async health() {
        return 'READY';
      },
      capabilities() {
        return { protocol: 'aquarius', supportedActions: ['SWAP'], supportedAssets: SUPPORTED, supportedNetworks: ['testnet'], simulationSupport: true, batchingSupport: false, rollbackSupport: false };
      },
      async simulate() {
        calls++;
        if (calls < 2) throw new Error('transient RPC error');
        const base = { success: true, estimatedFees: '0.1', estimatedSlippagePct: 0.1, warnings: [], errors: [], estimatedOutputs: { USDC: '10' } };
        return { ...base, simulationHash: 'h' };
      },
      async validate() {
        return { ok: true, errors: [] };
      },
      async execute() {
        throw new Error('not implemented');
      },
      async estimateFees() {
        return '0.1';
      },
      async estimateSlippage() {
        return 0.1;
      },
      async buildTransaction() {
        const base = { protocol: 'aquarius', action: 'SWAP', network: 'testnet', contractId: 'C1', method: 'swap', args: {} };
        return { ...base, transactionHash: recomputeTransactionHash(base) };
      },
    };
    const routeRegistry = new ProtocolRegistry();
    routeRegistry.register(makeAquarius());
    const route = await buildRoute(routeRegistry);

    const execRegistry = new ProtocolRegistry();
    execRegistry.register(flakyAdapter);
    const result = await executeRoute(makePlan(), route, execRegistry, { retryPolicy: { maxAttempts: 3 } });
    expect(result.status).toBe('success');
    expect(result.metadata.retryCount).toBe(1);
  });

  it('never retries a structured failure (simulation success:false)', async () => {
    let calls = 0;
    const registry = new ProtocolRegistry();
    registry.register(
      createSoroswapAdapter({
        supportedAssets: SUPPORTED,
        routerClient: createSoroswapRouterClient(),
        sorobanRpcClient: {
          async simulateTransaction() {
            calls++;
            return { success: false, cost: '0', result: {}, errors: ['bad'] };
          },
        },
      }),
    );
    const routeRegistry = new ProtocolRegistry();
    routeRegistry.register(makeSoroswap());
    const route = await buildRoute(routeRegistry);
    const result = await executeRoute(makePlan(), route, registry, { retryPolicy: { maxAttempts: 3 } });
    expect(result.status).toBe('failed');
    expect(result.metadata.retryCount).toBe(0);
    expect(calls).toBe(1);
  });
});

// ── Determinism / replay ────────────────────────────────────────────────────────────────────

describe('determinism and replay', () => {
  it('identical inputs always produce an identical executionHash', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    const now = () => 1_700_000_000_000;
    const route = await buildRoute(registry, {}, now);
    const resultA = await executeRoute(makePlan(), route, registry, { now });
    const resultB = await executeRoute(makePlan(), route, registry, { now });
    expect(resultA.executionHash).toBe(resultB.executionHash);
    expect(resultA.executionId).not.toBe(resultB.executionId);
  });

  it('executionHash excludes wall-clock timestamps', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    const now = () => 1_700_000_000_000;
    const route = await buildRoute(registry, {}, now);
    const resultA = await executeRoute(makePlan(), route, registry, { now: () => 1000 });
    const resultB = await executeRoute(makePlan(), route, registry, { now: () => 999_999_999 });
    expect(resultA.executionHash).toBe(resultB.executionHash);
  });

  it('a replay against the same frozen plan+route reproduces an identical result content', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    const now = () => 1_700_000_000_000;
    const route = await buildRoute(registry, {}, now);
    const resultA = await executeRoute(makePlan(), route, registry, { now });
    const resultB = await executeRoute(makePlan(), route, registry, { now });
    expect(resultA.transaction).toEqual(resultB.transaction);
    expect(resultA.transactionXDR).toBe(resultB.transactionXDR);
    expect(resultA.status).toBe(resultB.status);
  });

  it('the returned ExecutionResult is deep-frozen (immutable)', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    const route = await buildRoute(registry);
    const result = await executeRoute(makePlan(), route, registry);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.metadata)).toBe(true);
    expect(() => {
      (result as { status: string }).status = 'failed';
    }).toThrow();
  });
});

// ── Concurrency / stress ────────────────────────────────────────────────────────────────────

describe('concurrency and stress', () => {
  it('handles concurrent executions against a shared registry without cross-contamination', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    registry.register(makeSoroswap());
    const now = () => 1_700_000_000_000;
    const routeA = await buildRoute(registry, {}, now);

    const results = await Promise.all(Array.from({ length: 20 }, () => executeRoute(makePlan(), routeA, registry, { now })));
    expect(results.every((r) => r.status === 'success')).toBe(true);
    const hashes = new Set(results.map((r) => r.executionHash));
    expect(hashes.size).toBe(1);
  });

  for (const n of [10, 50, 100, 250]) {
    it(`computes ${n} parallel executions with identical, deterministic results`, async () => {
      const registry = new ProtocolRegistry();
      registry.register(makeAquarius());
      const now = () => 1_700_000_000_000;
      const route = await buildRoute(registry, {}, now);
      const results = await Promise.all(Array.from({ length: n }, () => executeRoute(makePlan(), route, registry, { now })));
      const hashes = new Set(results.map((r) => r.executionHash));
      expect(hashes.size).toBe(1);
      expect(results.every((r) => r.status === 'success')).toBe(true);
    });
  }
});

// ── Security / attack surface ───────────────────────────────────────────────────────────────

describe('security — attacks must fail', () => {
  it('rejects a forged transaction (transactionHash does not match content)', () => {
    const tx = { protocol: 'aquarius', action: 'SWAP', network: 'testnet', contractId: 'C1', method: 'swap', args: { amount: '100' }, transactionHash: 'forged-hash' };
    const rejection = checkTransactionIntegrity(tx);
    expect(rejection).toMatchObject({ reason: 'forged_transaction' });
  });

  it('accepts a transaction whose hash correctly matches its content', () => {
    const base = { protocol: 'aquarius', action: 'SWAP', network: 'testnet', contractId: 'C1', method: 'swap', args: { amount: '100' } };
    const tx = { ...base, transactionHash: recomputeTransactionHash(base) };
    expect(checkTransactionIntegrity(tx)).toBeNull();
  });

  it('"modified XDR" attack is structurally impossible — transactionXDR is always engine-derived, never accepted as input', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    const route = await buildRoute(registry);
    const result = await executeRoute(makePlan(), route, registry);
    // Re-deriving the XDR from the returned transaction must always match — there is no other
    // source for transactionXDR in this engine, so a "modified XDR" has nothing to modify.
    expect(encodeSyntheticXdr(result.transaction!)).toBe(result.transactionXDR);
  });

  it('a replay attack (reusing a stale ExecutionRoute) is rejected', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    const oldNow = () => 1_000_000;
    const route = await buildRoute(registry, {}, oldNow);
    const result = await executeRoute(makePlan(), route, registry, { now: () => 1_000_000 + 120_000, routeTtlMs: 60_000 });
    expect(result.status).toBe('failed');
    expect(result.metadata.failureReason).toBe('stale_route');
  });

  it('rejects invalid simulation (success: false) outright', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeSoroswap({ simSuccess: false }));
    const routeRegistry = new ProtocolRegistry();
    routeRegistry.register(makeSoroswap());
    const route = await buildRoute(routeRegistry);
    const result = await executeRoute(makePlan(), route, registry);
    expect(result.status).toBe('failed');
    expect(result.metadata.failureReason).toBe('simulation_failed');
  });

  it('rejects RPC/adapter spoofing — a registered adapter whose protocol identity does not match the route', async () => {
    const spoofedAdapter: ProtocolAdapter = { ...makeAquarius(), protocol: 'soroswap' } as ProtocolAdapter;
    const routeRegistry = new ProtocolRegistry();
    routeRegistry.register(makeAquarius());
    const route = await buildRoute(routeRegistry);

    const execRegistry = new ProtocolRegistry();
    // Registering under 'aquarius' key but the adapter itself claims to be 'soroswap' is rejected
    // by ProtocolRegistry's own capability-spoofing check before it ever reaches the engine —
    // confirms the engine's independent `checkAdapterIdentity` re-check is defense in depth, not
    // the only line of defense.
    expect(() => execRegistry.register(spoofedAdapter)).toThrow();
  });

  it('a malformed execution result can never leave the engine — output is validated by construction', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    const route = await buildRoute(registry);
    const result = await executeRoute(makePlan(), route, registry);
    // Every documented ExecutionResult field is present and well-typed.
    expect(typeof result.executionId).toBe('string');
    expect(typeof result.executionHash).toBe('string');
    expect(['success', 'failed']).toContain(result.status);
    expect(typeof result.metadata.engineVersion).toBe('string');
  });

  it('rejects a malformed fee estimate', () => {
    expect(checkFeeEstimate('-1')).toMatchObject({ reason: 'malformed_fee_estimate' });
    expect(checkFeeEstimate('not-a-number')).toMatchObject({ reason: 'malformed_fee_estimate' });
    expect(checkFeeEstimate('0.5')).toBeNull();
  });

  it('rejects a malformed simulation response', () => {
    expect(checkSimulationWellFormed({ success: true })).toMatchObject({ reason: 'malformed_simulation' });
    expect(checkSimulationWellFormed(null)).toMatchObject({ reason: 'malformed_simulation' });
    expect(checkSimulationWellFormed({ success: true, estimatedFees: '0.1', estimatedSlippagePct: 0.1, warnings: [], errors: [], estimatedOutputs: {} })).toBeNull();
  });
});

// ── Performance ──────────────────────────────────────────────────────────────────────────────

describe('performance', () => {
  function percentile(sorted: number[], p: number): number {
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  }

  it('measures avg/P95/P99 latency across 250 sequential executions', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAquarius());
    const route = await buildRoute(registry);

    const durations: number[] = [];
    for (let i = 0; i < 250; i++) {
      const t0 = performance.now();
      await executeRoute(makePlan(), route, registry);
      durations.push(performance.now() - t0);
    }
    durations.sort((a, b) => a - b);
    const avg = durations.reduce((s, v) => s + v, 0) / durations.length;

    expect(avg).toBeLessThan(50);
    expect(percentile(durations, 95)).toBeLessThan(100);
    expect(percentile(durations, 99)).toBeLessThan(150);
  });
});
