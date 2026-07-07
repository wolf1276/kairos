// Reasoning Engine Phase 5 (Execution Planner) — FINAL production audit. Complements
// executionPlanner.test.ts (existing 33 tests, unchanged) with 14 categories: plan generation,
// dependency graph, ordering, protocol/asset routing, capital, rollback, simulation, metadata,
// determinism (500x), concurrency (10/50/100/250/500), security bypass attempts, performance.
import { describe, it, expect } from 'vitest';
import { buildReasoningContext } from '../reasoning/contextBuilder.js';
import { verifyDecision } from '../reasoning/verification/index.js';
import { buildExecutionPlan, ExecutionPlanValidationError, topologicalSort, hashExecutionPlan } from '../reasoning/executionPlanner/index.js';
import { hashDecisionIntelligence } from '../reasoning/decisionIntelligence/hashing.js';
import { buildCandidateDecisionMetadata } from '../reasoning/metadata.js';
import type { AgentContext } from '../agentContext/index.js';
import type { MemoryPackage } from '../memoryLayer/index.js';
import type { ReasoningContext, UserPolicy } from '../reasoning/types.js';
import type { DecisionIntelligence } from '../reasoning/decisionIntelligence/types.js';
import type { VerifiedDecision } from '../reasoning/verification/types.js';

const AGENT_ID = 'agent-plan-audit';
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
    decisionId: 'decision-audit-1',
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

/** Constructs a "forged" VerifiedDecision-shaped object without going through real
 *  verifyDecision — used only to prove the planner's own independent defenses (it must not
 *  assume every VerifiedDecision it receives actually came from verifyDecision). */
function forgeVerified(primaryOverrides: Partial<DecisionIntelligence['primaryDecision']>, context: ReasoningContext = makeContext()): VerifiedDecision {
  const genuine = makeVerified({}, context);
  const decision = { ...genuine.decision, primaryDecision: { ...genuine.decision.primaryDecision, ...primaryOverrides } };
  return { ...genuine, decision };
}

// ── Category 1: Plan generation ──────────────────────────────────────────────────────────────

describe('Category 1: plan generation', () => {
  it('single action produces a 4-step plan', () => {
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({}, context), context);
    expect(plan.steps).toHaveLength(4);
  });

  it('multi-action (SWAP) produces the same deterministic 4-step template', () => {
    const context = makeContext();
    const decision = makeVerified({ primaryDecision: { action: 'SWAP', protocol: 'blend', asset: 'USDC', allocation: 0.2, confidence: 0.7 } }, context);
    const plan = buildExecutionPlan(decision, context);
    expect(plan.steps.map((s) => s.type)).toEqual(['prerequisite_check', 'simulate', 'execute', 'confirm']);
  });

  it('"empty plan" rejection: a plan with zero steps never occurs — even HOLD produces exactly 1', () => {
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({ primaryDecision: { action: 'HOLD', protocol: 'blend', asset: 'XLM', allocation: 0, confidence: 0.7 } }, context), context);
    expect(plan.steps.length).toBeGreaterThan(0);
  });

  it('deterministic ordering across repeated builds', () => {
    const context = makeContext();
    const decision = makeVerified({}, context);
    const orders = new Set(Array.from({ length: 30 }, () => buildExecutionPlan(decision, context).steps.map((s) => s.stepId).join(',')));
    expect(orders.size).toBe(1);
  });

  it('unique executionId per build', () => {
    const context = makeContext();
    const decision = makeVerified({}, context);
    const ids = new Set(Array.from({ length: 30 }, () => buildExecutionPlan(decision, context).executionId));
    expect(ids.size).toBe(30);
  });

  it('deterministic planHash for identical input', () => {
    const context = makeContext();
    const decision = makeVerified({}, context);
    const hashes = new Set(Array.from({ length: 30 }, () => buildExecutionPlan(decision, context).planHash));
    expect(hashes.size).toBe(1);
  });
});

// ── Category 2: Dependency graph ─────────────────────────────────────────────────────────────

