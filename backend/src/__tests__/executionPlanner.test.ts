// Reasoning Engine Phase 5 (Execution Planner) tests. Pure/deterministic — no fetch mocks, no
// LLM calls. Covers single/multi-action plans, dependency ordering, circular-dependency
// detection, rollback generation, invalid protocol/asset, insufficient balance, deterministic
// hashes, replay, and 10/50/100/250-way concurrency.
import { describe, it, expect } from 'vitest';
import { buildReasoningContext } from '../reasoning/contextBuilder.js';
import { verifyDecision } from '../reasoning/verification/index.js';
import { buildExecutionPlan, ExecutionPlanValidationError, topologicalSort } from '../reasoning/executionPlanner/index.js';
import { hashDecisionIntelligence } from '../reasoning/decisionIntelligence/hashing.js';
import { buildCandidateDecisionMetadata } from '../reasoning/metadata.js';
import type { AgentContext } from '../agentContext/index.js';
import type { MemoryPackage } from '../memoryLayer/index.js';
import type { ReasoningContext, UserPolicy } from '../reasoning/types.js';
import type { DecisionIntelligence } from '../reasoning/decisionIntelligence/types.js';
import type { VerifiedDecision } from '../reasoning/verification/types.js';

const AGENT_ID = 'agent-plan';
const FIXED_NOW = 1_700_000_000_000;

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
    userId: 'user-1', riskTolerance: 'medium', maxAllocationPct: 90,
    allowedProtocols: ['blend'], allowedAssets: ['XLM', 'USDC'], minConfidence: 0.5,
    objectives: ['grow capital steadily'], ...overrides,
  };
}

function makeContext(agentOverrides: Partial<AgentContext> = {}, policyOverrides: Partial<UserPolicy> = {}): ReasoningContext {
  return buildReasoningContext(makeAgentContext(agentOverrides), makeMemoryPackage(), makeUserPolicy(policyOverrides));
}

function makeDecisionIntelligence(overrides: Partial<DecisionIntelligence> = {}): DecisionIntelligence {
  const metadata = buildCandidateDecisionMetadata({ providerVersion: 'test:test', buildDurationMs: 1, reasoningHash: 'x', promptHash: 'prompt-hash' });
  const decision: DecisionIntelligence = {
    decisionId: 'decision-1',
    timestamp: Date.now(),
    primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.7 },
    alternatives: [
      { action: 'HOLD', protocol: 'blend', asset: 'XLM', allocation: 0.05, confidence: 0.6, tradeoffs: 'safer' },
      { action: 'REBALANCE', protocol: 'blend', asset: 'XLM', allocation: 0.15, confidence: 0.5, tradeoffs: 'more upside' },
    ],
    reasoningChain: [{ step: 'Trend supportive.', evidenceRefs: [0] }],
    evidence: [{ type: 'market_indicator', source: 'trend', detail: 'ema20 above ema50', weight: 0.6 }],
    risks: [{ description: 'volatility could spike', probability: 0.2, severity: 'low', mitigation: 'monitor' }],
    assumptions: ['market stays liquid'],
    uncertainty: { missingInformation: [], conflictingEvidence: [], lowConfidenceSignals: [], score: 0.2 },
    expectedOutcome: { direction: 'up', expectedBenefit: 'modest gain', expectedDownside: 'small loss' },
    confidence: { overall: 0.68, perSection: { primaryDecision: 0.7, alternatives: 0.6, evidence: 0.7, risk: 0.65, expectedOutcome: 0.65 } },
    summary: 'Deposit modestly into blend.',
    metadata: { ...metadata, decisionVersion: '1.0.0', reasoningDurationMs: 1, evidenceCount: 1, alternativeCount: 2, uncertaintyScore: 0.2, promptHash: 'prompt-hash' } as unknown as DecisionIntelligence['metadata'],
    ...overrides,
  };
  const decisionHash = hashDecisionIntelligence(decision);
  return { ...decision, metadata: { ...decision.metadata, decisionHash } };
}

function makeVerified(decisionOverrides: Partial<DecisionIntelligence> = {}, context: ReasoningContext = makeContext()): VerifiedDecision {
  const result = verifyDecision(makeDecisionIntelligence(decisionOverrides), context, { now: FIXED_NOW });
  if (result.status !== 'verified') throw new Error(`test fixture decision failed verification: ${result.failedRules.join(', ')}`);
  return result;
}

