// Unit, integration, chaos, concurrency, and performance tests for Reasoning Engine Phase 2
// (LLM Integration): provider normalization, error mapping, retries, timeouts, metadata, token
// accounting, and provider isolation. Mocks `fetch` — never hits a real provider.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAiProvider } from '../reasoning/providers/openaiProvider.js';
import { AnthropicProvider } from '../reasoning/providers/anthropicProvider.js';
import { DeepSeekProvider } from '../reasoning/providers/deepseekProvider.js';
import { createProvider } from '../reasoning/providers/factory.js';
import { getProviderConstructor } from '../reasoning/providers/registry.js';
import { ProviderError } from '../reasoning/providers/errors.js';
import { getProviderMetrics, resetProviderMetrics } from '../reasoning/providers/metrics.js';
import { estimateCost } from '../reasoning/providers/pricing.js';
import { OpenRouterProvider, OPENROUTER_BASE_URL, OPENROUTER_AUTO_MODEL } from '../reasoning/providers/openrouterProvider.js';
import { NvidiaProvider, NVIDIA_BASE_URL } from '../reasoning/providers/nvidiaProvider.js';
import { getFreeModelIds, isModelFree, resetOpenRouterRegistryCache } from '../reasoning/providers/openrouterModelRegistry.js';
import { buildReasoningContext } from '../reasoning/contextBuilder.js';
import { buildPrompt } from '../reasoning/promptBuilder.js';
import { validateCandidateDecision } from '../reasoning/validation.js';
import type { AgentContext } from '../agentContext/index.js';
import type { MemoryPackage } from '../memoryLayer/index.js';
import type { ProviderCallConfig } from '../reasoning/providers/types.js';
import type { UserPolicy } from '../reasoning/types.js';

const AGENT_ID = 'agent-1';

function makeAgentContext(): AgentContext {
  return {
    agentId: AGENT_ID,
    owner: 'owner-1',
    role: 'trend_follower' as unknown as AgentContext['role'],
    pair: 'XLM/USDC',
    regime: { base: 'XLM', label: 'trending_up' as unknown as AgentContext['regime']['label'], breakout: false, volatilityBand: 'normal' },
    features: {
      pair: 'XLM/USDC',
      price: 0.12,
      trend: { ema20: 0.11, ema50: 0.1, sma20: 0.115, trendStrength: 25, direction: 'up' },
      momentum: { rsi: 55, macdHistogram: 0.001, roc: 0.02 },
      volatility: { atr: 0.002, volatilityPct: 1.5, band: 'normal' },
      volume: { window24h: 1000000, changePct: 5 },
      liquidity: { recentVolume: 500000 },
      wallet: { publicKey: 'GABC', smartWalletAddress: null, delegationActive: true, mode: 'auto' as unknown as AgentContext['features']['wallet']['mode'], capital: '1000' },
      portfolio: { xlmPct: 50, usdcPct: 50, idleUsd: 100, totalValue: 1000, targetXlmPct: 50, targetUsdcPct: 50, driftPct: 0 },
      protocolExposure: [],
      risk: { realizedPnl: 10, unrealizedPnl: -2, drawdownPct: 5, volatilityPct: 1.5 },
      computedAt: Date.now(),
    },
    builtAt: Date.now(),
    meta: { version: '2.1.0', timestamp: Date.now(), marketId: 'market-1', snapshotId: 'snapshot-1', contextHash: 'agent-context-hash' },
    market: {
      pair: 'XLM/USDC',
      price: 0.12,
      oracle: { timestamp: Date.now(), ageSeconds: 10 },
      candles: { resolutionSeconds: 300 },
      trend: { ema20: 0.11, ema50: 0.1, sma20: 0.115, trendStrength: 25, direction: 'up' },
      momentum: { rsi: 55, macdHistogram: 0.001, roc: 0.02 },
      volatility: { atr: 0.002, volatilityPct: 1.5, band: 'normal' },
      volume: { window24h: 1000000, changePct: 5 },
      liquidity: { recentVolume: 500000 },
      regime: { base: 'XLM', label: 'trending_up', breakout: false, volatilityBand: 'normal' },
      confidence: 0.9,
    },
    capital: {
      totalManagedCapital: 1000,
      idleCapital: 100,
      deployableCapital: 900,
      allocation: { xlmPct: 50, usdcPct: 50 },
      protocolExposure: [],
      realizedPnl: 10,
      unrealizedPnl: -2,
      pendingExecutions: [],
      confidence: 0.95,
    },
    policy: {
      objective: 'trend_follower' as unknown as AgentContext['policy']['objective'],
      riskProfile: 'moderate',
      allowedAssets: ['XLM', 'USDC'],
      allowedProtocols: ['blend'],
      delegationActive: true,
      spendingLimitPerTrade: '100',
      minConfidence: 0.6,
      positionLimit: { maxCapital: '500' },
      confidence: 1,
    },
    system: {
      oracleHealthy: true,
      schedulerRunning: true,
      priceFeedRunning: true,
      agentRunning: true,
      protocolExecutionAvailable: true,
      executionAvailable: true,
      featureFlags: {},
      confidence: 1,
    },
    historical: {
      lastExecution: null,
      lastDecision: null,
      recentFailureCount: 0,
      cooldown: { active: false, remainingSeconds: 0 },
      recentExecutionSummary: { tradeCount: 0, successCount: 0, failureCount: 0 },
      confidence: 1,
    },
    validation: { ok: true, errors: [] },
    status: 'valid',
    quality: { score: 0.95, level: 'high', domainConfidence: { market: 0.9, capital: 0.95, policy: 1, system: 1, historical: 1 } },
  };
}

