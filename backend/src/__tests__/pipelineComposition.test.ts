// Pipeline Composition (Phase 13) — exhaustive test suite. Every frozen engine entry point is
// mocked at the module boundary so these tests verify wiring (correct stage order, correct
// argument threading, correct dependency injection, deterministic composition, no duplicate
// instances) without touching real network/LLM/blockchain calls.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callLog: string[] = [];

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
  buildAgentContext: vi.fn(async (agentId: string) => {
    callLog.push('buildAgentContext');
    return { agentId, pair: 'XLM/USDC', features: mockFeatureSet, meta: { contextHash: 'ctx-hash' } };
  }),
}));

vi.mock('../memoryLayer/index.js', () => ({
  assembleMemoryPackage: vi.fn(async (agentId: string) => {
    callLog.push('assembleMemoryPackage');
    return { agentId, meta: { packageHash: 'mem-hash' } };
  }),
  getEpisodicMemoryProvider: vi.fn(() => ({ id: 'episodic-provider' })),
  getSemanticMemoryProvider: vi.fn(() => ({ id: 'semantic-provider' })),
  getWorkingMemoryProvider: vi.fn(() => ({ id: 'working-provider' })),
}));

vi.mock('../reasoning/index.js', () => ({
  buildReasoningContext: vi.fn((agentContext: unknown, memoryPackage: unknown, userPolicy: unknown) => {
    callLog.push('buildReasoningContext');
    return { agentContext, memoryPackage, userPolicy, meta: { reasoningContextHash: 'rc-hash', timestamp: 1_700_000_000_000 } };
  }),
  buildPrompt: vi.fn((reasoningContext: unknown) => {
    callLog.push('buildPrompt');
    return {
      promptHash: 'prompt-hash',
      templateVersion: 'v2',
      sections: {
        system: 'system',
        agentIdentity: 'agentIdentity',
        marketContext: 'marketContext',
        managedCapital: 'managedCapital',
        historicalExperience: 'historicalExperience',
        detectedPatterns: 'detectedPatterns',
        evidence: 'base-evidence',
        riskConstraints: 'riskConstraints',
        allowedProtocols: 'allowedProtocols',
        objectives: 'objectives',
        outputSchema: 'outputSchema',
      },
      reasoningContext,
    };
  }),
}));

vi.mock('../reasoning/decisionIntelligence/index.js', () => ({
  generateDecisionIntelligence: vi.fn(async () => {
    callLog.push('generateDecisionIntelligence');
    return { decision: { id: 'decision-1' }, validation: { valid: true } };
  }),
}));

vi.mock('../reasoning/verification/index.js', () => ({
  verifyDecision: vi.fn(() => {
    callLog.push('verifyDecision');
    return { status: 'verified', decision: { id: 'decision-1' } };
  }),
}));

vi.mock('../reasoning/executionPlanner/index.js', () => ({
  buildExecutionPlan: vi.fn(() => {
    callLog.push('buildExecutionPlan');
    return { steps: [{ stepId: 'step-1' }] };
  }),
}));

vi.mock('../reasoning/routeEngine/index.js', () => ({
  routeRequestsFromPlan: vi.fn(() => []),
  computeRoutesForPlan: vi.fn(async () => {
    callLog.push('computeRoutesForPlan');
    return [{ stepId: 'step-1', route: { routeId: 'route-1' } }];
  }),
}));

vi.mock('../reasoning/routeExecutionEngine/index.js', () => ({
  executeRoute: vi.fn(async () => {
    callLog.push('executeRoute');
    return { executionId: 'exec-1', status: 'success' };
  }),
}));

vi.mock('../reasoning/outcomeRecorder/index.js', () => ({
  recordOutcome: vi.fn(() => {
    callLog.push('recordOutcome');
    return { outcomeId: 'outcome-1' };
  }),
}));

vi.mock('../reasoning/memoryWriter/index.js', () => ({
  writeMemory: vi.fn(async () => {
    callLog.push('writeMemory');
    return { writeId: 'write-1' };
  }),
}));

vi.mock('../reasoning/learningEngine/index.js', () => ({
  computeLearningSnapshot: vi.fn(() => {
    callLog.push('computeLearningSnapshot');
    return { snapshotId: 'snapshot-1' };
  }),
}));

vi.mock('../reasoning/providers/index.js', () => ({
  getProviderConfigFromEnv: vi.fn(() => ({ provider: 'openai', model: 'gpt-4o-mini' })),
}));