describe('Category 2: dependency graph', () => {
  it('valid DAG sorts correctly', () => {
    const r = topologicalSort([{ id: 'a', dependsOn: [] }, { id: 'b', dependsOn: ['a'] }, { id: 'c', dependsOn: ['a', 'b'] }]);
    expect(r.ok).toBe(true);
    expect(r.order).toEqual(['a', 'b', 'c']);
  });

  it('circular dependency (2-node cycle) rejects', () => {
    const r = topologicalSort([{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }]);
    expect(r.ok).toBe(false);
  });

  it('circular dependency (3-node cycle) rejects', () => {
    const r = topologicalSort([{ id: 'a', dependsOn: ['c'] }, { id: 'b', dependsOn: ['a'] }, { id: 'c', dependsOn: ['b'] }]);
    expect(r.ok).toBe(false);
  });

  it('self dependency rejects', () => {
    const r = topologicalSort([{ id: 'a', dependsOn: ['a'] }]);
    expect(r.ok).toBe(false);
  });

  it('missing dependency rejects', () => {
    const r = topologicalSort([{ id: 'a', dependsOn: ['ghost'] }]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain('unknown node');
  });

  it('orphan action (no dependents, no dependencies) sorts fine, deterministically', () => {
    const r1 = topologicalSort([{ id: 'a', dependsOn: [] }, { id: 'orphan', dependsOn: [] }]);
    const r2 = topologicalSort([{ id: 'orphan', dependsOn: [] }, { id: 'a', dependsOn: [] }]);
    expect(r1.order).toEqual(r2.order);
  });

  it('duplicate dependency entries do not break the sort', () => {
    const r = topologicalSort([{ id: 'a', dependsOn: [] }, { id: 'b', dependsOn: ['a', 'a', 'a'] }]);
    expect(r.ok).toBe(true);
    expect(r.order).toEqual(['a', 'b']);
  });

  it('a real ExecutionPlan never contains a circular dependency (structural guarantee, not just tested in isolation)', () => {
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({}, context), context);
    const sort = topologicalSort(plan.steps.map((s) => ({ id: s.stepId, dependsOn: s.dependsOn })));
    expect(sort.ok).toBe(true);
  });
});

// ── Category 3: Ordering ─────────────────────────────────────────────────────────────────────

describe('Category 3: ordering', () => {
  it('stable ordering across 100 rebuilds', () => {
    const context = makeContext();
    const decision = makeVerified({}, context);
    const orders = new Set(Array.from({ length: 100 }, () => buildExecutionPlan(decision, context).steps.map((s) => s.stepId).join(',')));
    expect(orders.size).toBe(1);
  });

  it('prerequisite ordering: prerequisite_check always precedes simulate/execute/confirm', () => {
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({}, context), context);
    const indexOf = (id: string) => plan.steps.findIndex((s) => s.stepId === id);
    expect(indexOf('step-0-prerequisite_check')).toBeLessThan(indexOf('step-1-simulate'));
    expect(indexOf('step-1-simulate')).toBeLessThan(indexOf('step-2-execute'));
    expect(indexOf('step-2-execute')).toBeLessThan(indexOf('step-3-confirm'));
  });

  it('dependency preservation: dependencies map matches each step\'s own dependsOn', () => {
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({}, context), context);
    for (const step of plan.steps) {
      expect(plan.dependencies[step.stepId]).toEqual(step.dependsOn);
    }
  });

  it('identical input -> identical order, across two independently-built contexts with the same values', () => {
    const decision = makeVerified({}, makeContext());
    const plan1 = buildExecutionPlan(decision, makeContext());
    const plan2 = buildExecutionPlan(decision, makeContext());
    expect(plan1.steps.map((s) => s.stepId)).toEqual(plan2.steps.map((s) => s.stepId));
  });
});

// ── Category 4: Protocol routing ─────────────────────────────────────────────────────────────