function makeMemoryPackage(): MemoryPackage {
  return {
    meta: { version: '1.0.0', agentId: AGENT_ID, timestamp: Date.now(), packageId: 'pkg-1', packageHash: 'memory-package-hash' },
    episodic: [],
    semantic: [],
    working: [],
    validation: { ok: true, errors: [] },
    status: 'valid',
  };
}

function makeUserPolicy(): UserPolicy {
  return {
    userId: 'user-1',
    riskTolerance: 'medium',
    maxAllocationPct: 25,
    allowedProtocols: ['blend'],
    allowedAssets: ['XLM', 'USDC'],
    minConfidence: 0.6,
    objectives: ['grow capital steadily'],
  };
}

function makeConfig(overrides: Partial<ProviderCallConfig> = {}): ProviderCallConfig {
  return {
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: 'test-key',
    temperature: 0.2,
    maxTokens: 500,
    timeoutMs: 200,
    maxRetries: 1,
    structuredOutput: true,
    ...overrides,
  };
}

function validModelOutput(overrides: Record<string, unknown> = {}) {
  return {
    action: 'open',
    protocol: 'blend',
    asset: 'XLM',
    allocation: 0.1,
    confidence: 0.7,
    reasoning: 'Trend is up and momentum supports a small allocation.',
    supportingEvidence: [{ source: 'trend', detail: 'ema20 above ema50', weight: 0.6 }],
    risks: [{ description: 'volatility could spike', severity: 'low' }],
    assumptions: ['market stays liquid'],
    alternatives: [{ action: 'hold', reasoning: 'wait for stronger confirmation' }],
    uncertainty: 0.2,
    ...overrides,
  };
}

function buildPromptFixture() {
  const context = buildReasoningContext(makeAgentContext(), makeMemoryPackage(), makeUserPolicy());
  const prompt = buildPrompt(context);
  return { context, prompt };
}

function openAiResponse(content: unknown, overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: 'req-1',
      choices: [{ message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      ...overrides,
    }),
    text: async () => '',
  };
}

function anthropicResponse(input: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: 'req-2',
      content: [{ type: 'tool_use', name: 'emit_candidate_decision', input }],
      usage: { input_tokens: 80, output_tokens: 40 },
    }),
    text: async () => '',
  };
}

function openRouterModelsResponse(models: { id: string; free: boolean }[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: models.map((m) => ({
        id: m.id,
        pricing: m.free ? { prompt: '0', completion: '0' } : { prompt: '0.000003', completion: '0.000015' },
      })),
    }),
    text: async () => '',
  };
}

const SAMPLE_CATALOG = [
  { id: 'meta-llama/llama-3.1-8b-instruct:free', free: true },
  { id: 'mistralai/mistral-7b-instruct:free', free: true },
  { id: 'qwen/qwen-2.5-7b-instruct:free', free: true },
  { id: 'openai/gpt-4o', free: false },
  { id: 'anthropic/claude-3.5-sonnet', free: false },
];

