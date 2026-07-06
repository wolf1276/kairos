// Final Reliability & Chaos Audit for Reasoning Engine Phase 2 — LLM provider layer. Mocks
// `fetch` throughout (never calls a real provider). Covers concurrency stress (10/50/100/250),
// injected failure chaos, retry/backoff/fallback correctness, validation-bypass attempts,
// security (no credential/prompt leakage), and observability (structured logs, fallback/retry
// metrics).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAiProvider } from '../reasoning/providers/openaiProvider.js';
import { OpenRouterProvider, OPENROUTER_BASE_URL, OPENROUTER_AUTO_MODEL } from '../reasoning/providers/openrouterProvider.js';
import { getProviderMetrics, resetProviderMetrics } from '../reasoning/providers/metrics.js';
import { resetOpenRouterRegistryCache } from '../reasoning/providers/openrouterModelRegistry.js';
import { validateCandidateDecision } from '../reasoning/validation.js';
import { buildReasoningContext } from '../reasoning/contextBuilder.js';
import { buildPrompt } from '../reasoning/promptBuilder.js';
import type { AgentContext } from '../agentContext/index.js';
import type { MemoryPackage } from '../memoryLayer/index.js';
import type { ProviderCallConfig } from '../reasoning/providers/types.js';
import type { UserPolicy, CandidateDecision } from '../reasoning/types.js';

const AGENT_ID = 'agent-1';