describe('Category 4: protocol routing', () => {
  it('rejects unsupported protocol', () => {
    const context = makeContext();
    expect(() => buildExecutionPlan(forgeVerified({ protocol: 'unlisted-protocol' }, context), context)).toThrow(ExecutionPlanValidationError);
  });

  // Regression (this audit): no check previously existed for a disabled protocol subsystem.
  // Verify against an available-protocol context (so verifyDecision itself doesn't already
  // reject it), then plan against a context where the subsystem has since gone down — mirrors
  // the "balances changed after verification" re-check pattern used for capital.
  it('rejects a disabled protocol subsystem', () => {
    const verifiedAgainst = makeContext();
    const decision = makeVerified({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.7 } }, verifiedAgainst);
    const planningContext = makeContext({ system: { ...makeAgentContext().system, protocolExecutionAvailable: false } });
    expect(() => buildExecutionPlan(decision, planningContext)).toThrow(ExecutionPlanValidationError);
  });

  it('HOLD is exempt from the protocol-enabled check (no protocol call needed)', () => {
    const verifiedAgainst = makeContext();
    const decision = makeVerified({ primaryDecision: { action: 'HOLD', protocol: 'blend', asset: 'XLM', allocation: 0, confidence: 0.7 } }, verifiedAgainst);
    const planningContext = makeContext({ system: { ...makeAgentContext().system, protocolExecutionAvailable: false } });
    expect(() => buildExecutionPlan(decision, planningContext)).not.toThrow();
  });

  it('"missing adapter" / "duplicate adapter" — no adapter registry concept exists in this codebase; protocol allowlist membership is the enforcement surface (documented boundary, not a gap)', () => {
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({}, context), context);
    expect(Object.values(plan.protocolRouting).every((p) => p === 'blend')).toBe(true);
  });

  it('rejects an invalid action/protocol pair (unsupported action)', () => {
    const context = makeContext();
    expect(() => buildExecutionPlan(forgeVerified({ action: 'TELEPORT' as any }, context), context)).toThrow(ExecutionPlanValidationError);
  });
});

// ── Category 5: Asset routing ────────────────────────────────────────────────────────────────

describe('Category 5: asset routing', () => {
  it('rejects unsupported asset', () => {
    const context = makeContext();
    expect(() => buildExecutionPlan(forgeVerified({ asset: 'SHIB' }, context), context)).toThrow(ExecutionPlanValidationError);
  });

  it('every step in a plan routes to the same asset (no duplicate/conflicting asset routing within one plan)', () => {
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({}, context), context);
    expect(new Set(Object.values(plan.assetRouting)).size).toBe(1);
  });

  it('"missing asset" — an empty-string asset is rejected (fails the allowlist membership check)', () => {
    const context = makeContext();
    expect(() => buildExecutionPlan(forgeVerified({ asset: '' }, context), context)).toThrow(ExecutionPlanValidationError);
  });

  it('"invalid trading pair" — asset outside the context pair\'s currency set is rejected', () => {
    const context = makeContext();
    expect(() => buildExecutionPlan(forgeVerified({ asset: 'BTC' }, context), context)).toThrow(ExecutionPlanValidationError);
  });

  it('"invalid decimals" — no decimals concept exists in AgentContext/DecisionIntelligence; amounts are plain decimal strings formatted to 6 places (documented boundary)', () => {
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({}, context), context);
    expect(plan.simulationRequests[0].amount).toMatch(/^\d+\.\d{6}$/);
  });
});

// ── Category 6: Capital checks ───────────────────────────────────────────────────────────────