function mockOpenRouterEndpoints(chatResponse: () => unknown, catalog: { id: string; free: boolean }[] = SAMPLE_CATALOG) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === 'https://openrouter.ai/api/v1/models') return openRouterModelsResponse(catalog);
    return chatResponse();
  });
}

function makeOpenRouterConfig(overrides: Partial<ProviderCallConfig> = {}): ProviderCallConfig {
  return makeConfig({
    provider: 'openrouter',
    model: OPENROUTER_AUTO_MODEL,
    baseUrl: OPENROUTER_BASE_URL,
    ...overrides,
  });
}

function makeNvidiaConfig(overrides: Partial<ProviderCallConfig> = {}): ProviderCallConfig {
  return makeConfig({
    provider: 'nvidia',
    model: 'z-ai/glm-5.2',
    baseUrl: NVIDIA_BASE_URL,
    ...overrides,
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  resetProviderMetrics();
  resetOpenRouterRegistryCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Normalization ────────────────────────────────────────────────────────────────────────────

describe('provider normalization', () => {
  it('OpenAI: normalizes a well-formed structured response into a valid CandidateDecision', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validModelOutput()));
    const provider = new OpenAiProvider(makeConfig());
    const { context, prompt } = buildPromptFixture();

    const decision = await provider.generateDecision(context, prompt);

    expect(validateCandidateDecision(decision).ok).toBe(true);
    expect(decision.metadata.providerVersion).toBe('openai:gpt-4o-mini');
    expect(decision.metadata.promptHash).toBe(prompt.promptHash);
  });

  // Regression (live smoke test finding): response_format.json_schema without `strict: true`
  // is advisory only — a live gpt-4o-mini call returned allocation=100 (percentage, not a
  // [0,1] fraction) and an extra undeclared "metadata" property despite additionalProperties:
  // false in the schema. OpenAI's Structured Outputs only actually enforces the schema
  // (required/additionalProperties/enum) when `strict: true` is set on json_schema. Fixed in
  // openaiProvider.ts; this asserts the flag is present on every structured-output request.
  it('OpenAI: sets strict:true on the json_schema response_format so schema constraints are enforced', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validModelOutput()));
    const provider = new OpenAiProvider(makeConfig({ structuredOutput: true }));
    const { context, prompt } = buildPromptFixture();

    await provider.generateDecision(context, prompt);

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody.response_format.type).toBe('json_schema');
    expect(requestBody.response_format.json_schema.strict).toBe(true);
  });

  it('Anthropic: normalizes a forced tool_use response into a valid CandidateDecision', async () => {
    fetchMock.mockResolvedValueOnce(anthropicResponse(validModelOutput()));
    const provider = new AnthropicProvider(makeConfig({ provider: 'anthropic', model: 'claude-sonnet-5' }));
    const { context, prompt } = buildPromptFixture();

    const decision = await provider.generateDecision(context, prompt);

    expect(validateCandidateDecision(decision).ok).toBe(true);
    expect(decision.metadata.providerVersion).toBe('anthropic:claude-sonnet-5');
  });

  it('DeepSeek: normalizes a json_object response into a valid CandidateDecision', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validModelOutput()));
    const provider = new DeepSeekProvider(makeConfig({ provider: 'deepseek', model: 'deepseek-chat' }));
    const { context, prompt } = buildPromptFixture();

    const decision = await provider.generateDecision(context, prompt);

    expect(validateCandidateDecision(decision).ok).toBe(true);
    expect(decision.metadata.providerVersion).toBe('deepseek:deepseek-chat');
  });

  it('all three providers produce an identical CandidateDecision schema shape', async () => {
    const { context, prompt } = buildPromptFixture();

    fetchMock.mockResolvedValueOnce(openAiResponse(validModelOutput()));
    const openai = await new OpenAiProvider(makeConfig()).generateDecision(context, prompt);

    fetchMock.mockResolvedValueOnce(anthropicResponse(validModelOutput()));
    const anthropic = await new AnthropicProvider(makeConfig({ provider: 'anthropic' })).generateDecision(context, prompt);

    expect(Object.keys(openai).sort()).toEqual(Object.keys(anthropic).sort());
    expect(Object.keys(openai.metadata).sort()).toEqual(Object.keys(anthropic.metadata).sort());
  });
});

// ── Error mapping ────────────────────────────────────────────────────────────────────────────

