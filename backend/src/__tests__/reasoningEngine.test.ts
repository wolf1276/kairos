// Unit + integration tests for the Reasoning Engine foundation (Phase 1): ReasoningContext
// assembly, deterministic prompt building, hashing, metadata, and fail-closed validation.
import { describe, it, expect } from 'vitest';
import {
  buildReasoningContext,
  buildPrompt,
  validateCandidateDecision,
  deriveAllowedPolicy,
  ReasoningContextError,
} from '../reasoning/index.js';
import { buildReasoningRequest, validateDecision } from '../reasoning/orchestrator.js';
import { hashCandidateDecision, hashReasoningContext, hashPromptSections } from '../reasoning/hashing.js';
import { buildCandidateDecisionMetadata } from '../reasoning/metadata.js';
import type { AgentContext } from '../agentContext/index.js';
import type { MemoryPackage } from '../memoryLayer/index.js';
import type { CandidateDecision, UserPolicy } from '../reasoning/index.js';

const AGENT_ID = 'agent-1';

function makeAgentContext(overrides: Partial<AgentContext> = {}): AgentContext {
  const base: AgentContext = {
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
  return { ...base, ...overrides };
}

function makeMemoryPackage(overrides: Partial<MemoryPackage> = {}): MemoryPackage {
  const base: MemoryPackage = {
    meta: { version: '1.0.0', agentId: AGENT_ID, timestamp: Date.now(), packageId: 'pkg-1', packageHash: 'memory-package-hash' },
    episodic: [
      {
        id: 'ep-1', agentId: AGENT_ID, timestamp: Date.now(), contextRef: 'snapshot-1', decisionRef: 'decision-1',
        executionRef: 'exec-1', outcome: 'win', pnl: 12.5, holdingTimeSeconds: 300, confidence: 0.8, quality: 'high', tags: ['xlm'],
      },
    ],
    semantic: [
      { id: 'fact-1', agentId: AGENT_ID, key: 'preferred-pair', value: 'XLM/USDC', confidence: 1, updatedAt: Date.now(), tags: [] },
    ],
    working: [],
    validation: { ok: true, errors: [] },
    status: 'valid',
  };
  return { ...base, ...overrides };
}

function makeUserPolicy(overrides: Partial<UserPolicy> = {}): UserPolicy {
  return {
    userId: 'user-1',
    riskTolerance: 'medium',
    maxAllocationPct: 25,
    allowedProtocols: ['blend'],
    allowedAssets: ['XLM', 'USDC'],
    minConfidence: 0.6,
    objectives: ['grow capital steadily'],
    ...overrides,
  };
}

function makeDecision(overrides: Partial<CandidateDecision> = {}): CandidateDecision {
  const metadata = buildCandidateDecisionMetadata({
    providerVersion: 'none',
    buildDurationMs: 1,
    reasoningHash: 'placeholder',
    promptHash: 'prompt-hash',
  });
  const decision: CandidateDecision = {
    decisionId: 'decision-1',
    timestamp: Date.now(),
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
    metadata,
    ...overrides,
  };
  const reasoningHash = hashCandidateDecision(decision);
  return { ...decision, metadata: { ...decision.metadata, reasoningHash } };
}

// ── ReasoningContext ──────────────────────────────────────────────────────────────────────────

describe('buildReasoningContext', () => {
  it('combines AgentContext + MemoryPackage + UserPolicy into a frozen context', () => {
    const context = buildReasoningContext(makeAgentContext(), makeMemoryPackage(), makeUserPolicy());
    expect(context.agentContext.agentId).toBe(AGENT_ID);
    expect(context.memoryPackage.meta.agentId).toBe(AGENT_ID);
    expect(context.userPolicy.userId).toBe('user-1');
    expect(context.meta.reasoningContextHash).toEqual(expect.any(String));
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.userPolicy)).toBe(true);
    expect(Object.isFrozen(context.agentContext.features)).toBe(true);
  });

  it('rejects mutation attempts on the frozen context', () => {
    const context = buildReasoningContext(makeAgentContext(), makeMemoryPackage(), makeUserPolicy());
    expect(() => {
      (context as unknown as { userPolicy: unknown }).userPolicy = {};
    }).toThrow();
  });

  it('throws when agentContext and memoryPackage belong to different agents', () => {
    const mismatched = makeMemoryPackage({ meta: { ...makeMemoryPackage().meta, agentId: 'agent-2' } });
    expect(() => buildReasoningContext(makeAgentContext(), mismatched, makeUserPolicy())).toThrow(ReasoningContextError);
  });

  it('throws when any input is missing', () => {
    expect(() => buildReasoningContext(undefined as unknown as AgentContext, makeMemoryPackage(), makeUserPolicy())).toThrow(ReasoningContextError);
  });

  it('produces identical reasoningContextHash for identical inputs (determinism)', () => {
    const a = buildReasoningContext(makeAgentContext(), makeMemoryPackage(), makeUserPolicy());
    const b = buildReasoningContext(makeAgentContext(), makeMemoryPackage(), makeUserPolicy());
    expect(a.meta.reasoningContextHash).toBe(b.meta.reasoningContextHash);
  });
});