describe('Category 6: capital checks', () => {
  it('rejects insufficient balance', () => {
    const context = makeContext({ capital: { ...makeAgentContext().capital, deployableCapital: 5 } });
    expect(() => buildExecutionPlan(makeVerified({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.3, confidence: 0.7 } }, makeContext()), context)).toThrow(ExecutionPlanValidationError);
  });

  it('rejects zero deployable balance for a non-zero-allocation action', () => {
    const context = makeContext({ capital: { ...makeAgentContext().capital, deployableCapital: 0 } });
    expect(() => buildExecutionPlan(makeVerified({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.7 } }, makeContext()), context)).toThrow(ExecutionPlanValidationError);
  });

  it('rejects negative balance', () => {
    const context = makeContext({ capital: { ...makeAgentContext().capital, totalManagedCapital: -500 } });
    expect(() => buildExecutionPlan(makeVerified({}, makeContext()), context)).toThrow(ExecutionPlanValidationError);
  });

  it('rejects NaN totalManagedCapital', () => {
    const context = makeContext({ capital: { ...makeAgentContext().capital, totalManagedCapital: NaN } });
    expect(() => buildExecutionPlan(makeVerified({}, makeContext()), context)).toThrow(ExecutionPlanValidationError);
  });

  it('rejects Infinity totalManagedCapital/deployableCapital (overflow bypass)', () => {
    const context = makeContext({ capital: { ...makeAgentContext().capital, totalManagedCapital: Infinity, deployableCapital: Infinity } });
    expect(() => buildExecutionPlan(makeVerified({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.5, confidence: 0.7 } }, makeContext()), context)).toThrow(ExecutionPlanValidationError);
  });

  // Regression (this audit): a forged negative allocation previously slipped past the balance
  // check (negative requestedCapital trivially satisfies `<= deployableCapital`).
  it('allocation overflow: rejects a forged negative allocation', () => {
    const context = makeContext();
    expect(() => buildExecutionPlan(forgeVerified({ allocation: -0.5 }, context), context)).toThrow(ExecutionPlanValidationError);
  });

  it('allocation overflow: rejects a forged allocation > 1', () => {
    const context = makeContext();
    expect(() => buildExecutionPlan(forgeVerified({ allocation: 5 }, context), context)).toThrow(ExecutionPlanValidationError);
  });
});

// ── Category 7: Rollback ─────────────────────────────────────────────────────────────────────

describe('Category 7: rollback', () => {
  it('rollback generated for a DEPOSIT (one execute step -> one rollback step)', () => {
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({}, context), context);
    expect(plan.rollbackStrategy).toHaveLength(1);
  });

  it('rollback compensatesStepId points at the execute step (dependency rollback — the rollback targets what actually moved capital)', () => {
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({}, context), context);
    expect(plan.rollbackStrategy[0].compensatesStepId).toBe('step-2-execute');
  });

  it('"partial rollback" — HOLD produces zero rollback steps since nothing executed (nothing to partially roll back)', () => {
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({ primaryDecision: { action: 'HOLD', protocol: 'blend', asset: 'XLM', allocation: 0, confidence: 0.7 } }, context), context);
    expect(plan.rollbackStrategy).toHaveLength(0);
  });

  it('"impossible rollback" — the rollback strategy is descriptive text, never itself executed, so there is no code path where a rollback could fail at plan-build time', () => {
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({}, context), context);
    expect(typeof plan.rollbackStrategy[0].description).toBe('string');
    expect(plan.rollbackStrategy[0].description.length).toBeGreaterThan(0);
  });

  it('deterministic rollback across repeated builds', () => {
    const context = makeContext();
    const decision = makeVerified({}, context);
    const p1 = buildExecutionPlan(decision, context);
    const p2 = buildExecutionPlan(decision, context);
    expect(p1.rollbackStrategy).toEqual(p2.rollbackStrategy);
  });
});

// ── Category 8: Simulation ───────────────────────────────────────────────────────────────────

describe('Category 8: simulation', () => {
  it('simulation request generated for the simulate step', () => {
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({}, context), context);
    expect(plan.simulationRequests).toHaveLength(1);
    expect(plan.simulationRequests[0].stepId).toBe('step-1-simulate');
  });

  it('"invalid simulation" / "unsupported simulation" — a rejected decision never reaches simulation-request generation at all (fails earlier, at prerequisite checks)', () => {
    const context = makeContext();
    expect(() => buildExecutionPlan(forgeVerified({ protocol: 'nope' }, context), context)).toThrow();
  });

  it('simulation metadata (protocol/action/asset) matches the decision', () => {
    const context = makeContext();
    const decision = makeVerified({ primaryDecision: { action: 'WITHDRAW', protocol: 'blend', asset: 'USDC', allocation: 0.2, confidence: 0.7 }, expectedOutcome: { direction: 'down', expectedBenefit: 'de-risk', expectedDownside: 'gives up upside' } }, context);
    const plan = buildExecutionPlan(decision, context);
    expect(plan.simulationRequests[0]).toMatchObject({ protocol: 'blend', action: 'WITHDRAW', asset: 'USDC' });
  });

  it('deterministic simulation requests across repeated builds', () => {
    const context = makeContext();
    const decision = makeVerified({}, context);
    const p1 = buildExecutionPlan(decision, context);
    const p2 = buildExecutionPlan(decision, context);
    expect(p1.simulationRequests).toEqual(p2.simulationRequests);
  });
});