describe('error mapping', () => {
  it('maps HTTP 401 to an authentication ProviderError', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'unauthorized' });
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();

    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'authentication' });
  });

  it('maps HTTP 429 to a retryable rate_limit ProviderError', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' });
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();

    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'rate_limit', retryable: true });
  });

  it('maps HTTP 500 to a retryable provider_unavailable ProviderError', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => 'down' });
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();

    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'provider_unavailable' });
  });

  it('never retries malformed JSON', async () => {
    fetchMock.mockResolvedValue(openAiResponse('not json {{{'));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'not valid json' } }], usage: {} }),
      text: async () => '',
    });
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 3 }));
    const { context, prompt } = buildPromptFixture();

    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'invalid_json' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a validation failure (e.g. invalid allocation) without retry', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validModelOutput({ allocation: 5 })));
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 3 }));
    const { context, prompt } = buildPromptFixture();

    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'validation_failed' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects markdown-fenced JSON without stripping fences (never parse natural language)', async () => {
    const fenced = '```json\n' + JSON.stringify(validModelOutput()) + '\n```';
    fetchMock.mockResolvedValueOnce(openAiResponse(fenced));
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();

    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'invalid_json' });
  });

  it('rejects JSON with trailing prose', async () => {
    const withProse = JSON.stringify(validModelOutput()) + '\n\nHope this helps!';
    fetchMock.mockResolvedValueOnce(openAiResponse(withProse));
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();

    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'invalid_json' });
  });

  it('rejects partial/truncated JSON', async () => {
    const partial = JSON.stringify(validModelOutput()).slice(0, -10);
    fetchMock.mockResolvedValueOnce(openAiResponse(partial));
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();

    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'invalid_json' });
  });

  it('rejects an empty response body', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(''));
    // openAiResponse JSON.stringify('') -> '""', which parses to a string, not an object.
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();

    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'invalid_json' });
  });

  it('maps an invalid/unavailable model (HTTP 404) to model_unavailable', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'model not found' });
    const provider = new OpenAiProvider(makeConfig({ model: 'not-a-real-model', maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();

    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'model_unavailable' });
  });

  it('rejects a decision proposing an out-of-policy protocol (policy-escape regression)', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validModelOutput({ protocol: 'unheard-of-protocol' })));
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();

    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'validation_failed' });
  });

  it('sanitizes API keys out of error messages', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'auth failed for Bearer sk-abcdef1234567890' });
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();

    try {
      await provider.generateDecision(context, prompt);
      throw new Error('expected rejection');
    } catch (err) {
      expect((err as Error).message).not.toContain('sk-abcdef1234567890');
    }
  });
});

// ── Timeouts & retries ───────────────────────────────────────────────────────────────────────

describe('timeout and retry handling', () => {
  it('times out a hanging request and reports a timeout ProviderError', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    const provider = new OpenAiProvider(makeConfig({ timeoutMs: 20, maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();

    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('retries transient failures up to maxRetries, then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'rate limited' })
      .mockResolvedValueOnce(openAiResponse(validModelOutput()));
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 2 }));
    const { context, prompt } = buildPromptFixture();

    const decision = await provider.generateDecision(context, prompt);
    expect(validateCandidateDecision(decision).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after exhausting maxRetries on persistent transient failures', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => 'down' });
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 2 }));
    const { context, prompt } = buildPromptFixture();

    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'provider_unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

// ── Metadata & token accounting ──────────────────────────────────────────────────────────────

describe('metadata and token accounting', () => {
  it('records latency, tokens, retries, and estimated cost in provider metrics', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validModelOutput()));
    const provider = new OpenAiProvider(makeConfig());
    const { context, prompt } = buildPromptFixture();

    await provider.generateDecision(context, prompt);

    const metrics = getProviderMetrics();
    expect(metrics.openai.calls).toBe(1);
    expect(metrics.openai.totalPromptTokens).toBe(100);
    expect(metrics.openai.totalCompletionTokens).toBe(50);
    expect(metrics.openai.totalTokens).toBe(150);
  });

  it('estimateCost is deterministic and zero for unknown model/provider pairs', () => {
    const usage = { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 };
    expect(estimateCost('openai', 'unknown-model', usage)).toBe(0);
    expect(estimateCost('openai', 'gpt-4o-mini', usage)).toBeGreaterThan(0);
  });

  it('stamps a reasoningHash that matches an independent recomputation', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validModelOutput()));
    const provider = new OpenAiProvider(makeConfig());
    const { context, prompt } = buildPromptFixture();

    const decision = await provider.generateDecision(context, prompt);
    expect(validateCandidateDecision(decision).ok).toBe(true);
  });
});

