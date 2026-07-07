// Experience Builder (Phase 6) — exhaustive test suite. Mocks every frozen engine at the module
// boundary (same technique as pipelineComposition.test.ts) so these tests verify the Experience
// Builder's own orchestration — replay execution history, guaranteed Outcome/Memory/Learning
// generation, learning statistics — without touching real network/LLM/blockchain calls.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../agentContext/contextBuilder.js', () => ({
  buildAgentContext: vi.fn(async (agentId: string) => ({ agentId, meta: { contextHash: 'ctx-hash' } })),
}));

vi.mock('../memoryLayer/index.js', () => ({
  assembleMemoryPackage: vi.fn(async (agentId: string) => ({ agentId, meta: { packageHash: 'mem-hash' } })),
  getEpisodicMemoryProvider: vi.fn(() => ({ id: 'episodic-provider' })),
  getSemanticMemoryProvider: vi.fn(() => ({ id: 'semantic-provider' })),
  getWorkingMemoryProvider: vi.fn(() => ({ id: 'working-provider' })),
}));

vi.mock('../reasoning/index.js', () => ({
  buildReasoningContext: vi.fn((agentContext: unknown, memoryPackage: unknown, userPolicy: unknown) => ({
    agentContext,
    memoryPackage,
    userPolicy,
    meta: { reasoningContextHash: 'rc-hash' },
  })),
  buildPrompt: vi.fn((reasoningContext: unknown) => ({ promptHash: 'prompt-hash', reasoningContext })),
}));

