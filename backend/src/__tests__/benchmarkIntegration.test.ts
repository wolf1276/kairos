// Benchmark Integration (Phase 4) — proves Benchmark Core is actually wired into the live
// Pipeline Runner / Autonomous Runtime flow end to end, not just unit-tested in isolation.
// Mocks every frozen engine at the module boundary (same technique as pipelineComposition.test.ts)
// so this drives the REAL createPipelineStages -> createPipelineRunner -> createRuntime wiring,
// with a real BenchmarkSession backed by an InMemoryBenchmarkStore, and asserts on what actually
// landed in the store — not on mock call counts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFeatureSet = {
  pair: 'XLM/USDC',
  price: 0.12,
  trend: { ema20: 0.121, ema50: 0.118, sma20: 0.1195, trendStrength: 40, direction: 'up' },
  momentum: { rsi: 55, macdHistogram: 0.0003, roc: 2.1 },
  volatility: { atr: 0.002, volatilityPct: 1.8, band: 'normal' },
  volume: { window24h: 500000, changePct: 5 },
  liquidity: { recentVolume: 100000 },
  wallet: { publicKey: 'GABC', smartWalletAddress: null, delegationActive: false, mode: 'paper', capital: '1000' },
  portfolio: { xlmPct: 50, usdcPct: 50, idleUsd: 50, totalValue: 1000, targetXlmPct: 50, targetUsdcPct: 50, driftPct: 0 },
  protocolExposure: [],
  risk: { realizedPnl: 0, unrealizedPnl: 0, drawdownPct: 0, volatilityPct: 1.8 },
  computedAt: 1_700_000_000_000,
};

vi.mock('../agentContext/contextBuilder.js', () => ({
  buildAgentContext: vi.fn(async (agentId: string) => ({
    agentId, pair: 'XLM/USDC', features: mockFeatureSet, meta: { contextHash: 'ctx-hash' },
  })),
}));

vi.mock('../memoryLayer/index.js', () => ({
  assembleMemoryPackage: vi.fn(async (agentId: string) => ({ agentId, meta: { packageHash: 'mem-hash' } })),
  getEpisodicMemoryProvider: vi.fn(() => ({ id: 'episodic-provider' })),
  getSemanticMemoryProvider: vi.fn(() => ({ id: 'semantic-provider' })),
  getWorkingMemoryProvider: vi.fn(() => ({ id: 'working-provider' })),
}));

vi.mock('../reasoning/index.js', () => ({
  buildReasoningContext: vi.fn((agentContext: unknown, memoryPackage: unknown, userPolicy: unknown) => ({
    agentContext, memoryPackage, userPolicy, meta: { reasoningContextHash: 'rc-hash', timestamp: 1_700_000_000_000 },
  })),
  buildPrompt: vi.fn((reasoningContext: unknown) => ({
    promptHash: 'prompt-hash',
    templateVersion: 'v2',
    sections: {
      system: 'system', agentIdentity: 'a', marketContext: 'm', managedCapital: 'c',
      historicalExperience: 'h', detectedPatterns: 'p', evidence: 'base-evidence',
      riskConstraints: 'r', allowedProtocols: 'ap', objectives: 'o', outputSchema: 'os',
    },
    reasoningContext,
  })),
}));

// Toggled per-test so failure paths can be exercised without a second module registry.
let decisionShouldFail = false;
vi.mock('../reasoning/decisionIntelligence/index.js', () => ({
  generateDecisionIntelligence: vi.fn(async () => {
    if (decisionShouldFail) throw new Error('provider unavailable');
    return { decision: { id: 'decision-1' }, validation: { valid: true } };
  }),
}));

vi.mock('../reasoning/verification/index.js', () => ({
  verifyDecision: vi.fn(() => ({ status: 'verified', decision: { id: 'decision-1' } })),
}));

vi.mock('../reasoning/executionPlanner/index.js', () => ({
  buildExecutionPlan: vi.fn(() => ({ steps: [{ stepId: 'step-1' }] })),
}));

vi.mock('../reasoning/routeEngine/index.js', () => ({
  routeRequestsFromPlan: vi.fn(() => []),
  computeRoutesForPlan: vi.fn(async () => [{ stepId: 'step-1', route: { routeId: 'route-1' } }]),
}));

vi.mock('../reasoning/routeExecutionEngine/index.js', () => ({
  executeRoute: vi.fn(async () => ({ executionId: 'exec-1', status: 'success' })),
}));

vi.mock('../reasoning/outcomeRecorder/index.js', () => ({
  recordOutcome: vi.fn(() => ({ outcomeId: 'outcome-1' })),
}));

vi.mock('../reasoning/memoryWriter/index.js', () => ({
  writeMemory: vi.fn(async () => ({ writeId: 'write-1' })),
}));

vi.mock('../reasoning/learningEngine/index.js', () => ({
  computeLearningSnapshot: vi.fn(() => ({ snapshotId: 'snapshot-1' })),
}));

vi.mock('../reasoning/providers/index.js', () => ({
  getProviderConfigFromEnv: vi.fn(() => ({ provider: 'openai', model: 'gpt-4o-mini' })),
}));

const { createPipelineRunner, createRuntime } = await import('../runtime/pipelineComposition/index.js');
const { BenchmarkSession, InMemoryBenchmarkStore } = await import('../benchmarkCore/index.js');
const { buildReportBundle } = await import('../benchmarkReports/index.js');
const { compareBenchmarkSessions } = await import('../benchmarkComparison/index.js');