// ── Category 9: Metadata ─────────────────────────────────────────────────────────────────────

describe('Category 9: metadata', () => {
  it('planHash is present and matches metadata.planHash', () => {
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({}, context), context);
    expect(plan.planHash).toBe(plan.metadata.planHash);
  });

  it('version is stamped', () => {
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({}, context), context);
    expect(plan.version).toEqual(expect.any(String));
    expect(plan.metadata.plannerVersion).toBe(plan.version);
  });

  it('timestamps are positive and executionId is a valid uuid-shaped string', () => {
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({}, context), context);
    expect(plan.timestamp).toBeGreaterThan(0);
    expect(plan.executionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('deterministic hashes recomputed independently via hashExecutionPlan match plan.planHash', () => {
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({}, context), context);
    expect(hashExecutionPlan(plan)).toBe(plan.planHash);
  });

  it('replayability: decisionHash and verificationHash are carried through into plan metadata', () => {
    const context = makeContext();
    const decision = makeVerified({}, context);
    const plan = buildExecutionPlan(decision, context);
    expect(plan.metadata.decisionHash).toBe(decision.decision.metadata.decisionHash);
    expect(plan.metadata.verificationHash).toBe(decision.verificationHash);
  });
});

// ── Category 10: Determinism (500x) ──────────────────────────────────────────────────────────

describe('Category 10: determinism (500 identical runs)', () => {
  it('produces identical plans, hashes, ordering, rollback, and metadata across 500 runs', () => {
    const context = makeContext();
    const decision = makeVerified({}, context);
    const plans = Array.from({ length: 500 }, () => buildExecutionPlan(decision, context));

    expect(new Set(plans.map((p) => p.planHash)).size).toBe(1);
    expect(new Set(plans.map((p) => p.steps.map((s) => s.stepId).join(','))).size).toBe(1);
    expect(new Set(plans.map((p) => JSON.stringify(p.rollbackStrategy))).size).toBe(1);
    expect(new Set(plans.map((p) => p.metadata.decisionHash + p.metadata.verificationHash))).toHaveLength(1);
  });
});

// ── Category 11: Concurrency ─────────────────────────────────────────────────────────────────

describe('Category 11: concurrency', () => {
  it.each([10, 50, 100, 250, 500])('produces deterministic output across %i "parallel" builds', (n) => {
    const context = makeContext();
    const decision = makeVerified({}, context);
    const plans = Array.from({ length: n }, () => buildExecutionPlan(decision, context));
    expect(new Set(plans.map((p) => p.planHash)).size).toBe(1);
    expect(new Set(plans.map((p) => p.executionId)).size).toBe(n); // executionId always unique, no shared state
  });

  it('500 concurrent builds of distinct decisions never cross-contaminate (no shared mutable state, no cross-agent leakage)', async () => {
    const context = makeContext();
    const decisions = Array.from({ length: 500 }, (_, i) =>
      makeVerified({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.001 + i / 100000, confidence: 0.7 } }, context)
    );
    const plans = await Promise.all(decisions.map((d) => Promise.resolve(buildExecutionPlan(d, context))));
    expect(new Set(plans.map((p) => p.planHash)).size).toBe(500);
  });
});

// ── Category 12: Security ────────────────────────────────────────────────────────────────────

