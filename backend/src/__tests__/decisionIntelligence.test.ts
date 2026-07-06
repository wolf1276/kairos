// Reasoning Engine Phase 3 (Decision Intelligence) tests. Mocks `fetch` throughout — never calls
// a real provider. Covers deterministic prompt generation, evidence-reference integrity, policy/
// protocol awareness, alternative generation, confidence bounds, malformed-output/hallucination
// rejection, conflicting-evidence and uncertainty handling, and 10/50/100-way concurrency.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildReasoningContext } from '../reasoning/contextBuilder.js';
import { buildPrompt } from '../reasoning/promptBuilder.js';
import {
  generateDecisionIntelligence,
  validateDecisionIntelligence,
  getDecisionIntelligenceMetrics,
  resetDecisionIntelligenceMetrics,
  DECISION_PROMPT_TEMPLATE_VERSION,
} from '../reasoning/decisionIntelligence/index.js';
import type { AgentContext } from '../agentContext/index.js';
import type { MemoryPackage } from '../memoryLayer/index.js';
import type { UserPolicy } from '../reasoning/types.js';
import type { ProviderCallConfig } from '../reasoning/providers/types.js';
import type { DecisionIntelligence } from '../reasoning/decisionIntelligence/types.js';

const AGENT_ID = 'agent-1';

function makeAgentContext(overrides: Partial<AgentContext> = {}): AgentContext {
  const base: AgentContext = {
    agentId: AGENT_ID, owner: 'owner-1', role: 'trend_follower' as unknown as AgentContext['role'], pair: 'XLM/USDC',
    regime: { base: 'XLM', label: 'trending_up' as unknown as AgentContext['regime']['label'], breakout: false, volatilityBand: 'normal' },
    features: {
      pair: 'XLM/USDC', price: 0.12,
      trend: { ema20: 0.11, ema50: 0.1, sma20: 0.115, trendStrength: 25, direction: 'up' },
      momentum: { rsi: 55, macdHistogram: 0.001, roc: 0.02 },
      volatility: { atr: 0.002, volatilityPct: 1.5, band: 'normal' },
      volume: { window24h: 1000000, changePct: 5 }, liquidity: { recentVolume: 500000 },
      wallet: { publicKey: 'GABC', smartWalletAddress: null, delegationActive: true, mode: 'auto' as unknown as AgentContext['features']['wallet']['mode'], capital: '1000' },
      portfolio: { xlmPct: 50, usdcPct: 50, idleUsd: 100, totalValue: 1000, targetXlmPct: 50, targetUsdcPct: 50, driftPct: 0 },
      protocolExposure: [], risk: { realizedPnl: 10, unrealizedPnl: -2, drawdownPct: 5, volatilityPct: 1.5 }, computedAt: Date.now(),
    },
    builtAt: Date.now(),
    meta: { version: '2.1.0', timestamp: Date.now(), marketId: 'market-1', snapshotId: 'snapshot-1', contextHash: 'agent-context-hash' },
    market: {
      pair: 'XLM/USDC', price: 0.12, oracle: { timestamp: Date.now(), ageSeconds: 10 }, candles: { resolutionSeconds: 300 },
      trend: { ema20: 0.11, ema50: 0.1, sma20: 0.115, trendStrength: 25, direction: 'up' }, momentum: { rsi: 55, macdHistogram: 0.001, roc: 0.02 },
      volatility: { atr: 0.002, volatilityPct: 1.5, band: 'normal' }, volume: { window24h: 1000000, changePct: 5 }, liquidity: { recentVolume: 500000 },
      regime: { base: 'XLM', label: 'trending_up', breakout: false, volatilityBand: 'normal' }, confidence: 0.9,
    },
    capital: { totalManagedCapital: 1000, idleCapital: 100, deployableCapital: 900, allocation: { xlmPct: 50, usdcPct: 50 }, protocolExposure: [], realizedPnl: 10, unrealizedPnl: -2, pendingExecutions: [], confidence: 0.95 },
    policy: { objective: 'trend_follower' as unknown as AgentContext['policy']['objective'], riskProfile: 'moderate', allowedAssets: ['XLM', 'USDC'], allowedProtocols: ['blend'], delegationActive: true, spendingLimitPerTrade: '100', minConfidence: 0.6, positionLimit: { maxCapital: '500' }, confidence: 1 },
    system: { oracleHealthy: true, schedulerRunning: true, priceFeedRunning: true, agentRunning: true, protocolExecutionAvailable: true, executionAvailable: true, featureFlags: {}, confidence: 1 },
    historical: { lastExecution: null, lastDecision: null, recentFailureCount: 0, cooldown: { active: false, remainingSeconds: 0 }, recentExecutionSummary: { tradeCount: 0, successCount: 0, failureCount: 0 }, confidence: 1 },
    validation: { ok: true, errors: [] }, status: 'valid',
    quality: { score: 0.95, level: 'high', domainConfidence: { market: 0.9, capital: 0.95, policy: 1, system: 1, historical: 1 } },
  };
  return { ...base, ...overrides };
}