// ── Single / multi action generation ────────────────────────────────────────────────────────

describe('buildExecutionPlan: plan generation', () => {
  it('generates a 4-step plan for a single DEPOSIT action', () => {
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({}, context), context);
    expect(plan.steps).toHaveLength(4);
    expect(plan.steps.map((s) => s.type)).toEqual(['prerequisite_check', 'simulate', 'execute', 'confirm']);
  });

  it('generates a trivial 1-step no_op plan for HOLD', () => {
    const context = makeContext();
    const decision = makeVerified({ primaryDecision: { action: 'HOLD', protocol: 'blend', asset: 'XLM', allocation: 0, confidence: 0.7 } }, context);
    const plan = buildExecutionPlan(decision, context);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].action).toBe('no_op');
    expect(plan.estimatedFees[0].estimatedFee).toBe('0.000000');
  });

  it('rejects planning a RejectedDecision', () => {
    const context = makeContext({}, { allowedProtocols: ['other'] }); // forces rejection
    const rejected = verifyDecision(makeDecisionIntelligence(), context, { now: FIXED_NOW });
    expect(rejected.status).toBe('rejected');
    expect(() => buildExecutionPlan(rejected as any, context)).toThrow(ExecutionPlanValidationError);
  });

  it('produces deterministic step ordering across repeated builds', () => {
    const context = makeContext();
    const decision = makeVerified({}, context);
    const p1 = buildExecutionPlan(decision, context);
    const p2 = buildExecutionPlan(decision, context);
    expect(p1.steps.map((s) => s.stepId)).toEqual(p2.steps.map((s) => s.stepId));
  });

  it('assigns a unique executionId per build, but identical planHash', () => {
    const context = makeContext();
    const decision = makeVerified({}, context);
    const p1 = buildExecutionPlan(decision, context);
    const p2 = buildExecutionPlan(decision, context);
    expect(p1.executionId).not.toBe(p2.executionId);
    expect(p1.planHash).toBe(p2.planHash);
  });
});

// ── Dependency graph ─────────────────────────────────────────────────────────────────────────

describe('topologicalSort: dependency graph validation', () => {
  it('sorts a valid linear DAG', () => {
    const result = topologicalSort([
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['b'] },
    ]);
    expect(result.ok).toBe(true);
    expect(result.order).toEqual(['a', 'b', 'c']);
  });

  it('detects a circular dependency', () => {
    const result = topologicalSort([
      { id: 'a', dependsOn: ['b'] },
      { id: 'b', dependsOn: ['a'] },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('circular');
  });

  it('detects a self-dependency (a depends on itself)', () => {
    const result = topologicalSort([{ id: 'a', dependsOn: ['a'] }]);
    expect(result.ok).toBe(false);
  });

  it('detects a missing/unknown dependency', () => {
    const result = topologicalSort([{ id: 'a', dependsOn: ['nonexistent'] }]);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('unknown node');
  });

  it('produces the same order for orphan (no-dependency) nodes regardless of input array order', () => {
    const r1 = topologicalSort([{ id: 'z', dependsOn: [] }, { id: 'a', dependsOn: [] }]);
    const r2 = topologicalSort([{ id: 'a', dependsOn: [] }, { id: 'z', dependsOn: [] }]);
    expect(r1.order).toEqual(r2.order);
    expect(r1.order).toEqual(['a', 'z']); // stable alphabetical tie-break
  });

  it('tolerates a duplicate dependency entry without breaking ordering', () => {
    const result = topologicalSort([
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: ['a', 'a'] },
    ]);
    expect(result.ok).toBe(true);
    expect(result.order).toEqual(['a', 'b']);
  });
});

// ── Ordering ─────────────────────────────────────────────────────────────────────────────────

describe('buildExecutionPlan: ordering', () => {
  it('preserves prerequisite -> simulate -> execute -> confirm dependency chain', () => {
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({}, context), context);
    expect(plan.dependencies['step-1-simulate']).toEqual(['step-0-prerequisite_check']);
    expect(plan.dependencies['step-2-execute']).toEqual(['step-1-simulate']);
    expect(plan.dependencies['step-3-confirm']).toEqual(['step-2-execute']);
  });

  it('identical input always produces identical order', () => {
    const context = makeContext();
    const decision = makeVerified({}, context);
    const orders = Array.from({ length: 20 }, () => buildExecutionPlan(decision, context).steps.map((s) => s.stepId).join(','));
    expect(new Set(orders).size).toBe(1);
  });
});