// ── Prompt Builder ───────────────────────────────────────────────────────────────────────────

describe('buildPrompt', () => {
  it('assembles all required sections', () => {
    const context = buildReasoningContext(makeAgentContext(), makeMemoryPackage(), makeUserPolicy());
    const prompt = buildPrompt(context);
    const sections = prompt.sections;
    for (const key of [
      'system', 'agentIdentity', 'marketContext', 'managedCapital', 'historicalExperience',
      'detectedPatterns', 'evidence', 'riskConstraints', 'allowedProtocols', 'objectives', 'outputSchema',
    ] as const) {
      expect(sections[key]).toEqual(expect.any(String));
      expect(sections[key].length).toBeGreaterThan(0);
    }
    expect(prompt.templateVersion).toBe('v1');
    expect(prompt.promptHash).toEqual(expect.any(String));
  });

  it('is deterministic: identical ReasoningContext produces identical prompt + hash', () => {
    const context = buildReasoningContext(makeAgentContext(), makeMemoryPackage(), makeUserPolicy());
    const p1 = buildPrompt(context);
    const p2 = buildPrompt(context);
    expect(p1).toEqual(p2);
    expect(p1.promptHash).toBe(p2.promptHash);
  });

  it('produces a different hash when the underlying context differs', () => {
    const context1 = buildReasoningContext(makeAgentContext(), makeMemoryPackage(), makeUserPolicy());
    const context2 = buildReasoningContext(makeAgentContext(), makeMemoryPackage(), makeUserPolicy({ riskTolerance: 'high' }));
    const p1 = buildPrompt(context1);
    const p2 = buildPrompt(context2);
    expect(p1.promptHash).not.toBe(p2.promptHash);
  });

  it('throws on an unknown template version', () => {
    const context = buildReasoningContext(makeAgentContext(), makeMemoryPackage(), makeUserPolicy());
    expect(() => buildPrompt(context, 'v999')).toThrow();
  });

  it('returns a frozen prompt', () => {
    const context = buildReasoningContext(makeAgentContext(), makeMemoryPackage(), makeUserPolicy());
    const prompt = buildPrompt(context);
    expect(Object.isFrozen(prompt)).toBe(true);
    expect(Object.isFrozen(prompt.sections)).toBe(true);
  });
});

// ── Hashing ──────────────────────────────────────────────────────────────────────────────────

describe('hashing', () => {
  it('hashReasoningContext is deterministic over identical canonical input', () => {
    const canonical = { a: 1, b: { c: 2 } };
    expect(hashReasoningContext(canonical)).toBe(hashReasoningContext({ b: { c: 2 }, a: 1 }));
  });

  it('hashPromptSections is sensitive to any section change', () => {
    const context = buildReasoningContext(makeAgentContext(), makeMemoryPackage(), makeUserPolicy());
    const prompt = buildPrompt(context);
    const mutatedHash = hashPromptSections({ ...prompt.sections, system: prompt.sections.system + ' ' });
    expect(mutatedHash).not.toBe(prompt.promptHash);
  });

  it('hashCandidateDecision ignores runtime-only fields', () => {
    const d1 = makeDecision({ decisionId: 'd1', timestamp: 1000 });
    const d2 = makeDecision({ decisionId: 'd2', timestamp: 2000 });
    expect(hashCandidateDecision(d1)).toBe(hashCandidateDecision(d2));
  });

  it('hashCandidateDecision changes when decision content changes', () => {
    const d1 = makeDecision({ allocation: 0.1 });
    const d2 = makeDecision({ allocation: 0.2 });
    expect(hashCandidateDecision(d1)).not.toBe(hashCandidateDecision(d2));
  });
});