function makeMemoryPackage(overrides: Partial<MemoryPackage> = {}): MemoryPackage {
  const base: MemoryPackage = {
    meta: { version: '1.0.0', agentId: AGENT_ID, timestamp: Date.now(), packageId: 'pkg-1', packageHash: 'memory-package-hash' },
    episodic: [], semantic: [], working: [],
    validation: { ok: true, errors: [] }, status: 'valid',
  };
  return { ...base, ...overrides };
}

function makeUserPolicy(overrides: Partial<UserPolicy> = {}): UserPolicy {
  return {
    userId: 'user-1', riskTolerance: 'medium', maxAllocationPct: 25,
    allowedProtocols: ['blend'], allowedAssets: ['XLM', 'USDC'], minConfidence: 0.6,
    objectives: ['grow capital steadily'], ...overrides,
  };
}

function buildFixture(agentOverrides: Partial<AgentContext> = {}, policyOverrides: Partial<UserPolicy> = {}) {
  const context = buildReasoningContext(makeAgentContext(agentOverrides), makeMemoryPackage(), makeUserPolicy(policyOverrides));
  const prompt = buildPrompt(context, DECISION_PROMPT_TEMPLATE_VERSION);
  return { context, prompt };
}

function makeConfig(overrides: Partial<ProviderCallConfig> = {}): ProviderCallConfig {
  return {
    provider: 'openai', model: 'gpt-4o-mini', apiKey: 'test-key',
    temperature: 0.2, maxTokens: 1500, timeoutMs: 500, maxRetries: 1, structuredOutput: true, ...overrides,
  };
}

function validDecisionOutput(overrides: Record<string, unknown> = {}) {
  return {
    primaryDecision: { action: 'HOLD', protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.75 },
    alternatives: [
      { action: 'REBALANCE', protocol: 'blend', asset: 'XLM', allocation: 0.15, confidence: 0.6, tradeoffs: 'more upside, more risk' },
      { action: 'WITHDRAW', protocol: 'blend', asset: 'USDC', allocation: 0.05, confidence: 0.5, tradeoffs: 'safer but gives up yield' },
    ],
    reasoningChain: [
      { step: 'Trend is up per market indicators.', evidenceRefs: [0] },
      { step: 'No conflicting historical pattern found.', evidenceRefs: [1] },
    ],
    evidence: [
      { type: 'market_indicator', source: 'trend', detail: 'ema20 above ema50', weight: 0.6 },
      { type: 'historical_pattern', source: 'episodic memory', detail: 'similar setups held steady', weight: 0.4 },
    ],
    risks: [{ description: 'volatility could spike', probability: 0.2, severity: 'low', mitigation: 'monitor and reduce if trend breaks' }],
    assumptions: ['market stays liquid'],
    uncertainty: { missingInformation: [], conflictingEvidence: [], lowConfidenceSignals: [], score: 0.2 },
    expectedOutcome: { direction: 'up', expectedBenefit: 'modest gain if trend continues', expectedDownside: 'small loss if trend reverses' },
    confidence: { overall: 0.75, perSection: { primaryDecision: 0.75, alternatives: 0.6, evidence: 0.7, risk: 0.7, expectedOutcome: 0.65 } },
    summary: 'Hold current position; trend supportive but not strong enough to add.',
    ...overrides,
  };
}