// ── Protocol / asset routing ─────────────────────────────────────────────────────────────────

describe('buildExecutionPlan: protocol and asset routing', () => {
  it('rejects an unsupported protocol', () => {
    const context = makeContext();
    expect(() => {
      const badDecision = { ...makeVerified({}, context) };
      // Force an out-of-policy protocol post-verification to exercise the planner's own
      // independent re-check (it must not blindly trust the verification result's decision object).
      (badDecision.decision.primaryDecision as any).protocol = 'unlisted-protocol';
      buildExecutionPlan(badDecision, context);
    }).toThrow(ExecutionPlanValidationError);
  });

  it('rejects an unsupported asset', () => {
    const context = makeContext();
    const badDecision = { ...makeVerified({}, context) };
    (badDecision.decision.primaryDecision as any).asset = 'DOGE';
    expect(() => buildExecutionPlan(badDecision, context)).toThrow(ExecutionPlanValidationError);
  });

  it('routes every step to the decision protocol/asset', () => {
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({}, context), context);
    for (const stepId of Object.keys(plan.protocolRouting)) {
      expect(plan.protocolRouting[stepId]).toBe('blend');
      expect(plan.assetRouting[stepId]).toBe('XLM');
    }
  });
});

// ── Capital checks ───────────────────────────────────────────────────────────────────────────

describe('buildExecutionPlan: capital checks', () => {
  // Realistic scenario: a decision was verified against a healthy context, but by the time it
  // reaches the planner, capital has moved (e.g. a concurrent trade spent it) — the planner must
  // independently re-check capital against whatever context it's given, never trust the
  // decision's own verification-time snapshot.
  it('rejects insufficient balance in a context that has since changed', () => {
    const healthyContext = makeContext();
    const decision = makeVerified({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.3, confidence: 0.7 } }, healthyContext);
    const depletedContext = makeContext({ capital: { ...makeAgentContext().capital, deployableCapital: 5 } });
    expect(() => buildExecutionPlan(decision, depletedContext)).toThrow(ExecutionPlanValidationError);
  });

  it('rejects a negative-balance context even if the decision itself looks fine', () => {
    const healthyContext = makeContext();
    const decision = makeVerified({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.7 } }, healthyContext);
    const negativeBalanceContext = makeContext({ capital: { ...makeAgentContext().capital, totalManagedCapital: -1 } });
    expect(() => buildExecutionPlan(decision, negativeBalanceContext)).toThrow(ExecutionPlanValidationError);
  });
});

// ── Rollback ─────────────────────────────────────────────────────────────────────────────────

describe('buildExecutionPlan: rollback strategy', () => {
  it('generates a rollback step for every execute step', () => {
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({}, context), context);
    expect(plan.rollbackStrategy).toHaveLength(1);
    expect(plan.rollbackStrategy[0].compensatesStepId).toBe('step-2-execute');
  });

  it('generates no rollback steps for a HOLD (nothing to compensate)', () => {
    const context = makeContext();
    const decision = makeVerified({ primaryDecision: { action: 'HOLD', protocol: 'blend', asset: 'XLM', allocation: 0, confidence: 0.7 } }, context);
    const plan = buildExecutionPlan(decision, context);
    expect(plan.rollbackStrategy).toHaveLength(0);
  });

  it('rollback strategy is deterministic', () => {
    const context = makeContext();
    const decision = makeVerified({}, context);
    const p1 = buildExecutionPlan(decision, context);
    const p2 = buildExecutionPlan(decision, context);
    expect(p1.rollbackStrategy).toEqual(p2.rollbackStrategy);
  });
});

// ── Simulation ───────────────────────────────────────────────────────────────────────────────

describe('buildExecutionPlan: simulation requests', () => {
  it('generates exactly one simulation request per simulate step', () => {
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({}, context), context);
    expect(plan.simulationRequests).toHaveLength(1);
    expect(plan.simulationRequests[0].stepId).toBe('step-1-simulate');
    expect(plan.simulationRequests[0].amount).toBe('0.100000');
  });
});

// ── Metadata & determinism ───────────────────────────────────────────────────────────────────