// ── Metadata ─────────────────────────────────────────────────────────────────────────────────

describe('buildCandidateDecisionMetadata', () => {
  it('stamps version and hash fields', () => {
    const metadata = buildCandidateDecisionMetadata({
      providerVersion: 'test-provider',
      buildDurationMs: 5,
      reasoningHash: 'hash-a',
      promptHash: 'hash-b',
    });
    expect(metadata.reasoningVersion).toEqual(expect.any(String));
    expect(metadata.promptVersion).toBe('v1');
    expect(metadata.providerVersion).toBe('test-provider');
    expect(metadata.reasoningHash).toBe('hash-a');
    expect(metadata.promptHash).toBe('hash-b');
    expect(metadata.schemaVersion).toEqual(expect.any(String));
  });
});

// ── Validation ───────────────────────────────────────────────────────────────────────────────

describe('validateCandidateDecision', () => {
  it('accepts a well-formed decision', () => {
    const result = validateCandidateDecision(makeDecision());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects NaN allocation', () => {
    const result = validateCandidateDecision(makeDecision({ allocation: NaN }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('allocation'))).toBe(true);
  });

  it('rejects Infinity confidence', () => {
    const result = validateCandidateDecision(makeDecision({ confidence: Infinity }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('confidence'))).toBe(true);
  });

  it('rejects missing required fields', () => {
    const decision = makeDecision();
    const { reasoning: _reasoning, ...withoutReasoning } = decision;
    const result = validateCandidateDecision(withoutReasoning as unknown as CandidateDecision);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('reasoning'))).toBe(true);
  });

  it('rejects duplicate supporting evidence', () => {
    const evidence = { source: 'trend', detail: 'ema20 above ema50', weight: 0.5 };
    const result = validateCandidateDecision(makeDecision({ supportingEvidence: [evidence, { ...evidence }] }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('duplicate'))).toBe(true);
  });

  it('rejects an invalid allocation out of range', () => {
    const result = validateCandidateDecision(makeDecision({ allocation: 1.5 }));
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid confidence out of range', () => {
    const result = validateCandidateDecision(makeDecision({ confidence: -0.1 }));
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed protocol', () => {
    const result = validateCandidateDecision(makeDecision({ protocol: '' }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('protocol'))).toBe(true);
  });

  it('rejects a tampered reasoningHash', () => {
    const decision = makeDecision();
    const tampered = { ...decision, metadata: { ...decision.metadata, reasoningHash: 'not-the-real-hash' } };
    const result = validateCandidateDecision(tampered);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('reasoningHash'))).toBe(true);
  });

  it('fails closed on a completely malformed decision', () => {
    const result = validateCandidateDecision({} as unknown as CandidateDecision);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  // Regression (smoke test finding, Phase 2): validateCandidateDecision previously only checked
  // that protocol/asset were non-empty strings — it never cross-checked them against the
  // ReasoningContext's allowed sets. A decision proposing an unsupported protocol or asset would
  // pass validation and reach a caller as `ok: true`. Fixed by making `allowed` an optional
  // second parameter, derived via deriveAllowedPolicy(context) and enforced by every production
  // call site (providers/baseProvider.ts, orchestrator.ts::validateDecision).
  it('accepts a decision with no allowed-policy argument (back-compat, shape-only validation)', () => {
    const result = validateCandidateDecision(makeDecision({ protocol: 'unheard-of-protocol', asset: 'MEME' }));
    expect(result.ok).toBe(true);
  });

  it('rejects a decision proposing a protocol outside the allowed policy', () => {
    const result = validateCandidateDecision(makeDecision({ protocol: 'unheard-of-protocol' }), {
      allowedProtocols: ['blend'],
      allowedAssets: ['XLM', 'USDC'],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('protocol') && e.includes('not an allowed'))).toBe(true);
  });

  it('rejects a decision proposing an asset outside the allowed policy', () => {
    const result = validateCandidateDecision(makeDecision({ asset: 'MEME' }), {
      allowedProtocols: ['blend'],
      allowedAssets: ['XLM', 'USDC'],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('asset') && e.includes('not an allowed'))).toBe(true);
  });

  it('deriveAllowedPolicy is the intersection of AgentContext.policy and UserPolicy (either boundary can veto)', () => {
    const context = buildReasoningContext(
      makeAgentContext({ policy: { ...makeAgentContext().policy, allowedProtocols: ['blend', 'soroswap'], allowedAssets: ['XLM', 'USDC'] } }),
      makeMemoryPackage(),
      makeUserPolicy({ allowedProtocols: ['blend'], allowedAssets: ['XLM'] })
    );
    const allowed = deriveAllowedPolicy(context);
    expect(allowed.allowedProtocols).toEqual(['blend']);
    expect(allowed.allowedAssets).toEqual(['XLM']);
  });

  it('validateDecision(decision, context) rejects an out-of-policy decision end to end', () => {
    const context = buildReasoningContext(makeAgentContext(), makeMemoryPackage(), makeUserPolicy({ allowedProtocols: ['blend'] }));
    const result = validateDecision(makeDecision({ protocol: 'soroswap' }), context);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('protocol'))).toBe(true);
  });
});