function openAiResponse(content: unknown, overrides: Record<string, unknown> = {}) {
  return {
    ok: true, status: 200,
    json: async () => ({ id: 'req-1', choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 200, completion_tokens: 150, total_tokens: 350 }, ...overrides }),
    text: async () => '',
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  resetDecisionIntelligenceMetrics();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Deterministic prompt generation ──────────────────────────────────────────────────────────

describe('Decision Intelligence: v2 prompt', () => {
  it('is deterministic — identical context produces identical prompt + hash', () => {
    const { context } = buildFixture();
    const p1 = buildPrompt(context, 'v2');
    const p2 = buildPrompt(context, 'v2');
    expect(p1).toEqual(p2);
    expect(p1.promptHash).toBe(p2.promptHash);
    expect(p1.templateVersion).toBe('v2');
  });

  it('differs from v1 (different system/outputSchema) but shares the same underlying context sections', () => {
    const { context } = buildFixture();
    const v1 = buildPrompt(context, 'v1');
    const v2 = buildPrompt(context, 'v2');
    expect(v1.promptHash).not.toBe(v2.promptHash);
    expect(v2.sections.marketContext).toBe(v1.sections.marketContext);
    expect(v2.sections.managedCapital).toBe(v1.sections.managedCapital);
    expect(v2.sections.system).not.toBe(v1.sections.system);
    expect(v2.sections.outputSchema).toContain('HOLD');
    expect(v2.sections.outputSchema).toContain('DEPOSIT');
    expect(v2.sections.outputSchema).toContain('WITHDRAW');
    expect(v2.sections.outputSchema).toContain('SWAP');
    expect(v2.sections.outputSchema).toContain('REBALANCE');
  });
});

// ── End-to-end generation ────────────────────────────────────────────────────────────────────

describe('Decision Intelligence: generateDecisionIntelligence', () => {
  it('produces a fully valid DecisionIntelligence from a well-formed model response', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validDecisionOutput()));
    const { context, prompt } = buildFixture();

    const { decision, validation } = await generateDecisionIntelligence(context, prompt, makeConfig());

    expect(validation.ok).toBe(true);
    expect(decision.primaryDecision.action).toBe('HOLD');
    expect(decision.alternatives).toHaveLength(2);
    expect(decision.metadata.evidenceCount).toBe(2);
    expect(decision.metadata.alternativeCount).toBe(2);
    expect(decision.metadata.uncertaintyScore).toBe(0.2);
    expect(decision.metadata.promptHash).toBe(prompt.promptHash);
    expect(decision.metadata.decisionHash).toEqual(expect.any(String));
  });

  it('stamps providerVersion, promptVersion, and reasoningDurationMs correctly', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validDecisionOutput()));
    const { context, prompt } = buildFixture();
    const { decision } = await generateDecisionIntelligence(context, prompt, makeConfig({ model: 'gpt-4o-mini' }));

    expect(decision.metadata.providerVersion).toBe('openai:gpt-4o-mini');
    expect(decision.metadata.promptVersion).toBe('v2');
    expect(decision.metadata.reasoningDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('sets strict:true on the structured-output request', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validDecisionOutput()));
    const { context, prompt } = buildFixture();
    await generateDecisionIntelligence(context, prompt, makeConfig());

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.properties.primaryDecision.properties.action.enum).toEqual([
      'HOLD', 'DEPOSIT', 'WITHDRAW', 'SWAP', 'REBALANCE',
    ]);
  });

  it('records observability metrics on success', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validDecisionOutput()));
    const { context, prompt } = buildFixture();
    await generateDecisionIntelligence(context, prompt, makeConfig());

    const metrics = getDecisionIntelligenceMetrics()['openai:gpt-4o-mini'];
    expect(metrics.calls).toBe(1);
    expect(metrics.failures).toBe(0);
    expect(metrics.totalPromptTokens).toBe(200);
    expect(metrics.totalCompletionTokens).toBe(150);
  });
});

// ── Provider error classification ────────────────────────────────────────────────────────────