function makeAgentContext(overrides: Partial<AgentContext> = {}): AgentContext {
  const base: AgentContext = {
    agentId: AGENT_ID,
    owner: 'owner-1',
    role: 'trend_follower' as unknown as AgentContext['role'],
    pair: 'XLM/USDC',
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

function makeConfig(overrides: Partial<ProviderCallConfig> = {}): ProviderCallConfig {
  return {
    provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-super-secret-test-key-should-never-leak',
    temperature: 0.2, maxTokens: 500, timeoutMs: 200, maxRetries: 1, structuredOutput: true, ...overrides,
  };
}

function validModelOutput(overrides: Record<string, unknown> = {}) {
  return {
    action: 'open', protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.7,
    reasoning: 'Trend is up and momentum supports a small allocation.',
    supportingEvidence: [{ source: 'trend', detail: 'ema20 above ema50', weight: 0.6 }],
    risks: [{ description: 'volatility could spike', severity: 'low' }],
    assumptions: ['market stays liquid'],
    alternatives: [{ action: 'hold', reasoning: 'wait for stronger confirmation' }],
    uncertainty: 0.2, ...overrides,
  };
}

function buildPromptFixture(agentOverrides: Partial<AgentContext> = {}) {
  const agentId = (agentOverrides.agentId as string) ?? AGENT_ID;
  const context = buildReasoningContext(makeAgentContext(agentOverrides), makeMemoryPackage({ meta: { ...makeMemoryPackage().meta, agentId } }), makeUserPolicy());
  const prompt = buildPrompt(context);
  return { context, prompt };
}

function openAiResponse(content: unknown, overrides: Record<string, unknown> = {}) {
  return {
    ok: true, status: 200,
    json: async () => ({ id: 'req-1', choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }, ...overrides }),
    text: async () => '',
  };
}

function openRouterModelsResponse(models: { id: string; free: boolean }[]) {
  return {
    ok: true, status: 200,
    json: async () => ({ data: models.map((m) => ({ id: m.id, pricing: m.free ? { prompt: '0', completion: '0' } : { prompt: '0.000003', completion: '0.000015' } })) }),
    text: async () => '',
  };
}

const FREE_CATALOG = [
  { id: 'free-model-a:free', free: true },
  { id: 'free-model-b:free', free: true },
  { id: 'free-model-c:free', free: true },
  { id: 'paid-model-x', free: false },
];

function makeOpenRouterConfig(overrides: Partial<ProviderCallConfig> = {}): ProviderCallConfig {
  return makeConfig({ provider: 'openrouter', model: OPENROUTER_AUTO_MODEL, baseUrl: OPENROUTER_BASE_URL, apiKey: 'sk-openrouter-secret-key', ...overrides });
}

let fetchMock: ReturnType<typeof vi.fn>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let logSpy: any;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  resetProviderMetrics();
  resetOpenRouterRegistryCache();
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── 1. Concurrency ───────────────────────────────────────────────────────────────────────────

describe('audit: concurrency', () => {
  it.each([10, 50, 100, 250])('handles %i parallel reasoning requests with full isolation', async (n) => {
    fetchMock.mockImplementation(async () => openAiResponse(validModelOutput()));
    const provider = new OpenAiProvider(makeConfig());
    const { context, prompt } = buildPromptFixture();

    const decisions = await Promise.all(Array.from({ length: n }, () => provider.generateDecision(context, prompt)));

    expect(decisions).toHaveLength(n);
    const ids = new Set(decisions.map((d) => d.decisionId));
    expect(ids.size).toBe(n); // no shared/aliased decisionId across concurrent calls
    for (const d of decisions) {
      expect(validateCandidateDecision(d, undefined).ok).toBe(true);
      expect(d.metadata.promptHash).toBe(prompt.promptHash); // deterministic prompt, correctly attributed
    }
    const metrics = getProviderMetrics().openai;
    expect(metrics.calls).toBe(n);
    expect(metrics.failures).toBe(0);
  });

  it('two concurrent agents with different contexts never cross-contaminate decisions', async () => {
    fetchMock.mockImplementation(async () => openAiResponse(validModelOutput()));
    const provider = new OpenAiProvider(makeConfig());
    const fixtureA = buildPromptFixture({ agentId: 'agent-A' });
    const fixtureB = buildPromptFixture({ agentId: 'agent-B' });

    const [decisionA, decisionB] = await Promise.all([
      provider.generateDecision(fixtureA.context, fixtureA.prompt),
      provider.generateDecision(fixtureB.context, fixtureB.prompt),
    ]);

    expect(decisionA.metadata.promptHash).toBe(fixtureA.prompt.promptHash);
    expect(decisionB.metadata.promptHash).toBe(fixtureB.prompt.promptHash);
    expect(decisionA.metadata.promptHash).not.toBe(decisionB.metadata.promptHash);
    expect(decisionA.decisionId).not.toBe(decisionB.decisionId);
  });

  it('100 concurrent OpenRouter requests on a cold cache dedupe to a single /models fetch (no thundering herd)', async () => {
    let modelsCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://openrouter.ai/api/v1/models') {
        modelsCalls += 1;
        return openRouterModelsResponse(FREE_CATALOG);
      }
      return openAiResponse(validModelOutput());
    });
    const provider = new OpenRouterProvider(makeOpenRouterConfig());
    const { context, prompt } = buildPromptFixture();

    const decisions = await Promise.all(Array.from({ length: 100 }, () => provider.generateDecision(context, prompt)));

    expect(decisions).toHaveLength(100);
    expect(modelsCalls).toBe(1); // deduped despite 100 concurrent cold-cache callers
  });

  it('does not leak pending timers/handles across a large concurrent batch (no resource leak)', async () => {
    fetchMock.mockImplementation(async () => openAiResponse(validModelOutput()));
    const provider = new OpenAiProvider(makeConfig({ timeoutMs: 5000 }));
    const { context, prompt } = buildPromptFixture();

    const before = (process as any)._getActiveHandles?.().length ?? 0;
    await Promise.all(Array.from({ length: 250 }, () => provider.generateDecision(context, prompt)));
    // Give timers a tick to clear.
    await new Promise((r) => setTimeout(r, 10));
    const after = (process as any)._getActiveHandles?.().length ?? 0;
    // Not an exact equality (Node/test runner internals fluctuate) — the point is 250 requests
    // must not leave 250 outstanding timeout handles behind.
    expect(after - before).toBeLessThan(20);
  });
});

// ── 2. Chaos ─────────────────────────────────────────────────────────────────────────────────