// ── OpenRouter provider (free-model registry, fallback, failover) ──────────────────────────────

describe('NVIDIA provider', () => {
  it('normalizes a well-formed structured response into a valid CandidateDecision', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validModelOutput()));
    const provider = new NvidiaProvider(makeNvidiaConfig());
    const { context, prompt } = buildPromptFixture();

    const decision = await provider.generateDecision(context, prompt);

    expect(validateCandidateDecision(decision).ok).toBe(true);
    expect(decision.metadata.providerVersion).toBe('nvidia:z-ai/glm-5.2');
  });

  it('sets strict:true on the json_schema response_format', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validModelOutput()));
    const provider = new NvidiaProvider(makeNvidiaConfig());
    const { context, prompt } = buildPromptFixture();

    await provider.generateDecision(context, prompt);

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody.response_format.json_schema.strict).toBe(true);
  });

  it('requests against the NVIDIA base URL', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validModelOutput()));
    const provider = new NvidiaProvider(makeNvidiaConfig());
    const { context, prompt } = buildPromptFixture();

    await provider.generateDecision(context, prompt);

    expect(fetchMock.mock.calls[0][0]).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
  });

  it('maps an authentication failure the same way every other provider does', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'unauthorized' });
    const provider = new NvidiaProvider(makeNvidiaConfig({ maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();

    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'authentication', provider: 'nvidia' });
  });

  it('createProvider(nvidia) is registered in the factory', () => {
    expect(createProvider(makeNvidiaConfig())).toBeInstanceOf(NvidiaProvider);
  });
});