describe('Decision Intelligence: provider error classification', () => {
  // Regression (live smoke test finding): a real Hugging Face call with a depleted monthly
  // credit balance returned HTTP 402, which the shared classifyHttpStatus (providers/errors.ts)
  // has no case for and falls back to 'network' — a retryable kind, wrong for a billing failure
  // that will never resolve on its own. Fixed locally in requestClient.ts (not providers/) by
  // mapping 402 to 'authentication', which is already non-retryable.
  it('classifies HTTP 402 (quota/billing exhausted) as non-retryable, not network', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 402, text: async () => 'You have depleted your monthly included credits.' });
    const { context, prompt } = buildFixture();

    try {
      await generateDecisionIntelligence(context, prompt, makeConfig({ provider: 'huggingface' as any, maxRetries: 2 }));
      throw new Error('expected rejection');
    } catch (err: any) {
      expect(err.kind).toBe('authentication');
      expect(err.retryable).toBe(false);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1); // never retried
  });

  // Regression (live smoke test finding, Phase 3 production issue pass): a real Hugging Face
  // call for meta-llama/Llama-3.1-8B-Instruct returned HTTP 400 — "Model does not support
  // 'json_schema' response format. Supported formats: json_object." — because requestClient.ts
  // always requested json_schema structured output whenever config.structuredOutput was true,
  // regardless of whether the target provider/model actually supports it. Fixed by restricting
  // json_schema to providers confirmed (via live testing) to honor it (openai, nvidia); every
  // other provider, including huggingface, now requests json_object instead.
  it('requests json_object (not json_schema) for huggingface even when structuredOutput is true', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validDecisionOutput()));
    const { context, prompt } = buildFixture();
    await generateDecisionIntelligence(context, prompt, makeConfig({ provider: 'huggingface' as any, model: 'meta-llama/Llama-3.1-8B-Instruct', structuredOutput: true }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('still requests json_schema (with strict:true) for openai and nvidia', async () => {
    for (const provider of ['openai', 'nvidia'] as const) {
      fetchMock.mockResolvedValueOnce(openAiResponse(validDecisionOutput()));
      const { context, prompt } = buildFixture();
      await generateDecisionIntelligence(context, prompt, makeConfig({ provider, structuredOutput: true }));

      const body = JSON.parse(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1].body as string);
      expect(body.response_format.type).toBe('json_schema');
      expect(body.response_format.json_schema.strict).toBe(true);
    }
  });
});

// ── Policy / protocol awareness ──────────────────────────────────────────────────────────────

describe('Decision Intelligence: policy and protocol awareness', () => {
  it('rejects an unsupported protocol in the primary decision', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validDecisionOutput({ primaryDecision: { action: 'HOLD', protocol: 'soroswap-unlisted', asset: 'XLM', allocation: 0.1, confidence: 0.7 } })));
    const { context, prompt } = buildFixture();
    await expect(generateDecisionIntelligence(context, prompt, makeConfig())).rejects.toMatchObject({ kind: 'validation_failed' });
  });

  it('rejects an unsupported asset in an alternative', async () => {
    const output = validDecisionOutput();
    (output.alternatives as any[])[0].asset = 'DOGE';
    fetchMock.mockResolvedValueOnce(openAiResponse(output));
    const { context, prompt } = buildFixture();
    await expect(generateDecisionIntelligence(context, prompt, makeConfig())).rejects.toMatchObject({ kind: 'validation_failed' });
  });

  it('rejects an allocation that violates the user policy maxAllocationPct ceiling', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validDecisionOutput({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.9, confidence: 0.7 } })));
    const { context, prompt } = buildFixture({}, { maxAllocationPct: 25 });
    await expect(generateDecisionIntelligence(context, prompt, makeConfig())).rejects.toMatchObject({ kind: 'validation_failed' });
  });

  it('accepts an allocation within the policy ceiling', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validDecisionOutput({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.2, confidence: 0.7 } })));
    const { context, prompt } = buildFixture({}, { maxAllocationPct: 25 });
    const { validation } = await generateDecisionIntelligence(context, prompt, makeConfig());
    expect(validation.ok).toBe(true);
  });
});

// ── Alternative generation ───────────────────────────────────────────────────────────────────