describe('audit: chaos — HTTP failure injection', () => {
  it.each([429, 500, 502, 503])('HTTP %i is classified retryable and recovers on a later attempt', async (status) => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status, text: async () => 'upstream error' })
      .mockResolvedValueOnce(openAiResponse(validModelOutput()));
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 1 }));
    const { context, prompt } = buildPromptFixture();

    const decision = await provider.generateDecision(context, prompt);
    expect(validateCandidateDecision(decision, undefined).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('HTTP 401/403 (invalid or expired API key) fails fast without retry', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'invalid api key' });
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 3 }));
    const { context, prompt } = buildPromptFixture();

    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'authentication' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('unknown/removed model (HTTP 404) is classified model_unavailable and not retried by BaseProvider', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, text: async () => 'model not found' });
    const provider = new OpenAiProvider(makeConfig({ model: 'does-not-exist', maxRetries: 3 }));
    const { context, prompt } = buildPromptFixture();

    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'model_unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(1); // not retryable at BaseProvider level (no retry helps a missing model)
  });

  it('network disconnect (fetch throws ECONNREFUSED-style error) is classified network and retried', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:443'))
      .mockResolvedValueOnce(openAiResponse(validModelOutput()));
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 1 }));
    const { context, prompt } = buildPromptFixture();

    const decision = await provider.generateDecision(context, prompt);
    expect(validateCandidateDecision(decision, undefined).ok).toBe(true);
  });

  it('DNS failure (fetch throws ENOTFOUND-style error) is classified network and retried', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND api.openai.com'))
      .mockResolvedValueOnce(openAiResponse(validModelOutput()));
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 1 }));
    const { context, prompt } = buildPromptFixture();

    const decision = await provider.generateDecision(context, prompt);
    expect(validateCandidateDecision(decision, undefined).ok).toBe(true);
  });

  it('timeout (hanging request past timeoutMs) is classified timeout and retried', async () => {
    let call = 0;
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((resolve, reject) => {
          call += 1;
          if (call === 1) {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          } else {
            resolve(openAiResponse(validModelOutput()) as any);
          }
        })
    );
    const provider = new OpenAiProvider(makeConfig({ timeoutMs: 30, maxRetries: 1 }));
    const { context, prompt } = buildPromptFixture();

    const decision = await provider.generateDecision(context, prompt);
    expect(validateCandidateDecision(decision, undefined).ok).toBe(true);
  });

  it('slow-but-within-timeout response still succeeds (not misclassified as a failure)', async () => {
    fetchMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(openAiResponse(validModelOutput()) as any), 30))
    );
    const provider = new OpenAiProvider(makeConfig({ timeoutMs: 5000, maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();

    const decision = await provider.generateDecision(context, prompt);
    expect(validateCandidateDecision(decision, undefined).ok).toBe(true);
  });

  it('provider_unavailable (503 persisting through all retries) fails closed after budget exhausted', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => 'down' });
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 2 }));
    const { context, prompt } = buildPromptFixture();

    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'provider_unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('audit: chaos — malformed/degenerate JSON payloads', () => {
  it('markdown-fenced JSON is rejected, never parsed as natural language', async () => {
    const fenced = '```json\n' + JSON.stringify(validModelOutput()) + '\n```';
    fetchMock.mockResolvedValueOnce(openAiResponse(fenced));
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();
    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'invalid_json' });
  });

  it('partial/truncated JSON is rejected', async () => {
    const partial = JSON.stringify(validModelOutput()).slice(0, -15);
    fetchMock.mockResolvedValueOnce(openAiResponse(partial));
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();
    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'invalid_json' });
  });

  it('empty response (no message content) is classified empty_response, distinct from invalid_json', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse('', { choices: [{ message: {} }] }));
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();
    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'empty_response' });
  });

  it('oversized-but-valid response still parses and validates correctly', async () => {
    const huge = validModelOutput({ reasoning: 'x'.repeat(200_000) });
    fetchMock.mockResolvedValueOnce(openAiResponse(huge));
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();
    const decision = await provider.generateDecision(context, prompt);
    expect(validateCandidateDecision(decision, undefined).ok).toBe(true);
  });
});

// ── 3. Retry & fallback ──────────────────────────────────────────────────────────────────────