describe('buildExecutionPlan: metadata and determinism', () => {
  it('stamps version, timestamp, and a deterministic planHash', () => {
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({}, context), context);
    expect(plan.version).toEqual(expect.any(String));
    expect(plan.timestamp).toBeGreaterThan(0);
    expect(plan.metadata.planHash).toBe(plan.planHash);
  });

  it('is replayable: identical VerifiedDecision + context always -> identical planHash', () => {
    const context = makeContext();
    const decision = makeVerified({}, context);
    const p1 = buildExecutionPlan(decision, context);
    const p2 = buildExecutionPlan(decision, context);
    expect(p1.planHash).toBe(p2.planHash);
  });

  it('planHash changes when the underlying decision changes', () => {
    const context = makeContext();
    const p1 = buildExecutionPlan(makeVerified({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.7 } }, context), context);
    const p2 = buildExecutionPlan(makeVerified({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.2, confidence: 0.7 } }, context), context);
    expect(p1.planHash).not.toBe(p2.planHash);
  });

  it('is immutable (frozen) — mutation attempts throw', () => {
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({}, context), context);
    expect(() => {
      (plan as any).version = 'tampered';
    }).toThrow();
    expect(() => {
      (plan.steps as any).push({});
    }).toThrow();
  });
});

// ── Replay (500x) ────────────────────────────────────────────────────────────────────────────

describe('buildExecutionPlan: replay (500x)', () => {
  it('produces identical planHash across 500 repeated builds', () => {
    const context = makeContext();
    const decision = makeVerified({}, context);
    const hashes = new Set(Array.from({ length: 500 }, () => buildExecutionPlan(decision, context).planHash));
    expect(hashes.size).toBe(1);
  });
});

// ── Concurrency ──────────────────────────────────────────────────────────────────────────────

describe('buildExecutionPlan: concurrency', () => {
  it.each([10, 50, 100, 250])('produces consistent plans across %i "parallel" builds', (n) => {
    const context = makeContext();
    const decision = makeVerified({}, context);
    const plans = Array.from({ length: n }, () => buildExecutionPlan(decision, context));
    expect(new Set(plans.map((p) => p.planHash)).size).toBe(1);
    expect(plans.every((p) => p.steps.length === 4)).toBe(true);
  });

  it('handles concurrent builds of distinct decisions without cross-contamination', async () => {
    const context = makeContext();
    const decisions = Array.from({ length: 100 }, (_, i) =>
      makeVerified({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.01 + i / 10000, confidence: 0.7 } }, context)
    );
    const plans = await Promise.all(decisions.map((d) => Promise.resolve(buildExecutionPlan(d, context))));
    expect(new Set(plans.map((p) => p.planHash)).size).toBe(100);
  });
});

// ── Duplicate actions ────────────────────────────────────────────────────────────────────────

describe('buildExecutionPlan: duplicate actions', () => {
  it('two independently-built plans from the same decision never share an executionId', () => {
    const context = makeContext();
    const decision = makeVerified({}, context);
    const ids = new Set(Array.from({ length: 50 }, () => buildExecutionPlan(decision, context).executionId));
    expect(ids.size).toBe(50);
  });
});

// ── Performance (avg / P95 / P99 latency) ───────────────────────────────────────────────────
// Deterministic in-process timing, no external harness — same percentile technique as
// benchmarks/reasoning/metrics/aggregate.ts::percentile (sort ascending, index by ceil(p * n)).

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.ceil(p * sortedAsc.length) - 1);
  return sortedAsc[idx];
}

describe('buildExecutionPlan: performance', () => {
  it('reports average/P95/P99 latency across 500 builds and stays within a sane bound', () => {
    const context = makeContext();
    const decision = makeVerified({}, context);

    const runs = 500;
    const latenciesMs: number[] = [];
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      buildExecutionPlan(decision, context);
      latenciesMs.push(performance.now() - t0);
    }

    const sorted = [...latenciesMs].sort((a, b) => a - b);
    const avgMs = latenciesMs.reduce((sum, v) => sum + v, 0) / latenciesMs.length;
    const p95Ms = percentile(sorted, 0.95);
    const p99Ms = percentile(sorted, 0.99);

    // eslint-disable-next-line no-console
    console.log(`[executionPlanner perf] runs=${runs} avg=${avgMs.toFixed(3)}ms p95=${p95Ms.toFixed(3)}ms p99=${p99Ms.toFixed(3)}ms`);

    // Deterministic, in-memory, no network/IO — a single build should never approach 50ms on any
    // reasonable CI machine. This is a regression guard, not a precise SLO.
    expect(avgMs).toBeLessThan(50);
    expect(p99Ms).toBeLessThan(100);
  });
});