describe('Decision Intelligence: alternative generation', () => {
  it('accepts exactly 2 alternatives', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validDecisionOutput()));
    const { context, prompt } = buildFixture();
    const { validation } = await generateDecisionIntelligence(context, prompt, makeConfig());
    expect(validation.ok).toBe(true);
  });

  it('accepts exactly 3 alternatives', async () => {
    const output = validDecisionOutput();
    (output.alternatives as any[]).push({ action: 'SWAP', protocol: 'blend', asset: 'USDC', allocation: 0.1, confidence: 0.55, tradeoffs: 'diversifies exposure' });
    fetchMock.mockResolvedValueOnce(openAiResponse(output));
    const { context, prompt } = buildFixture();
    const { validation } = await generateDecisionIntelligence(context, prompt, makeConfig());
    expect(validation.ok).toBe(true);
  });

  it('rejects fewer than 2 alternatives', async () => {
    const output = validDecisionOutput({ alternatives: [validDecisionOutput().alternatives[0]] });
    fetchMock.mockResolvedValueOnce(openAiResponse(output));
    const { context, prompt } = buildFixture();
    await expect(generateDecisionIntelligence(context, prompt, makeConfig())).rejects.toMatchObject({ kind: 'validation_failed' });
  });

  it('rejects more than 3 alternatives', async () => {
    const output = validDecisionOutput();
    const alt = (output.alternatives as any[])[0];
    output.alternatives = [alt, alt, alt, alt];
    fetchMock.mockResolvedValueOnce(openAiResponse(output));
    const { context, prompt } = buildFixture();
    await expect(generateDecisionIntelligence(context, prompt, makeConfig())).rejects.toMatchObject({ kind: 'validation_failed' });
  });
});

// ── Evidence references / hallucination rejection ───────────────────────────────────────────

describe('Decision Intelligence: evidence integrity and hallucination rejection', () => {
  it('rejects a reasoning step with no evidenceRefs (uncited conclusion)', async () => {
    const output = validDecisionOutput({ reasoningChain: [{ step: 'Trend is up.', evidenceRefs: [] }] });
    fetchMock.mockResolvedValueOnce(openAiResponse(output));
    const { context, prompt } = buildFixture();
    await expect(generateDecisionIntelligence(context, prompt, makeConfig())).rejects.toMatchObject({ kind: 'validation_failed' });
  });

  it('rejects a broken evidence reference (index out of bounds — hallucinated citation)', async () => {
    const output = validDecisionOutput({ reasoningChain: [{ step: 'Trend is up.', evidenceRefs: [99] }] });
    fetchMock.mockResolvedValueOnce(openAiResponse(output));
    const { context, prompt } = buildFixture();
    await expect(generateDecisionIntelligence(context, prompt, makeConfig())).rejects.toMatchObject({ kind: 'validation_failed' });
  });

  it('rejects duplicate evidence entries', async () => {
    const dup = { type: 'market_indicator', source: 'trend', detail: 'ema20 above ema50', weight: 0.5 };
    const output = validDecisionOutput({ evidence: [dup, { ...dup }] });
    fetchMock.mockResolvedValueOnce(openAiResponse(output));
    const { context, prompt } = buildFixture();
    await expect(generateDecisionIntelligence(context, prompt, makeConfig())).rejects.toMatchObject({ kind: 'validation_failed' });
  });

  it('rejects an invalid evidence type (not one of the five canonical types)', async () => {
    const output = validDecisionOutput();
    (output.evidence as any[])[0].type = 'vibes';
    fetchMock.mockResolvedValueOnce(openAiResponse(output));
    const { context, prompt } = buildFixture();
    await expect(generateDecisionIntelligence(context, prompt, makeConfig())).rejects.toMatchObject({ kind: 'validation_failed' });
  });

  it('rejects an empty evidence array (nothing to cite at all)', async () => {
    const output = validDecisionOutput({ evidence: [] });
    fetchMock.mockResolvedValueOnce(openAiResponse(output));
    const { context, prompt } = buildFixture();
    await expect(generateDecisionIntelligence(context, prompt, makeConfig())).rejects.toMatchObject({ kind: 'validation_failed' });
  });
});

// ── Confidence bounds ────────────────────────────────────────────────────────────────────────