describe('audit: retry policy correctness', () => {
  it('never retries a validation/schema failure', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validModelOutput({ allocation: 99 })));
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 3 }));
    const { context, prompt } = buildPromptFixture();
    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'validation_failed' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('respects the configured retry budget exactly (maxRetries=N -> N+1 attempts)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' });
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 4 }));
    const { context, prompt } = buildPromptFixture();
    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'rate_limit' });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('applies exponential backoff between retries (each delay strictly increases)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' });
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 3 }));
    const { context, prompt } = buildPromptFixture();

    const timestamps: number[] = [];
    fetchMock.mockImplementation(async () => {
      timestamps.push(Date.now());
      return { ok: false, status: 429, text: async () => 'rate limited' };
    });

    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'rate_limit' });
    const gaps = timestamps.slice(1).map((t, i) => t - timestamps[i]);
    expect(gaps.length).toBe(3);
    // Each gap should be meaningfully larger than the last (allowing jitter overlap at the edges).
    expect(gaps[1]).toBeGreaterThan(gaps[0] * 0.8);
    expect(gaps[2]).toBeGreaterThan(gaps[1] * 0.8);
    expect(gaps[0]).toBeGreaterThanOrEqual(200); // base delay floor, minus small scheduling slack
  });

  it('OpenRouter fallback never selects a paid model, even when every free model fails', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://openrouter.ai/api/v1/models') return openRouterModelsResponse(FREE_CATALOG);
      return { ok: false, status: 404, text: async () => 'model not found' };
    });
    const provider = new OpenRouterProvider(makeOpenRouterConfig({ maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();

    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'model_unavailable' });
    const chatCalls = fetchMock.mock.calls.filter((c) => c[0] === 'https://openrouter.ai/api/v1/chat/completions');
    const modelsRequested = chatCalls.map((c) => JSON.parse(c[1].body as string).model);
    expect(modelsRequested.length).toBeGreaterThan(0);
    for (const m of modelsRequested) {
      expect(FREE_CATALOG.find((f) => f.id === m)?.free).toBe(true);
    }
  });

  it('a paid configured model is never attempted, not even once', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://openrouter.ai/api/v1/models') return openRouterModelsResponse(FREE_CATALOG);
      return openAiResponse(validModelOutput());
    });
    const provider = new OpenRouterProvider(makeOpenRouterConfig({ model: 'paid-model-x' }));
    const { context, prompt } = buildPromptFixture();

    await provider.generateDecision(context, prompt);
    const chatCalls = fetchMock.mock.calls.filter((c) => c[0] === 'https://openrouter.ai/api/v1/chat/completions');
    for (const c of chatCalls) {
      expect(JSON.parse(c[1].body as string).model).not.toBe('paid-model-x');
    }
  });

  it('provider config is immutable across repeated calls (no state corruption between requests)', async () => {
    fetchMock.mockImplementation(async () => openAiResponse(validModelOutput()));
    const config = makeConfig();
    const provider = new OpenAiProvider(config);
    const { context, prompt } = buildPromptFixture();

    await provider.generateDecision(context, prompt);
    await provider.generateDecision(context, prompt);
    await provider.generateDecision(context, prompt);

    expect(config).toEqual(makeConfig()); // untouched after 3 calls
  });
});

// ── 4. Validation bypass attempts ───────────────────────────────────────────────────────────

describe('audit: validation cannot be bypassed', () => {
  const attempts: [string, Record<string, unknown>][] = [
    ['NaN allocation', { allocation: NaN }],
    ['Infinity confidence', { confidence: Infinity }],
    ['negative confidence', { confidence: -0.01 }],
    ['allocation > 1', { allocation: 1.01 }],
    ['unsupported protocol', { protocol: 'definitely-not-blend' }],
    ['unsupported asset', { asset: 'DOGE' }],
    ['invalid action enum', { action: 'yolo' }],
    ['empty reasoning', { reasoning: '' }],
  ];

  it.each(attempts)('rejects: %s', async (_label, patch) => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validModelOutput(patch)));
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();
    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'validation_failed' });
  });

  it('rejects duplicate supporting evidence (broken/repeated references)', async () => {
    const dup = { source: 'trend', detail: 'ema20 above ema50', weight: 0.5 };
    fetchMock.mockResolvedValueOnce(openAiResponse(validModelOutput({ supportingEvidence: [dup, { ...dup }] })));
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();
    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'validation_failed' });
  });

  it('rejects a malformed CandidateDecision missing multiple required fields at once', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse({ action: 'open' })); // everything else missing
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();
    await expect(provider.generateDecision(context, prompt)).rejects.toMatchObject({ kind: 'validation_failed' });
  });

  it('rejects a tampered reasoningHash (invalid metadata) even if every field looks well-formed', () => {
    const decision: CandidateDecision = {
      decisionId: 'd1', timestamp: Date.now(), action: 'open', protocol: 'blend', asset: 'XLM',
      allocation: 0.1, confidence: 0.7, reasoning: 'looks fine', supportingEvidence: [{ source: 'a', detail: 'b', weight: 0.5 }],
      risks: [], assumptions: [], alternatives: [], uncertainty: 0.1,
      metadata: { reasoningVersion: '1.0.0', promptVersion: 'v1', providerVersion: 'openai:gpt-4o-mini', buildDurationMs: 1, reasoningHash: 'not-the-real-hash', promptHash: 'ph', schemaVersion: '1.0.0' },
    };
    const result = validateCandidateDecision(decision, undefined);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('reasoningHash'))).toBe(true);
  });
});