vi.mock('../reasoning/decisionIntelligence/index.js', () => ({
  generateDecisionIntelligence: vi.fn(async () => ({ decision: { id: 'decision-1' }, validation: { valid: true } })),
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

// executeRoute drives ExecutionResult.status — a "failed" trade result never throws, it just
// reports failed, so the outcome/memoryWrite/learning stages still run for it (see builder.ts).
let executeRouteResult: unknown = { executionId: 'exec-1', status: 'success' };
vi.mock('../reasoning/routeExecutionEngine/index.js', () => ({
  executeRoute: vi.fn(async () => executeRouteResult),
}));

let outcomeCounter = 0;
vi.mock('../reasoning/outcomeRecorder/index.js', () => ({
  recordOutcome: vi.fn(() => ({ outcomeId: `outcome-${++outcomeCounter}` })),
}));

let writeCounter = 0;
vi.mock('../reasoning/memoryWriter/index.js', () => ({
  writeMemory: vi.fn(async () => ({ writeId: `write-${++writeCounter}` })),
}));

let snapshotCounter = 0;
vi.mock('../reasoning/learningEngine/index.js', () => ({
  computeLearningSnapshot: vi.fn(() => ({ snapshotId: `snapshot-${++snapshotCounter}` })),
}));

vi.mock('../reasoning/providers/index.js', () => ({
  getProviderConfigFromEnv: vi.fn(() => ({ provider: 'openai', model: 'gpt-4o-mini' })),
}));

const { ExperienceBuilder, InMemoryExperienceHistoryStore } = await import('../runtime/experienceBuilder/index.js');
const { verifyDecision } = await import('../reasoning/verification/index.js');

function baseConfig(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    agentId: 'agent-1',
    userPolicy: {
      userId: 'user-1',
      riskTolerance: 'medium',
      maxAllocationPct: 20,
      allowedProtocols: ['soroswap'],
      allowedAssets: ['XLM', 'USDC'],
      minConfidence: 0.5,
      objectives: ['grow'],
    },
    protocolRegistry: { id: 'registry-1' },
    network: 'testnet',
    telemetryProvider: vi.fn(async () => ({
      transactionHash: 'tx-hash',
      transactionXDRHash: 'xdr-hash',
      amountRequested: '100',
      amountExecuted: '100',
      fees: '0.01',
      slippage: 0,
      priceImpact: 0,
      balancesBefore: [],
      balancesAfter: [],
      verificationHash: 'v-hash',
      contextHash: 'c-hash',
      memoryHash: 'm-hash',
    })),
    intervalMs: 1000,
    executionTarget: { kind: 'replay', execute: vi.fn() },
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  executeRouteResult = { executionId: 'exec-1', status: 'success' };
  outcomeCounter = 0;
  writeCounter = 0;
  snapshotCounter = 0;
  (verifyDecision as ReturnType<typeof vi.fn>).mockReturnValue({ status: 'verified', decision: { id: 'decision-1' } });
});

describe('runReplay — generates Outcome/Memory/Learning', () => {
  it('produces an ExperienceRecord carrying outcome, memoryWrite, and learning on a successful run', async () => {
    const builder = new ExperienceBuilder(baseConfig());
    const record = await builder.runReplay();

    expect(record.success).toBe(true);
    expect(record.agentId).toBe('agent-1');
    expect(record.outcome).toEqual({ outcomeId: 'outcome-1' });
    expect(record.memoryWrite).toEqual({ writeId: 'write-1' });
    expect(record.learning).toEqual({ snapshotId: 'snapshot-1' });
    expect(record.runId).toBeTruthy();
    expect(record.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('still produces outcome, memoryWrite, and learning when the execution itself reports a failed trade', async () => {
    executeRouteResult = { executionId: 'exec-1', status: 'failed', failureReason: 'simulation_failed' };
    const builder = new ExperienceBuilder(baseConfig());
    const record = await builder.runReplay();

    // ExecutionEngine reports failure via status, never by throwing — pipeline keeps going.
    expect(record.success).toBe(true);
    expect(record.outcome).toBeDefined();
    expect(record.memoryWrite).toBeDefined();
    expect(record.learning).toBeDefined();
  });

  it('records a failed ExperienceRecord with no outcome/memory/learning when the pipeline stops before execution', async () => {
    (verifyDecision as ReturnType<typeof vi.fn>).mockReturnValue({ status: 'rejected', reasons: ['bad'] });
    const builder = new ExperienceBuilder(baseConfig());
    const record = await builder.runReplay();

    expect(record.success).toBe(false);
    expect(record.failureStage).toBe('plan');
    expect(record.error).toMatch(/rejected by verification/);
    expect(record.outcome).toBeUndefined();
    expect(record.memoryWrite).toBeUndefined();
    expect(record.learning).toBeUndefined();
  });
});

describe('execution history', () => {
  it('appends every replay run and returns them in insertion order', async () => {
    const builder = new ExperienceBuilder(baseConfig());
    const r1 = await builder.runReplay();
    const r2 = await builder.runReplay();

    const history = builder.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0].runId).toBe(r1.runId);
    expect(history[1].runId).toBe(r2.runId);
  });

  it('scopes history by agentId when multiple agents share a history store', async () => {
    const store = new InMemoryExperienceHistoryStore();
    const builderA = new ExperienceBuilder(baseConfig({ agentId: 'agent-a' }), store);
    const builderB = new ExperienceBuilder(baseConfig({ agentId: 'agent-b' }), store);

    await builderA.runReplay();
    await builderB.runReplay();
    await builderB.runReplay();

    expect(builderA.getHistory()).toHaveLength(1);
    expect(builderB.getHistory()).toHaveLength(2);
    expect(store.list()).toHaveLength(3);
  });

  it('clear() empties the store', async () => {
    const store = new InMemoryExperienceHistoryStore();
    const builder = new ExperienceBuilder(baseConfig(), store);
    await builder.runReplay();
    store.clear();
    expect(builder.getHistory()).toHaveLength(0);
  });
});

describe('learning statistics', () => {
  it('tallies success/failure counts and exposes the latest learning snapshot', async () => {
    const builder = new ExperienceBuilder(baseConfig());
    await builder.runReplay();
    await builder.runReplay();
    (verifyDecision as ReturnType<typeof vi.fn>).mockReturnValueOnce({ status: 'rejected', reasons: ['bad'] });
    await builder.runReplay();

    const stats = builder.getStats();
    expect(stats.totalRuns).toBe(3);
    expect(stats.successCount).toBe(2);
    expect(stats.failureCount).toBe(1);
    expect(stats.successRate).toBeCloseTo(2 / 3);
    expect(stats.latestLearningSnapshot).toEqual({ snapshotId: 'snapshot-2' });
  });

  it('returns zeroed stats and a null snapshot when history is empty', () => {
    const builder = new ExperienceBuilder(baseConfig());
    const stats = builder.getStats();
    expect(stats.totalRuns).toBe(0);
    expect(stats.successRate).toBe(0);
    expect(stats.avgDurationMs).toBe(0);
    expect(stats.latestLearningSnapshot).toBeNull();
  });
});

describe('deterministic output', () => {
  it('produces distinct runIds but identical outcome/memory/learning shape across repeated runs with the same fixture wiring', async () => {
    const builder = new ExperienceBuilder(baseConfig());
    const r1 = await builder.runReplay();
    const r2 = await builder.runReplay();

    expect(r1.runId).not.toBe(r2.runId);
    expect(Object.keys(r1.outcome!)).toEqual(Object.keys(r2.outcome!));
    expect(Object.keys(r1.memoryWrite!)).toEqual(Object.keys(r2.memoryWrite!));
    expect(Object.keys(r1.learning!)).toEqual(Object.keys(r2.learning!));
  });
});

describe('stress: many replay executions', () => {
  it.each([10, 50, 100])('runs %i sequential replay executions, storing full history with no data loss', async (n) => {
    const builder = new ExperienceBuilder(baseConfig());
    for (let i = 0; i < n; i++) {
      await builder.runReplay();
    }
    const history = builder.getHistory();
    expect(history).toHaveLength(n);
    expect(new Set(history.map((r) => r.runId)).size).toBe(n);
    const stats = builder.getStats();
    expect(stats.totalRuns).toBe(n);
    expect(stats.successCount).toBe(n);
  });

  it('runs 50 fully parallel replay executions against independent builders without cross-contamination', async () => {
    const builders = Array.from({ length: 50 }, (_, i) => new ExperienceBuilder(baseConfig({ agentId: `agent-${i}` })));
    const records = await Promise.all(builders.map((b) => b.runReplay()));
    records.forEach((record, i) => {
      expect(record.agentId).toBe(`agent-${i}`);
      expect(record.success).toBe(true);
    });
    builders.forEach((b, i) => {
      expect(b.getHistory()).toHaveLength(1);
      expect(b.getHistory()[0].agentId).toBe(`agent-${i}`);
    });
  });
});