describe('OpenRouter provider', () => {
  it('free-model selection: "auto" resolves to a free model from the registry, never a paid one', async () => {
    mockOpenRouterEndpoints(() => openAiResponse(validModelOutput()));
    const provider = new OpenRouterProvider(makeOpenRouterConfig());
    const { context, prompt } = buildPromptFixture();

    const decision = await provider.generateDecision(context, prompt);

    expect(validateCandidateDecision(decision).ok).toBe(true);
    const chatCall = fetchMock.mock.calls.find((c) => c[0] === 'https://openrouter.ai/api/v1/chat/completions');
    const requestedModel = JSON.parse(chatCall![1].body as string).model;
    expect(SAMPLE_CATALOG.find((m) => m.id === requestedModel)?.free).toBe(true);
  });

  it('getFreeModelIds only returns models with zero prompt/completion pricing', async () => {
    fetchMock.mockResolvedValueOnce(openRouterModelsResponse(SAMPLE_CATALOG));
    const freeIds = await getFreeModelIds('test-key');

    expect(freeIds).toEqual(['meta-llama/llama-3.1-8b-instruct:free', 'mistralai/mistral-7b-instruct:free', 'qwen/qwen-2.5-7b-instruct:free'].sort());
    expect(freeIds).not.toContain('openai/gpt-4o');
    expect(freeIds).not.toContain('anthropic/claude-3.5-sonnet');
  });

  it('isModelFree treats an unknown/unlisted model as NOT free (fail closed)', async () => {
    fetchMock.mockResolvedValueOnce(openRouterModelsResponse(SAMPLE_CATALOG));
    expect(await isModelFree('test-key', 'some/nonexistent-model')).toBe(false);
  });

  it('a configured paid model is never used — silently falls back to the free registry instead', async () => {
    mockOpenRouterEndpoints(() => openAiResponse(validModelOutput()));
    const provider = new OpenRouterProvider(makeOpenRouterConfig({ model: 'openai/gpt-4o' }));
    const { context, prompt } = buildPromptFixture();

    await provider.generateDecision(context, prompt);

    const chatCall = fetchMock.mock.calls.find((c) => c[0] === 'https://openrouter.ai/api/v1/chat/completions');
    const requestedModel = JSON.parse(chatCall![1].body as string).model;
    expect(requestedModel).not.toBe('openai/gpt-4o');
    expect(SAMPLE_CATALOG.find((m) => m.id === requestedModel)?.free).toBe(true);
  });

  it('a configured free model is tried first, and used, when available', async () => {
    mockOpenRouterEndpoints(() => openAiResponse(validModelOutput()));
    const provider = new OpenRouterProvider(makeOpenRouterConfig({ model: 'qwen/qwen-2.5-7b-instruct:free' }));
    const { context, prompt } = buildPromptFixture();

    await provider.generateDecision(context, prompt);

    const chatCall = fetchMock.mock.calls.find((c) => c[0] === 'https://openrouter.ai/api/v1/chat/completions');
    expect(JSON.parse(chatCall![1].body as string).model).toBe('qwen/qwen-2.5-7b-instruct:free');
  });

  it('unavailable model / invalid model: a 404 on the first free model falls over to the next free model', async () => {
    let call = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://openrouter.ai/api/v1/models') return openRouterModelsResponse(SAMPLE_CATALOG);
      call += 1;
      if (call === 1) return { ok: false, status: 404, text: async () => 'model not found' };
      return openAiResponse(validModelOutput());
    });
    const provider = new OpenRouterProvider(makeOpenRouterConfig());
    const { context, prompt } = buildPromptFixture();

    const decision = await provider.generateDecision(context, prompt);

    expect(validateCandidateDecision(decision).ok).toBe(true);
    const chatCalls = fetchMock.mock.calls.filter((c) => c[0] === 'https://openrouter.ai/api/v1/chat/completions');
    expect(chatCalls).toHaveLength(2);
    expect(JSON.parse(chatCalls[0][1].body as string).model).not.toBe(JSON.parse(chatCalls[1][1].body as string).model);
  });

  // Regression (live smoke test finding): a real free OpenRouter model returned HTTP 429
  // ("temporarily rate-limited upstream") — since only `model_unavailable` triggered fallback,
  // BaseProvider retried the SAME congested model twice and gave up, even though 27 other free
  // models were available. Rate limits on OpenRouter's free tier are per-model (shared upstream
  // capacity), so a 429 should advance to the next free model, not retry the same one.
  it('a rate-limited (429) free model falls over to the next free model instead of retrying itself', async () => {
    let call = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://openrouter.ai/api/v1/models') return openRouterModelsResponse(SAMPLE_CATALOG);
      call += 1;
      if (call === 1) return { ok: false, status: 429, text: async () => 'rate limited upstream' };
      return openAiResponse(validModelOutput());
    });
    const provider = new OpenRouterProvider(makeOpenRouterConfig({ maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();

    const decision = await provider.generateDecision(context, prompt);

    expect(validateCandidateDecision(decision).ok).toBe(true);
    const chatCalls = fetchMock.mock.calls.filter((c) => c[0] === 'https://openrouter.ai/api/v1/chat/completions');
    expect(chatCalls).toHaveLength(2);
    expect(JSON.parse(chatCalls[0][1].body as string).model).not.toBe(JSON.parse(chatCalls[1][1].body as string).model);
  });

  // Regression (live smoke test finding): OpenRouter's free-pricing catalog can include entries
  // that aren't actually chat-capable (e.g. audio/image models), which return an empty
  // completion for a chat request. That should also advance to the next free model rather than
  // failing the whole request.
  it('a free model returning an empty completion falls over to the next free model', async () => {
    let call = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://openrouter.ai/api/v1/models') return openRouterModelsResponse(SAMPLE_CATALOG);
      call += 1;
      if (call === 1) return openAiResponse('', { choices: [{ message: {} }] });
      return openAiResponse(validModelOutput());
    });
    const provider = new OpenRouterProvider(makeOpenRouterConfig({ maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();

    const decision = await provider.generateDecision(context, prompt);
    expect(validateCandidateDecision(decision).ok).toBe(true);
  });

  it('empty_response is retryable at the BaseProvider level for the direct OpenAI path too', async () => {
    fetchMock
      .mockResolvedValueOnce(openAiResponse('', { choices: [{ message: {} }] }))
      .mockResolvedValueOnce(openAiResponse(validModelOutput()));
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 1 }));
    const { context, prompt } = buildPromptFixture();

    const decision = await provider.generateDecision(context, prompt);
    expect(validateCandidateDecision(decision).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('provider failover: cascades through every free model, never touching a paid one, before giving up', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://openrouter.ai/api/v1/models') return openRouterModelsResponse(SAMPLE_CATALOG);
      return { ok: false, status: 404, text: async () => 'model not found' };
    });
    const provider = new OpenRouterProvider(makeOpenRouterConfig({ maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();

    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'model_unavailable' });

    const chatCalls = fetchMock.mock.calls.filter((c) => c[0] === 'https://openrouter.ai/api/v1/chat/completions');
    const modelsRequested = chatCalls.map((c) => JSON.parse(c[1].body as string).model);
    expect(modelsRequested).toHaveLength(3); // every free model in SAMPLE_CATALOG, none paid
    for (const model of modelsRequested) {
      expect(SAMPLE_CATALOG.find((m) => m.id === model)?.free).toBe(true);
    }
  });

  it('fails closed with provider_unavailable when the free-model registry itself is empty', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://openrouter.ai/api/v1/models') return openRouterModelsResponse(SAMPLE_CATALOG.filter((m) => !m.free));
      return openAiResponse(validModelOutput());
    });
    const provider = new OpenRouterProvider(makeOpenRouterConfig({ maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();

    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'provider_unavailable' });
    const chatCalls = fetchMock.mock.calls.filter((c) => c[0] === 'https://openrouter.ai/api/v1/chat/completions');
    expect(chatCalls).toHaveLength(0);
  });

  it('fails closed with provider_unavailable when the registry endpoint itself is unreachable', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://openrouter.ai/api/v1/models') throw new Error('ENOTFOUND openrouter.ai');
      return openAiResponse(validModelOutput());
    });
    const provider = new OpenRouterProvider(makeOpenRouterConfig({ maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();

    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'provider_unavailable' });
  });

  it('createProvider(openrouter) is registered in the factory', () => {
    expect(createProvider(makeOpenRouterConfig())).toBeInstanceOf(OpenRouterProvider);
  });
});