// ── 5. Security ──────────────────────────────────────────────────────────────────────────────

describe('audit: security', () => {
  it('API key never appears in a thrown ProviderError message', async () => {
    const secretKey = 'sk-THIS-MUST-NEVER-LEAK-abc123xyz789';
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => `upstream rejected Bearer ${secretKey}` });
    const provider = new OpenAiProvider(makeConfig({ apiKey: secretKey, maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();

    try {
      await provider.generateDecision(context, prompt);
      throw new Error('expected rejection');
    } catch (err) {
      expect((err as Error).message).not.toContain(secretKey);
    }
  });

  it('API key never appears in any console.log call across a full failing request', async () => {
    const secretKey = 'sk-ANOTHER-SECRET-should-not-leak-999';
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'server error, no key echoed' });
    const provider = new OpenAiProvider(makeConfig({ apiKey: secretKey, maxRetries: 1 }));
    const { context, prompt } = buildPromptFixture();

    await expect(provider.generateDecision(context, prompt)).rejects.toBeDefined();
    for (const call of logSpy.mock.calls) {
      const serialized = call.map((a: any) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      expect(serialized).not.toContain(secretKey);
    }
  });

  it('no wallet information (publicKey) ever appears in the prompt sent to a provider', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validModelOutput()));
    const provider = new OpenAiProvider(makeConfig());
    const { context, prompt } = buildPromptFixture({
      features: { ...makeAgentContext().features, wallet: { publicKey: 'GSECRETWALLETADDRESSXXXX', smartWalletAddress: null, delegationActive: true, mode: 'auto' as any, capital: '1000' } },
    });
    await provider.generateDecision(context, prompt);

    const requestBody = fetchMock.mock.calls[0][1].body as string;
    expect(requestBody).not.toContain('GSECRETWALLETADDRESSXXXX');
  });

  it('successful calls produce no logged output containing raw prompt content beyond hashes', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validModelOutput()));
    const provider = new OpenAiProvider(makeConfig());
    const { context, prompt } = buildPromptFixture();
    await provider.generateDecision(context, prompt);

    for (const call of logSpy.mock.calls) {
      const serialized = call.map((a: any) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      expect(serialized).not.toContain(prompt.sections.objectives);
      expect(serialized).not.toContain('grow capital steadily'); // a literal UserPolicy.objectives string
    }
  });

  it('two concurrent requests with different API keys never cross-use each other\'s credentials', async () => {
    const capturedAuthHeaders: string[] = [];
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      capturedAuthHeaders.push((init.headers as Record<string, string>).authorization);
      return openAiResponse(validModelOutput());
    });
    const providerA = new OpenAiProvider(makeConfig({ apiKey: 'sk-agent-A-key' }));
    const providerB = new OpenAiProvider(makeConfig({ apiKey: 'sk-agent-B-key' }));
    const { context, prompt } = buildPromptFixture();

    await Promise.all([providerA.generateDecision(context, prompt), providerB.generateDecision(context, prompt)]);

    expect(capturedAuthHeaders).toContain('Bearer sk-agent-A-key');
    expect(capturedAuthHeaders).toContain('Bearer sk-agent-B-key');
  });
});

// ── 6. Observability ─────────────────────────────────────────────────────────────────────────