describe('Decision Intelligence: confidence bounds', () => {
  it('rejects NaN overall confidence', async () => {
    const output = validDecisionOutput();
    (output.confidence as any).overall = NaN;
    fetchMock.mockResolvedValueOnce(openAiResponse(output));
    const { context, prompt } = buildFixture();
    await expect(generateDecisionIntelligence(context, prompt, makeConfig())).rejects.toMatchObject({ kind: 'validation_failed' });
  });

  it('rejects Infinity in a per-section confidence', async () => {
    const output = validDecisionOutput();
    (output.confidence as any).perSection.risk = Infinity;
    fetchMock.mockResolvedValueOnce(openAiResponse(output));
    const { context, prompt } = buildFixture();
    await expect(generateDecisionIntelligence(context, prompt, makeConfig())).rejects.toMatchObject({ kind: 'validation_failed' });
  });

  it('rejects a primary decision confidence above 1', async () => {
    const output = validDecisionOutput({ primaryDecision: { action: 'HOLD', protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 1.5 } });
    fetchMock.mockResolvedValueOnce(openAiResponse(output));
    const { context, prompt } = buildFixture();
    await expect(generateDecisionIntelligence(context, prompt, makeConfig())).rejects.toMatchObject({ kind: 'validation_failed' });
  });
});

// ── Malformed outputs ────────────────────────────────────────────────────────────────────────

describe('Decision Intelligence: malformed outputs', () => {
  // Regression (live smoke test finding): a real NVIDIA response at maxTokens=2000 was cut off
  // mid-JSON because Decision Intelligence's schema is much larger than CandidateDecision's —
  // the resulting `invalid_json` error looked identical to genuine model malformation. Fixed by
  // checking `finish_reason` in requestClient.ts and surfacing a specific, actionable message.
  it('detects a max_tokens-truncated response (finish_reason=length) with a specific, actionable error', async () => {
    const truncated = JSON.stringify(validDecisionOutput()).slice(0, -50);
    fetchMock.mockResolvedValueOnce(openAiResponse(truncated, { choices: [{ message: { content: truncated }, finish_reason: 'length' }] }));
    const { context, prompt } = buildFixture();

    try {
      await generateDecisionIntelligence(context, prompt, makeConfig({ maxRetries: 0, maxTokens: 100 }));
      throw new Error('expected rejection');
    } catch (err: any) {
      expect(err.kind).toBe('invalid_json');
      expect(err.message).toContain('truncated');
      expect(err.message).toContain('maxTokens');
    }
  });

  it('does not misreport truncation when finish_reason is stop (normal completion)', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validDecisionOutput(), { choices: [{ message: { content: JSON.stringify(validDecisionOutput()) }, finish_reason: 'stop' }] }));
    const { context, prompt } = buildFixture();
    const { validation } = await generateDecisionIntelligence(context, prompt, makeConfig());
    expect(validation.ok).toBe(true);
  });

  it('rejects markdown-fenced JSON', async () => {
    const fenced = '```json\n' + JSON.stringify(validDecisionOutput()) + '\n```';
    fetchMock.mockResolvedValueOnce(openAiResponse(fenced));
    const { context, prompt } = buildFixture();
    await expect(generateDecisionIntelligence(context, prompt, makeConfig({ maxRetries: 0 }))).rejects.toMatchObject({ kind: 'invalid_json' });
  });

  it('rejects an invalid primary action not in the canonical five', async () => {
    const output = validDecisionOutput({ primaryDecision: { action: 'BUY_THE_DIP', protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.7 } });
    fetchMock.mockResolvedValueOnce(openAiResponse(output));
    const { context, prompt } = buildFixture();
    await expect(generateDecisionIntelligence(context, prompt, makeConfig())).rejects.toMatchObject({ kind: 'validation_failed' });
  });

  it('rejects a tampered decisionHash', () => {
    const decision: DecisionIntelligence = {
      decisionId: 'd1', timestamp: Date.now(),
      primaryDecision: { action: 'HOLD', protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.7 },
      alternatives: [
        { action: 'REBALANCE', protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.6, tradeoffs: 't1' },
        { action: 'WITHDRAW', protocol: 'blend', asset: 'USDC', allocation: 0.1, confidence: 0.5, tradeoffs: 't2' },
      ],
      reasoningChain: [{ step: 's1', evidenceRefs: [0] }],
      evidence: [{ type: 'market_indicator', source: 's', detail: 'd', weight: 0.5 }],
      risks: [], assumptions: ['a1'],
      uncertainty: { missingInformation: [], conflictingEvidence: [], lowConfidenceSignals: [], score: 0.1 },
      expectedOutcome: { direction: 'up', expectedBenefit: 'b', expectedDownside: 'd' },
      confidence: { overall: 0.7, perSection: { primaryDecision: 0.7, alternatives: 0.6, evidence: 0.6, risk: 0.6, expectedOutcome: 0.6 } },
      summary: 'summary',
      metadata: { reasoningVersion: '1.0.0', decisionVersion: '1.0.0', promptVersion: 'v2', providerVersion: 'openai:gpt-4o-mini', reasoningDurationMs: 1, evidenceCount: 1, alternativeCount: 2, uncertaintyScore: 0.1, decisionHash: 'not-the-real-hash', promptHash: 'ph' },
    };
    const result = validateDecisionIntelligence(decision);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('decisionHash'))).toBe(true);
  });
});