const { createPipelineStages, createPipelineRunner, createRuntime, createKairos } = await import(
  '../runtime/pipelineComposition/index.js'
);
const { PIPELINE_STAGE_NAMES } = await import('../runtime/pipelineRunner/index.js');
const { buildAgentContext } = await import('../agentContext/contextBuilder.js');
const { assembleMemoryPackage } = await import('../memoryLayer/index.js');
const { generateDecisionIntelligence } = await import('../reasoning/decisionIntelligence/index.js');
const { verifyDecision } = await import('../reasoning/verification/index.js');
const { buildExecutionPlan } = await import('../reasoning/executionPlanner/index.js');
const { computeRoutesForPlan } = await import('../reasoning/routeEngine/index.js');
const { executeRoute } = await import('../reasoning/routeExecutionEngine/index.js');
const { recordOutcome } = await import('../reasoning/outcomeRecorder/index.js');
const { writeMemory } = await import('../reasoning/memoryWriter/index.js');
const { computeLearningSnapshot } = await import('../reasoning/learningEngine/index.js');

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
    runtimeLogger: { info: () => {}, warn: () => {}, error: () => {} },
    executionTarget: {
      kind: 'replay',
      execute: (...args: unknown[]) => (executeRoute as unknown as (...a: unknown[]) => unknown)(...args),
    },
    ...overrides,
  } as never;
}

beforeEach(() => {
  callLog.length = 0;
  vi.clearAllMocks();
});

describe('createPipelineStages — dependency wiring', () => {
  it('calls every frozen engine exactly once per stage invocation (no duplicate instances)', async () => {
    const stages = createPipelineStages(baseConfig());
    let acc: Record<string, unknown> = {};
    for (const name of PIPELINE_STAGE_NAMES) {
      acc = { ...acc, [name]: await stages[name](acc) };
    }
    expect(buildAgentContext).toHaveBeenCalledTimes(1);
    expect(assembleMemoryPackage).toHaveBeenCalledTimes(2); // memory stage + learning stage re-fetch
    expect(generateDecisionIntelligence).toHaveBeenCalledTimes(1);
    expect(verifyDecision).toHaveBeenCalledTimes(1);
    expect(buildExecutionPlan).toHaveBeenCalledTimes(1);
    expect(computeRoutesForPlan).toHaveBeenCalledTimes(1);
    expect(executeRoute).toHaveBeenCalledTimes(1);
    expect(recordOutcome).toHaveBeenCalledTimes(1);
    expect(writeMemory).toHaveBeenCalledTimes(1);
    expect(computeLearningSnapshot).toHaveBeenCalledTimes(1);
  });

  it('invokes stages in the exact documented order', async () => {
    const stages = createPipelineStages(baseConfig());
    let acc: Record<string, unknown> = {};
    for (const name of PIPELINE_STAGE_NAMES) {
      acc = { ...acc, [name]: await stages[name](acc) };
    }
    expect(callLog).toEqual([
      'buildAgentContext',
      'assembleMemoryPackage',
      'buildReasoningContext',
      'buildPrompt',
      'generateDecisionIntelligence',
      'verifyDecision',
      'buildExecutionPlan',
      'computeRoutesForPlan',
      'executeRoute',
      'recordOutcome',
      'writeMemory',
      'assembleMemoryPackage',
      'computeLearningSnapshot',
    ]);
  });

  it('threads each stage output into the next via the accumulator', async () => {
    const stages = createPipelineStages(baseConfig());
    let acc: Record<string, unknown> = {};
    for (const name of PIPELINE_STAGE_NAMES) {
      acc = { ...acc, [name]: await stages[name](acc) };
    }
    expect(acc.decision).toEqual({ decision: { id: 'decision-1' }, validation: { valid: true } });
    expect(acc.verification).toEqual({ status: 'verified', decision: { id: 'decision-1' } });
    expect(acc.plan).toEqual({ steps: [{ stepId: 'step-1' }] });
    expect(acc.route).toEqual({ stepId: 'step-1', route: { routeId: 'route-1' } });
  });

  it('Phase 14: reasoning stage threads StrategySignal[] and StrategyConsensus, and Decision Intelligence receives them via the prompt evidence section', async () => {
    const stages = createPipelineStages(baseConfig());
    const context = await stages.context({});
    const memory = await stages.memory({});
    const reasoning = await stages.reasoning({ context, memory }) as {
      strategySignals: unknown[];
      strategyConsensus: { totalStrategies: number; majoritySignal: string | null };
      prompt: { sections: { evidence: string } };
    };

    expect(reasoning.strategySignals.length).toBe(12); // every built-in strategy
    expect(reasoning.strategyConsensus.totalStrategies).toBe(12);
    expect(reasoning.prompt.sections.evidence).toContain('base-evidence'); // original evidence preserved
    expect(reasoning.prompt.sections.evidence).toContain('Strategy Signals');
    expect(reasoning.prompt.sections.evidence).toContain('Consensus:');

    await stages.decision({ context, memory, reasoning });
    expect(generateDecisionIntelligence).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sections: expect.objectContaining({ evidence: expect.stringContaining('Strategy Signals') }) }),
      expect.anything(),
    );
  });

  it('Phase 14: is deterministic — identical StrategyInput produces identical strategySignals/consensus across repeated calls', async () => {
    const stages = createPipelineStages(baseConfig());
    const context = await stages.context({});
    const memory = await stages.memory({});
    const first = await stages.reasoning({ context, memory }) as { strategySignals: unknown[]; strategyConsensus: unknown };
    const second = await stages.reasoning({ context, memory }) as { strategySignals: unknown[]; strategyConsensus: unknown };
    expect(JSON.stringify(first.strategySignals)).toBe(JSON.stringify(second.strategySignals));
    expect(first.strategyConsensus).toEqual(second.strategyConsensus);
  });

  it('passes injected userPolicy, network, and protocolRegistry through to the right stages', async () => {
    const registry = { id: 'my-registry' };
    const stages = createPipelineStages(baseConfig({ network: 'public', protocolRegistry: registry }));
    let acc: Record<string, unknown> = {};
    for (const name of PIPELINE_STAGE_NAMES) {
      acc = { ...acc, [name]: await stages[name](acc) };
    }
    const { buildReasoningContext } = await import('../reasoning/index.js');
    expect(buildReasoningContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ userId: 'user-1' }),
    );
    expect(computeRoutesForPlan).toHaveBeenCalledWith(expect.anything(), registry, expect.objectContaining({ network: 'public' }));
    expect(executeRoute).toHaveBeenCalledWith(expect.anything(), expect.anything(), registry);
  });

  it('stops before planning when verification rejects the decision (fail closed)', async () => {
    (verifyDecision as ReturnType<typeof vi.fn>).mockReturnValueOnce({ status: 'rejected', reasons: ['bad'] });
    const stages = createPipelineStages(baseConfig());
    const context = await stages.context({});
    const memory = await stages.memory({});
    const reasoning = await stages.reasoning({ context, memory });
    const decision = await stages.decision({ context, memory, reasoning });
    const verificationResult = await stages.verification({ context, memory, reasoning, decision });
    await expect(stages.plan({ context, memory, reasoning, decision, verification: verificationResult })).rejects.toThrow(
      /rejected by verification/,
    );
    expect(buildExecutionPlan).not.toHaveBeenCalled();
  });

  it('throws when buildAgentContext resolves null, before any later stage runs', async () => {
    (buildAgentContext as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const stages = createPipelineStages(baseConfig());
    await expect(stages.context({})).rejects.toThrow(/buildAgentContext returned null/);
    expect(assembleMemoryPackage).not.toHaveBeenCalled();
  });

  it('is deterministic: identical config produces identical wiring behavior across repeated stage builds', async () => {
    const config = baseConfig();
    const stagesA = createPipelineStages(config);
    const stagesB = createPipelineStages(config);
    const accA = await stagesA.context({});
    const accB = await stagesB.context({});
    expect(accA).toEqual(accB);
  });
});

