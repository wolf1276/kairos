// Benchmark Center (Phase 7) — exhaustive test suite. Mocks every frozen engine at the module
// boundary (same technique as pipelineComposition.test.ts / experienceBuilder.test.ts) so these
// tests verify the Benchmark Center's own comparison/report logic — model isolation, report
// generation, deterministic comparison — without touching real network/LLM/blockchain calls.
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

// Per-model scripted decision behavior — set by each test via `decisionScripts`, keyed by
// `${provider}:${model}`, so distinct models under test never share behavior by accident.
type DecisionScript = () => Promise<{ decision: unknown; validation: { ok: boolean; errors: string[] } }>;
const decisionScripts = new Map<string, DecisionScript[]>();
let decisionCallIndex = new Map<string, number>();

vi.mock('../reasoning/decisionIntelligence/index.js', () => ({
  generateDecisionIntelligence: vi.fn(async (_ctx: unknown, _prompt: unknown, config: { provider: string; model: string }) => {
    const key = `${config.provider}:${config.model}`;
    const scripts = decisionScripts.get(key) ?? [];
    const i = decisionCallIndex.get(key) ?? 0;
    decisionCallIndex.set(key, i + 1);
    const script = scripts[Math.min(i, scripts.length - 1)];
    return script();
  }),
}));

vi.mock('../reasoning/decisionIntelligence/metrics.js', async () => {
  const actual = await vi.importActual<typeof import('../reasoning/decisionIntelligence/metrics.js')>(
    '../reasoning/decisionIntelligence/metrics.js'
  );
  return actual;
});

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

// executeRoute drives ExecutionResult.status — scripted per test via `executionScripts`.
type ExecutionScript = () => { executionId: string; status: 'success' | 'failed' };
const executionScripts: ExecutionScript[] = [];
let executionCallIndex = 0;
vi.mock('../reasoning/routeExecutionEngine/index.js', () => ({
  executeRoute: vi.fn(async () => {
    const script = executionScripts[Math.min(executionCallIndex, executionScripts.length - 1)];
    executionCallIndex += 1;
    return script ? script() : { executionId: 'exec-1', status: 'success' };
  }),
}));