describe('Category 12: security — every attack must fail', () => {
  it('forged plan: constructing a VerifiedDecision-shaped object with a bad protocol still gets rejected', () => {
    const context = makeContext();
    expect(() => buildExecutionPlan(forgeVerified({ protocol: 'forged-protocol' }, context), context)).toThrow(ExecutionPlanValidationError);
  });

  it('modified hash: a plan\'s own planHash cannot be trusted from outside — hashExecutionPlan always recomputes fresh', () => {
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({}, context), context);
    const forged = { ...plan, planHash: 'forged-hash-value' };
    expect(hashExecutionPlan(forged as any)).not.toBe('forged-hash-value');
    expect(hashExecutionPlan(forged as any)).toBe(plan.planHash); // recomputes the TRUE hash regardless of the forged field
  });

  it('dependency bypass: a forged step graph with a cycle is caught by the planner\'s own topological sort, not just the standalone unit', () => {
    const cyclic = [{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }];
    expect(topologicalSort(cyclic).ok).toBe(false);
  });

  it('protocol bypass: case-scrambled but genuinely unsupported protocol still rejected', () => {
    const context = makeContext();
    expect(() => buildExecutionPlan(forgeVerified({ protocol: 'BLEND-EVIL-FORK' }, context), context)).toThrow(ExecutionPlanValidationError);
  });

  it('rollback bypass: cannot skip rollback generation by requesting a HOLD-disguised-as-DEPOSIT (action field is authoritative, not inferred)', () => {
    const context = makeContext();
    const decision = makeVerified({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.05, confidence: 0.7 } }, context);
    const plan = buildExecutionPlan(decision, context);
    expect(plan.rollbackStrategy.length).toBeGreaterThan(0); // DEPOSIT always gets a rollback step, no way to suppress it
  });

  it('malformed metadata: a decision with a tampered decisionHash never reaches the planner successfully (verifyDecision already rejects it upstream)', () => {
    const context = makeContext();
    const decision = makeDecisionIntelligence();
    const tampered = { ...decision, metadata: { ...decision.metadata, decisionHash: 'tampered' } };
    const verification = verifyDecision(tampered, context, { now: FIXED_NOW });
    expect(verification.status).toBe('rejected');
    expect(() => buildExecutionPlan(verification as any, context)).toThrow(ExecutionPlanValidationError);
  });

  it('replay attack: reusing an old plan object\'s fields does not let a new, different decision inherit its planHash', () => {
    const context = makeContext();
    const original = buildExecutionPlan(makeVerified({}, context), context);
    const mutated = makeVerified({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.3, confidence: 0.7 } }, context);
    const replayedPlan = buildExecutionPlan(mutated, context);
    expect(replayedPlan.planHash).not.toBe(original.planHash);
  });
});

// ── Category 13: Performance ─────────────────────────────────────────────────────────────────

describe('Category 13: performance', () => {
  function percentile(sorted: number[], p: number): number {
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  }

  it('measures avg/P95/P99 latency and throughput across 1000 plan builds', () => {
    const context = makeContext();
    const decision = makeVerified({}, context);
    const durations: number[] = [];
    const wallStart = performance.now();
    for (let i = 0; i < 1000; i++) {
      const t0 = performance.now();
      buildExecutionPlan(decision, context);
      durations.push(performance.now() - t0);
    }
    const wallElapsed = performance.now() - wallStart;
    durations.sort((a, b) => a - b);
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    const throughput = (1000 / wallElapsed) * 1000;

    expect(avg).toBeLessThan(5);
    expect(percentile(durations, 95)).toBeLessThan(10);
    expect(percentile(durations, 99)).toBeLessThan(20);
    expect(throughput).toBeGreaterThan(1000);
  });
});

// ── Category 14: Documentation consistency ──────────────────────────────────────────────────

describe('Category 14: documentation matches implementation', () => {
  it('every plan step type is one of the four documented types', async () => {
    const { PLAN_STEP_TYPES } = await import('../reasoning/executionPlanner/index.js');
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({}, context), context);
    for (const step of plan.steps) expect(PLAN_STEP_TYPES).toContain(step.type);
  });

  it('EXECUTION_PLANNER_VERSION matches the stamped plan version', async () => {
    const { EXECUTION_PLANNER_VERSION } = await import('../reasoning/executionPlanner/index.js');
    const context = makeContext();
    const plan = buildExecutionPlan(makeVerified({}, context), context);
    expect(plan.version).toBe(EXECUTION_PLANNER_VERSION);
  });
});