// ── Factory / registry ───────────────────────────────────────────────────────────────────────

describe('factory and registry', () => {
  it('createProvider selects the concrete class purely from config.provider', () => {
    expect(createProvider(makeConfig({ provider: 'openai' }))).toBeInstanceOf(OpenAiProvider);
    expect(createProvider(makeConfig({ provider: 'anthropic' }))).toBeInstanceOf(AnthropicProvider);
    expect(createProvider(makeConfig({ provider: 'deepseek' }))).toBeInstanceOf(DeepSeekProvider);
    expect(createProvider(makeOpenRouterConfig())).toBeInstanceOf(OpenRouterProvider);
    expect(createProvider(makeNvidiaConfig())).toBeInstanceOf(NvidiaProvider);
  });

  it('registry throws on an unregistered provider name', () => {
    expect(() => getProviderConstructor('unknown' as never)).toThrow();
  });
});

// ── Concurrency & provider isolation ─────────────────────────────────────────────────────────

describe('concurrency', () => {
  it.each([10, 50, 100])('handles %i parallel reasoning requests with provider isolation', async (n) => {
    fetchMock.mockImplementation(async () => openAiResponse(validModelOutput()));
    const providers = Array.from({ length: n }, () => new OpenAiProvider(makeConfig()));
    const { context, prompt } = buildPromptFixture();

    const decisions = await Promise.all(providers.map((p) => p.generateDecision(context, prompt)));

    expect(decisions).toHaveLength(n);
    const ids = new Set(decisions.map((d) => d.decisionId));
    expect(ids.size).toBe(n);
    for (const d of decisions) expect(validateCandidateDecision(d).ok).toBe(true);
  });
});

// ── Performance ──────────────────────────────────────────────────────────────────────────────

describe('performance', () => {
  function percentile(sorted: number[], p: number): number {
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  }

  it('benchmarks provider overhead, normalization, and validation', async () => {
    fetchMock.mockImplementation(async () => openAiResponse(validModelOutput()));
    const provider = new OpenAiProvider(makeConfig());
    const { context, prompt } = buildPromptFixture();
    const iterations = 50;
    const durations: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      await provider.generateDecision(context, prompt);
      durations.push(performance.now() - t0);
    }

    durations.sort((a, b) => a - b);
    const avg = durations.reduce((s, v) => s + v, 0) / durations.length;
    expect(avg).toBeLessThan(100);
    expect(percentile(durations, 95)).toBeGreaterThanOrEqual(0);
    expect(percentile(durations, 99)).toBeGreaterThanOrEqual(0);
  });
});