// ── Conflicting evidence / uncertainty handling ──────────────────────────────────────────────

describe('Decision Intelligence: conflicting evidence and uncertainty', () => {
  it('accepts a well-formed decision that explicitly surfaces conflicting evidence and higher uncertainty', async () => {
    const output = validDecisionOutput({
      uncertainty: {
        missingInformation: ['no recent volume data past 24h'],
        conflictingEvidence: ['momentum negative while trend positive'],
        lowConfidenceSignals: ['thin historical sample'],
        score: 0.6,
      },
    });
    fetchMock.mockResolvedValueOnce(openAiResponse(output));
    const { context, prompt } = buildFixture();
    const { decision, validation } = await generateDecisionIntelligence(context, prompt, makeConfig());
    expect(validation.ok).toBe(true);
    expect(decision.uncertainty.conflictingEvidence).toContain('momentum negative while trend positive');
    expect(decision.metadata.uncertaintyScore).toBe(0.6);
  });

  it('rejects a missing uncertainty object', async () => {
    const output = validDecisionOutput();
    delete (output as any).uncertainty;
    fetchMock.mockResolvedValueOnce(openAiResponse(output));
    const { context, prompt } = buildFixture();
    await expect(generateDecisionIntelligence(context, prompt, makeConfig())).rejects.toMatchObject({ kind: 'validation_failed' });
  });

  it('rejects a missing expectedOutcome object', async () => {
    const output = validDecisionOutput();
    delete (output as any).expectedOutcome;
    fetchMock.mockResolvedValueOnce(openAiResponse(output));
    const { context, prompt } = buildFixture();
    await expect(generateDecisionIntelligence(context, prompt, makeConfig())).rejects.toMatchObject({ kind: 'validation_failed' });
  });

  it('rejects an empty assumptions array (hidden assumptions)', async () => {
    const output = validDecisionOutput({ assumptions: [] });
    fetchMock.mockResolvedValueOnce(openAiResponse(output));
    const { context, prompt } = buildFixture();
    await expect(generateDecisionIntelligence(context, prompt, makeConfig())).rejects.toMatchObject({ kind: 'validation_failed' });
  });
});

// ── Concurrency stress ───────────────────────────────────────────────────────────────────────

describe('Decision Intelligence: concurrency', () => {
  it.each([10, 50, 100])('handles %i parallel Decision Intelligence requests', async (n) => {
    fetchMock.mockImplementation(async () => openAiResponse(validDecisionOutput()));
    const { context, prompt } = buildFixture();
    const config = makeConfig();

    const results = await Promise.all(Array.from({ length: n }, () => generateDecisionIntelligence(context, prompt, config)));

    expect(results).toHaveLength(n);
    const ids = new Set(results.map((r) => r.decision.decisionId));
    expect(ids.size).toBe(n);
    for (const r of results) {
      expect(r.validation.ok).toBe(true);
      expect(r.decision.metadata.promptHash).toBe(prompt.promptHash);
    }
  });
});