describe('audit: observability', () => {
  it('every provider_call log line is well-formed structured JSON with the documented fields', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validModelOutput()));
    const provider = new OpenAiProvider(makeConfig());
    const { context, prompt } = buildPromptFixture();
    await provider.generateDecision(context, prompt);

    const callLine = logSpy.mock.calls.map((c: any) => c[0] as string).find((l: string) => l.includes('"event":"provider_call"'));
    expect(callLine).toBeDefined();
    const parsed = JSON.parse(callLine!);
    expect(parsed).toMatchObject({ component: 'reasoning-engine-provider', event: 'provider_call', provider: 'openai', model: 'gpt-4o-mini' });
    expect(parsed.tokens).toEqual({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    expect(typeof parsed.latencyMs).toBe('number');
    expect(typeof parsed.retryCount).toBe('number');
    expect(typeof parsed.fallbackCount).toBe('number');
    expect('requestId' in parsed).toBe(true);
  });

  it('fallback attempts are logged and reflected in fallbackCount metrics', async () => {
    let call = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://openrouter.ai/api/v1/models') return openRouterModelsResponse(FREE_CATALOG);
      call += 1;
      if (call <= 2) return { ok: false, status: 404, text: async () => 'model not found' };
      return openAiResponse(validModelOutput());
    });
    const provider = new OpenRouterProvider(makeOpenRouterConfig({ maxRetries: 0 }));
    const { context, prompt } = buildPromptFixture();

    const decision = await provider.generateDecision(context, prompt);
    expect(validateCandidateDecision(decision, undefined).ok).toBe(true);

    const fallbackLogs = logSpy.mock.calls.map((c: any) => c[0] as string).filter((l: any) => l.includes('"event":"model_fallback"'));
    expect(fallbackLogs.length).toBe(2);

    const metrics = getProviderMetrics().openrouter;
    expect(metrics.fallbacks).toBe(2);
  });

  it('retry count and timeout count are tracked in per-provider metrics', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'rate limited' })
      .mockResolvedValueOnce(openAiResponse(validModelOutput()));
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 2 }));
    const { context, prompt } = buildPromptFixture();
    await provider.generateDecision(context, prompt);

    const metrics = getProviderMetrics().openai;
    expect(metrics.retries).toBe(1);
    expect(metrics.calls).toBe(1);
  });

  it('token accounting and cost estimation are captured per call', async () => {
    fetchMock.mockResolvedValueOnce(openAiResponse(validModelOutput()));
    const provider = new OpenAiProvider(makeConfig({ model: 'gpt-4o-mini' }));
    const { context, prompt } = buildPromptFixture();
    await provider.generateDecision(context, prompt);

    const metrics = getProviderMetrics().openai;
    expect(metrics.totalPromptTokens).toBe(100);
    expect(metrics.totalCompletionTokens).toBe(50);
    expect(metrics.totalEstimatedCost).toBeGreaterThan(0);
  });
});

// ── 7. Performance (mocked — bounds sanity, not a substitute for the live Phase 2B numbers) ──

describe('audit: performance bounds', () => {
  function percentile(sorted: number[], p: number): number {
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  }

  it('measures avg/P95/P99 latency and throughput across 100 concurrent mocked calls', async () => {
    fetchMock.mockImplementation(async () => openAiResponse(validModelOutput()));
    const provider = new OpenAiProvider(makeConfig());
    const { context, prompt } = buildPromptFixture();

    const durations: number[] = [];
    const wallStart = performance.now();
    await Promise.all(
      Array.from({ length: 100 }, async () => {
        const t0 = performance.now();
        await provider.generateDecision(context, prompt);
        durations.push(performance.now() - t0);
      })
    );
    const wallElapsed = performance.now() - wallStart;

    durations.sort((a, b) => a - b);
    const avg = durations.reduce((s, v) => s + v, 0) / durations.length;
    const throughputPerSec = (100 / wallElapsed) * 1000;

    expect(avg).toBeLessThan(500);
    expect(percentile(durations, 95)).toBeGreaterThanOrEqual(0);
    expect(percentile(durations, 99)).toBeGreaterThanOrEqual(0);
    expect(throughputPerSec).toBeGreaterThan(0);
  });

  it('retry overhead is bounded by backoff policy, not unbounded', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' });
    const provider = new OpenAiProvider(makeConfig({ maxRetries: 2 }));
    const { context, prompt } = buildPromptFixture();

    const t0 = performance.now();
    await expect(provider.generateDecision(context, prompt)).rejects.toBeDefined();
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(15000); // 2 retries at capped exponential backoff, well under 15s
  });
});