describe('createPipelineRunner / createRuntime / createKairos — single-call bootstrap', () => {
  it('createPipelineRunner returns a runner whose run() drives the full frozen chain end to end', async () => {
    const runner = createPipelineRunner(baseConfig());
    const result = await runner.run();
    expect(result.success).toBe(true);
    expect(result.learning).toEqual({ snapshotId: 'snapshot-1' });
  });

  it('createRuntime and createKairos both return a startable/stoppable AutonomousRuntime', async () => {
    const runtime = createRuntime(baseConfig());
    expect(runtime.getState()).toBe('STOPPED');
    const kairos = createKairos(baseConfig());
    expect(kairos.getState()).toBe('STOPPED');
  });

  it('the one-call bootstrap example actually works: createKairos(config).start()/.stop()', async () => {
    const kairos = createKairos(baseConfig({ intervalMs: 50 }));
    await kairos.start();
    expect(kairos.getState()).toBe('RUNNING');
    await kairos.stop();
    expect(kairos.getState()).toBe('STOPPED');
  });

  it('threads decisionIntelligenceConfig into the runtime heartbeat provider/model', async () => {
    const runtime = createRuntime(
      baseConfig({ decisionIntelligenceConfig: { provider: 'anthropic', model: 'claude-x' } }),
    );
    const heartbeat = runtime.getHeartbeat();
    expect(heartbeat.provider).toBe('anthropic');
    expect(heartbeat.model).toBe('claude-x');
  });
});

describe('configuration loading', () => {
  it('falls back to getProviderConfigFromEnv() when no decisionIntelligenceConfig override is supplied', async () => {
    createPipelineStages(baseConfig());
    const { getProviderConfigFromEnv } = await import('../reasoning/providers/index.js');
    expect(getProviderConfigFromEnv).toHaveBeenCalledTimes(1);
  });

  it('does not call getProviderConfigFromEnv() when an explicit override is supplied', async () => {
    vi.clearAllMocks();
    createPipelineStages(baseConfig({ decisionIntelligenceConfig: { provider: 'openai', model: 'x' } }));
    const { getProviderConfigFromEnv } = await import('../reasoning/providers/index.js');
    expect(getProviderConfigFromEnv).not.toHaveBeenCalled();
  });
});

describe('stress: parallel create/start/stop cycles', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each([10, 50, 100, 250])('runs %i fully parallel createKairos().start()/.stop() cycles cleanly', async (n) => {
    const runs = Array.from({ length: n }, async () => {
      const kairos = createKairos(baseConfig({ intervalMs: 1000 }));
      await kairos.start();
      const state = kairos.getState();
      await kairos.stop();
      return { state, finalState: kairos.getState() };
    });
    const results = await Promise.all(runs);
    results.forEach((r) => {
      expect(r.state).toBe('RUNNING');
      expect(r.finalState).toBe('STOPPED');
    });
  });
});