// ── Integration: AgentContext -> MemoryPackage -> ReasoningContext -> Prompt ────────────────

describe('integration: full assembly pipeline', () => {
  it('builds a ReasoningRequest end to end via the orchestrator', () => {
    const { context, prompt } = buildReasoningRequest(makeAgentContext(), makeMemoryPackage(), makeUserPolicy());
    expect(context.meta.reasoningContextHash).toEqual(expect.any(String));
    expect(prompt.promptHash).toEqual(expect.any(String));
  });

  it('validateDecision via the orchestrator matches direct validation', () => {
    const decision = makeDecision();
    expect(validateDecision(decision)).toEqual(validateCandidateDecision(decision));
  });

  it('repeated builds from the same inputs produce identical context, prompt, and hashes', () => {
    const agentContext = makeAgentContext();
    const memoryPackage = makeMemoryPackage();
    const userPolicy = makeUserPolicy();

    const first = buildReasoningRequest(agentContext, memoryPackage, userPolicy);
    const second = buildReasoningRequest(agentContext, memoryPackage, userPolicy);

    expect(first.context.meta.reasoningContextHash).toBe(second.context.meta.reasoningContextHash);
    expect(first.prompt.promptHash).toBe(second.prompt.promptHash);
    expect(first.prompt.sections).toEqual(second.prompt.sections);
  });
});

// ── Concurrency ──────────────────────────────────────────────────────────────────────────────

describe('concurrency', () => {
  it.each([10, 50, 100])('produces identical prompt hashes across %i concurrent builds', async (n) => {
    const agentContext = makeAgentContext();
    const memoryPackage = makeMemoryPackage();
    const userPolicy = makeUserPolicy();

    const results = await Promise.all(
      Array.from({ length: n }, async () => {
        const context = buildReasoningContext(agentContext, memoryPackage, userPolicy);
        return buildPrompt(context).promptHash;
      })
    );

    expect(new Set(results).size).toBe(1);
  });
});

// ── Performance ──────────────────────────────────────────────────────────────────────────────

describe('performance', () => {
  function percentile(sorted: number[], p: number): number {
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  }

  it('benchmarks context assembly, prompt assembly, and hashing', () => {
    const agentContext = makeAgentContext();
    const memoryPackage = makeMemoryPackage();
    const userPolicy = makeUserPolicy();
    const iterations = 200;
    const contextDurations: number[] = [];
    const promptDurations: number[] = [];
    const hashDurations: number[] = [];

    let lastContext = buildReasoningContext(agentContext, memoryPackage, userPolicy);
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      lastContext = buildReasoningContext(agentContext, memoryPackage, userPolicy);
      contextDurations.push(performance.now() - t0);

      const t1 = performance.now();
      const prompt = buildPrompt(lastContext);
      promptDurations.push(performance.now() - t1);

      const t2 = performance.now();
      hashPromptSections(prompt.sections);
      hashDurations.push(performance.now() - t2);
    }

    for (const durations of [contextDurations, promptDurations, hashDurations]) {
      durations.sort((a, b) => a - b);
      const avg = durations.reduce((s, v) => s + v, 0) / durations.length;
      const p95 = percentile(durations, 95);
      const p99 = percentile(durations, 99);
      expect(avg).toBeLessThan(50);
      expect(p95).toBeGreaterThanOrEqual(0);
      expect(p99).toBeGreaterThanOrEqual(0);
    }
  });
});