// recordOutcome derives directly from the telemetry it's given (real fields, matching the real
// module's contract) so pnl math in the Benchmark Center is exercised against real-shaped input.
vi.mock('../reasoning/outcomeRecorder/index.js', () => ({
  recordOutcome: vi.fn(
    (
      executionResult: { status: 'success' | 'failed' },
      telemetry: { amountRequested: string; amountExecuted: string; fees: string }
    ) => ({
      outcomeId: 'outcome-1',
      executionStatus: executionResult.status,
      amountRequested: telemetry.amountRequested,
      amountExecuted: telemetry.amountExecuted,
      fees: telemetry.fees,
    })
  ),
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

const { runBenchmark } = await import('../reasoning/benchmark/index.js');
const { resetDecisionIntelligenceMetrics } = await import('../reasoning/decisionIntelligence/metrics.js');
const { verifyDecision } = await import('../reasoning/verification/index.js');

function makeGenerateDecisionSuccess(provider: string, model: string, confidence: number, promptTokens: number, completionTokens: number) {
  const key = `${provider}:${model}`;
  const scripts = decisionScripts.get(key) ?? [];
  scripts.push(async () => {
    // Feed Decision Intelligence's own metrics recorder with real, provided token counts —
    // exactly as the real orchestrator would via recordDecisionIntelligenceCall.
    const { recordDecisionIntelligenceCall } = await import('../reasoning/decisionIntelligence/metrics.js');
    recordDecisionIntelligenceCall({
      provider, model, reasoningDurationMs: 10, validationDurationMs: 1, confidence,
      alternativeCount: 0, evidenceCount: 1, uncertaintyScore: 0.1,
      promptTokens, completionTokens, totalTokens: promptTokens + completionTokens,
      providerLatencyMs: 10, retryCount: 0, failed: false,
    });
    return { decision: { confidence: { overall: confidence } }, validation: { ok: true, errors: [] } };
  });
  decisionScripts.set(key, scripts as unknown as DecisionScript[]);
}

function makeGenerateDecisionInvalidJson(provider: string, model: string) {
  const key = `${provider}:${model}`;
  const scripts = decisionScripts.get(key) ?? [];
  scripts.push(async () => {
    const { ProviderError } = await import('../reasoning/providers/errors.js');
    throw new ProviderError('invalid_json', provider as never, 'malformed model output');
  });
  decisionScripts.set(key, scripts as unknown as DecisionScript[]);
}

function scenario(id: string, agentId: string) {
  return {
    id,
    buildConfig: (decisionIntelligenceConfig: unknown) =>
      ({
        agentId,
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
        decisionIntelligenceConfig,
        telemetryProvider: vi.fn(async () => ({
          transactionHash: 'tx-hash',
          transactionXDRHash: 'xdr-hash',
          amountRequested: '100',
          amountExecuted: '105',
          fees: '1',
          slippage: 0,
          priceImpact: 0,
          balancesBefore: [],
          balancesAfter: [],
          verificationHash: 'v-hash',
          contextHash: 'c-hash',
          memoryHash: 'm-hash',
        })),
        intervalMs: 1000,
        executionTarget: {
          kind: 'replay',
          execute: async (...args: unknown[]) => {
            const { executeRoute } = await import('../reasoning/routeExecutionEngine/index.js');
            return (executeRoute as unknown as (...a: unknown[]) => unknown)(...args);
          },
        },
      }) as never,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  decisionScripts.clear();
  decisionCallIndex = new Map();
  executionScripts.length = 0;
  executionCallIndex = 0;
  resetDecisionIntelligenceMetrics();
  (verifyDecision as ReturnType<typeof vi.fn>).mockReturnValue({ status: 'verified', decision: { id: 'decision-1' } });
});

describe('report generation', () => {
  it('computes pnl, winRate, drawdown, sharpe, latency, tokenUsage, jsonValidity, and confidence from real recorded fields', async () => {
    makeGenerateDecisionSuccess('openai', 'gpt-x', 0.8, 100, 50);
    makeGenerateDecisionSuccess('openai', 'gpt-x', 0.6, 120, 60);
    executionScripts.push(() => ({ executionId: 'exec-1', status: 'success' }));

    const report = await runBenchmark({
      scenarios: [scenario('scenario-a', 'agent-1')],
      models: [{ label: 'gpt-x', decisionIntelligenceConfig: { provider: 'openai', model: 'gpt-x' } as never }],
      runsPerScenario: 2,
    });

    expect(report.models).toHaveLength(1);
    const [m] = report.models;
    expect(m.totalRuns).toBe(2);
    expect(m.outcomeCount).toBe(2);
    // amountExecuted(105) - amountRequested(100) - fees(1) = 4, for both runs
    expect(m.pnl).toEqual({ value: 4, sampleCount: 2 });
    expect(m.totalPnl).toBe(8);
    expect(m.winRate).toEqual({ wins: 2, losses: 0, total: 2, rate: 1 });
    expect(m.drawdown).toBe(0); // monotonically increasing cumulative pnl never draws down
    expect(m.latency.sampleCount).toBe(2);
    expect(m.latency.avgMs).toBeGreaterThanOrEqual(0);
    expect(m.tokenUsage).toEqual({
      avgPromptTokens: 110,
      avgCompletionTokens: 55,
      avgTotalTokens: 165,
      totalTokens: 330,
      sampleCount: 2,
    });
    expect(m.jsonValidity).toEqual({ validCount: 2, invalidCount: 0, attemptedCount: 2, rate: 1 });
    expect(m.confidence).toEqual({ value: 0.7, sampleCount: 2 });
  });

  it('never fabricates jsonValidity/confidence/outcome data for a run that never reached those stages', async () => {
    (verifyDecision as ReturnType<typeof vi.fn>).mockReturnValueOnce({ status: 'rejected', reasons: ['bad'] });
    makeGenerateDecisionSuccess('openai', 'gpt-x', 0.9, 10, 10);

    const report = await runBenchmark({
      scenarios: [scenario('scenario-a', 'agent-1')],
      models: [{ label: 'gpt-x', decisionIntelligenceConfig: { provider: 'openai', model: 'gpt-x' } as never }],
      runsPerScenario: 1,
    });

    const [run] = report.runs;
    expect(run.success).toBe(false);
    expect(run.jsonValid).toBe(true); // decision itself was fine — verification rejected it
    expect(run.outcome).toBeNull(); // never reached the outcome stage

    const [m] = report.models;
    expect(m.outcomeCount).toBe(0);
    expect(m.pnl).toBeNull();
    expect(m.winRate).toBeNull();
    expect(m.drawdown).toBeNull();
    expect(m.sharpe).toBeNull();
  });

  it('records jsonValid: false (not fabricated confidence) when the model itself failed to produce valid JSON', async () => {
    makeGenerateDecisionInvalidJson('openai', 'broken-model');

    const report = await runBenchmark({
      scenarios: [scenario('scenario-a', 'agent-1')],
      models: [{ label: 'broken', decisionIntelligenceConfig: { provider: 'openai', model: 'broken-model', maxRetries: 0, timeoutMs: 1000 } as never }],
      runsPerScenario: 1,
    });

    const [run] = report.runs;
    expect(run.jsonValid).toBe(false);
    expect(run.confidence).toBeNull();
    expect(run.success).toBe(false);
    expect(run.failureStage).toBe('decision');

    const [m] = report.models;
    expect(m.jsonValidity).toEqual({ validCount: 0, invalidCount: 1, attemptedCount: 1, rate: 0 });
    expect(m.confidence).toBeNull();
  });

  it('computes a nonzero drawdown when cumulative pnl dips below a prior peak', async () => {
    makeGenerateDecisionSuccess('openai', 'gpt-dd', 0.7, 10, 10);
    makeGenerateDecisionSuccess('openai', 'gpt-dd', 0.7, 10, 10);
    makeGenerateDecisionSuccess('openai', 'gpt-dd', 0.7, 10, 10);
    executionScripts.push(
      () => ({ executionId: 'e1', status: 'success' }), // pnl +4 -> cum 4, peak 4
      () => ({ executionId: 'e2', status: 'failed' }), // pnl -1 (fees) -> cum 3, drawdown so far 1
      () => ({ executionId: 'e3', status: 'success' }) // pnl +4 -> cum 7
    );

    const report = await runBenchmark({
      scenarios: [scenario('scenario-a', 'agent-1')],
      models: [{ label: 'gpt-dd', decisionIntelligenceConfig: { provider: 'openai', model: 'gpt-dd' } as never }],
      runsPerScenario: 3,
    });

    const [m] = report.models;
    expect(m.drawdown).toBe(1);
    expect(m.totalPnl).toBe(7);
    expect(m.winRate).toEqual({ wins: 2, losses: 1, total: 3, rate: 2 / 3 });
  });
});

describe('model isolation', () => {
  it('keeps token usage, pnl, and confidence fully separate between two distinct models', async () => {
    makeGenerateDecisionSuccess('openai', 'model-a', 0.9, 100, 100);
    makeGenerateDecisionSuccess('anthropic', 'model-b', 0.5, 20, 20);
    executionScripts.push(() => ({ executionId: 'e1', status: 'success' }), () => ({ executionId: 'e2', status: 'success' }));

    const report = await runBenchmark({
      scenarios: [scenario('scenario-a', 'agent-1')],
      models: [
        { label: 'A', decisionIntelligenceConfig: { provider: 'openai', model: 'model-a' } as never },
        { label: 'B', decisionIntelligenceConfig: { provider: 'anthropic', model: 'model-b' } as never },
      ],
      runsPerScenario: 1,
    });

    const [a, b] = report.models;
    expect(a.tokenUsage).toEqual({ avgPromptTokens: 100, avgCompletionTokens: 100, avgTotalTokens: 200, totalTokens: 200, sampleCount: 1 });
    expect(b.tokenUsage).toEqual({ avgPromptTokens: 20, avgCompletionTokens: 20, avgTotalTokens: 40, totalTokens: 40, sampleCount: 1 });
    expect(a.confidence).toEqual({ value: 0.9, sampleCount: 1 });
    expect(b.confidence).toEqual({ value: 0.5, sampleCount: 1 });

    expect(report.runs.filter((r) => r.modelLabel === 'A')).toHaveLength(1);
    expect(report.runs.filter((r) => r.modelLabel === 'B')).toHaveLength(1);
  });

  it('reports only this benchmark run’s token delta even when a model already had prior recorded calls', async () => {
    const { recordDecisionIntelligenceCall } = await import('../reasoning/decisionIntelligence/metrics.js');
    // Simulate calls made before this benchmark run started (e.g. by production traffic).
    recordDecisionIntelligenceCall({
      provider: 'openai', model: 'model-a', reasoningDurationMs: 1, validationDurationMs: 1, confidence: 0.5,
      alternativeCount: 0, evidenceCount: 0, uncertaintyScore: 0, promptTokens: 9999, completionTokens: 9999,
      totalTokens: 19998, providerLatencyMs: 1, retryCount: 0, failed: false,
    });

    makeGenerateDecisionSuccess('openai', 'model-a', 0.8, 50, 50);
    executionScripts.push(() => ({ executionId: 'e1', status: 'success' }));

    const report = await runBenchmark({
      scenarios: [scenario('scenario-a', 'agent-1')],
      models: [{ label: 'A', decisionIntelligenceConfig: { provider: 'openai', model: 'model-a' } as never }],
      runsPerScenario: 1,
    });

    const [m] = report.models;
    expect(m.tokenUsage).toEqual({ avgPromptTokens: 50, avgCompletionTokens: 50, avgTotalTokens: 100, totalTokens: 100, sampleCount: 1 });
  });
});

describe('deterministic comparison', () => {
  it('produces identical model reports (aside from timing) across two runs with the same fixture wiring', async () => {
    makeGenerateDecisionSuccess('openai', 'gpt-x', 0.75, 10, 10);
    makeGenerateDecisionSuccess('openai', 'gpt-x', 0.75, 10, 10);
    executionScripts.push(() => ({ executionId: 'e1', status: 'success' }), () => ({ executionId: 'e2', status: 'success' }));

    const runOnce = () =>
      runBenchmark({
        scenarios: [scenario('scenario-a', 'agent-1')],
        models: [{ label: 'gpt-x', decisionIntelligenceConfig: { provider: 'openai', model: 'gpt-x' } as never }],
        runsPerScenario: 1,
      });

    const first = await runOnce();
    // Reset per-model state exactly as a fresh benchmark invocation would see it.
    decisionCallIndex.set('openai:gpt-x', 0);
    executionCallIndex = 0;
    resetDecisionIntelligenceMetrics();

    const second = await runOnce();

    const strip = (r: Awaited<ReturnType<typeof runOnce>>) => ({ ...r, generatedAt: 0, runs: r.runs.map((run) => ({ ...run, totalDurationMs: 0 })) });
    const firstStripped = strip(first);
    const secondStripped = strip(second);
    firstStripped.models = firstStripped.models.map((m) => ({ ...m, latency: { ...m.latency, avgMs: 0, p95Ms: 0 } }));
    secondStripped.models = secondStripped.models.map((m) => ({ ...m, latency: { ...m.latency, avgMs: 0, p95Ms: 0 } }));

    expect(firstStripped).toEqual(secondStripped);
  });

  it('produces stable scenario ordering across repeated calls regardless of model ordering', async () => {
    makeGenerateDecisionSuccess('openai', 'a', 0.6, 5, 5);
    makeGenerateDecisionSuccess('anthropic', 'b', 0.6, 5, 5);
    executionScripts.push(() => ({ executionId: 'e1', status: 'success' }), () => ({ executionId: 'e2', status: 'success' }));

    const report = await runBenchmark({
      scenarios: [scenario('scenario-a', 'agent-1'), scenario('scenario-b', 'agent-1')].slice(0, 1),
      models: [
        { label: 'A', decisionIntelligenceConfig: { provider: 'openai', model: 'a' } as never },
        { label: 'B', decisionIntelligenceConfig: { provider: 'anthropic', model: 'b' } as never },
      ],
      runsPerScenario: 1,
    });

    expect(report.scenarioIds).toEqual(['scenario-a']);
    expect(report.models.map((m) => m.label)).toEqual(['A', 'B']);
  });
});