function baseConfig(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    agentId: 'agent-1',
    userPolicy: {
      userId: 'user-1', riskTolerance: 'medium', maxAllocationPct: 20,
      allowedProtocols: ['soroswap'], allowedAssets: ['XLM', 'USDC'],
      minConfidence: 0.5, objectives: ['grow'],
    },
    protocolRegistry: { id: 'registry-1' },
    network: 'testnet',
    telemetryProvider: vi.fn(async () => ({
      transactionHash: 'tx-hash', transactionXDRHash: 'xdr-hash',
      amountRequested: '100', amountExecuted: '100', fees: '0.01',
      slippage: 0, priceImpact: 0, balancesBefore: [], balancesAfter: [],
      verificationHash: 'v-hash', contextHash: 'c-hash', memoryHash: 'm-hash',
    })),
    intervalMs: 20,
    runtimeLogger: { info: () => {}, warn: () => {}, error: () => {} },
    executionTarget: { kind: 'replay', execute: vi.fn(async () => ({ executionId: 'exec-1', status: 'success' })) },
    ...overrides,
  } as never;
}

describe('Benchmark Integration (Phase 4) — pipeline records executions', () => {
  beforeEach(() => {
    decisionShouldFail = false;
    vi.clearAllMocks();
  });

  it('records one execution per pipeline run, growing the store', async () => {
    const store = new InMemoryBenchmarkStore();
    const session = new BenchmarkSession('session-a', store);
    const runner = createPipelineRunner(baseConfig({ benchmark: { session, provider: 'openai', model: 'gpt-4o-mini' } }));

    expect(store.listAll()).toHaveLength(0);
    await runner.run();
    expect(store.listAll()).toHaveLength(1);
    await runner.run();
    await runner.run();
    expect(store.listAll()).toHaveLength(3);
  });

  it('records no duplicate executionIds across many runs', async () => {
    const store = new InMemoryBenchmarkStore();
    const session = new BenchmarkSession('session-b', store);
    const runner = createPipelineRunner(baseConfig({ benchmark: { session, provider: 'openai', model: 'gpt-4o-mini' } }));

    for (let i = 0; i < 10; i++) await runner.run();
    const records = store.listAll();
    expect(records).toHaveLength(10);
    expect(new Set(records.map((r) => r.executionId)).size).toBe(10);
  });

  it('records failed executions with failureStage and error, distinct from successes', async () => {
    const store = new InMemoryBenchmarkStore();
    const session = new BenchmarkSession('session-c', store);
    const runner = createPipelineRunner(baseConfig({ benchmark: { session, provider: 'openai', model: 'gpt-4o-mini' } }));

    await runner.run(); // success
    decisionShouldFail = true;
    await runner.run(); // failure
    decisionShouldFail = false;
    await runner.run(); // success

    const records = store.listBySession('session-c');
    expect(records).toHaveLength(3);
    const successCount = records.filter((r) => r.success).length;
    const failureCount = records.filter((r) => !r.success).length;
    expect(successCount).toBe(2);
    expect(failureCount).toBe(1);
    const failed = records.find((r) => !r.success)!;
    expect(failed.failureStage).toBe('decision');
    expect(failed.error).toContain('provider unavailable');
  });

  it('reports generate correctly from recorded executions', async () => {
    const store = new InMemoryBenchmarkStore();
    const session = new BenchmarkSession('session-d', store);
    const runner = createPipelineRunner(baseConfig({ benchmark: { session, provider: 'openai', model: 'gpt-4o-mini' } }));

    await runner.run();
    await runner.run();
    decisionShouldFail = true;
    await runner.run();
    decisionShouldFail = false;

    const bundle = buildReportBundle('session-d', store.listBySession('session-d'));
    expect(bundle).not.toBeNull();
    expect(bundle!.trading).toBeDefined();
    expect(bundle!.runtime).toBeDefined();
    expect(bundle!.reliability.totalRuns).toBe(3);
    expect(bundle!.reliability.totalEvents).toBe(1);
  });

  it('comparisons work across two sessions', async () => {
    const store = new InMemoryBenchmarkStore();
    const sessionA = new BenchmarkSession('session-e1', store);
    const sessionB = new BenchmarkSession('session-e2', store);
    const runnerA = createPipelineRunner(baseConfig({ benchmark: { session: sessionA, provider: 'openai', model: 'gpt-4o-mini' } }));
    const runnerB = createPipelineRunner(baseConfig({ benchmark: { session: sessionB, provider: 'openai', model: 'gpt-4o-mini' } }));

    await runnerA.run();
    await runnerA.run();
    await runnerB.run();

    const bundleA = buildReportBundle('session-e1', store.listBySession('session-e1'))!;
    const bundleB = buildReportBundle('session-e2', store.listBySession('session-e2'))!;
    const comparison = compareBenchmarkSessions({ baseline: bundleA, current: bundleB, generatedAt: Date.now() });
    expect(comparison.baselineSessionId).toBe('session-e1');
    expect(comparison.currentSessionId).toBe('session-e2');
  });

  it('autonomous runtime records benchmarks automatically across ticks, with no duplicates and failures captured', async () => {
    const store = new InMemoryBenchmarkStore();
    const session = new BenchmarkSession('session-f', store);
    const runtime = createRuntime(baseConfig({ benchmark: { session, provider: 'openai', model: 'gpt-4o-mini' } }));

    await runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 90)); // several 20ms ticks
    decisionShouldFail = true;
    await new Promise((resolve) => setTimeout(resolve, 60));
    decisionShouldFail = false;
    await new Promise((resolve) => setTimeout(resolve, 60));
    await runtime.stop();

    const records = store.listBySession('session-f');
    expect(records.length).toBeGreaterThan (2);
    expect(new Set(records.map((r) => r.executionId)).size).toBe(records.length); // no duplicates
    expect(records.some((r) => !r.success)).toBe(true); // failed execution recorded
    expect(records.some((r) => r.success)).toBe(true); // successful execution recorded
  });
});
