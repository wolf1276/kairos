// Reasoning Engine Phase 4 (Decision Verification) tests. Purely deterministic — no fetch mocks,
// no LLM calls needed since this module never calls a provider. Covers valid decisions, every
// listed malformed/violation category, bypass attempts, determinism, and 10/50/100/250-way
// concurrency stress.
import { describe, it, expect, beforeEach } from 'vitest';
import { buildReasoningContext } from '../reasoning/contextBuilder.js';
import { verifyDecision, resetVerificationMetrics, getVerificationMetrics } from '../reasoning/verification/index.js';
import { hashDecisionIntelligence } from '../reasoning/decisionIntelligence/hashing.js';
import { buildCandidateDecisionMetadata } from '../reasoning/metadata.js';
import type { AgentContext } from '../agentContext/index.js';
import type { MemoryPackage } from '../memoryLayer/index.js';
import type { ReasoningContext, UserPolicy } from '../reasoning/types.js';
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
    userId: 'user-1', riskTolerance: 'medium', maxAllocationPct: 35,
    allowedProtocols: ['blend'], allowedAssets: ['XLM', 'USDC'], minConfidence: 0.6,
    objectives: ['grow capital steadily'], ...overrides,
  };
}

function makeContext(agentOverrides: Partial<AgentContext> = {}, policyOverrides: Partial<UserPolicy> = {}, memoryOverrides: Partial<MemoryPackage> = {}): ReasoningContext {
  return buildReasoningContext(makeAgentContext(agentOverrides), makeMemoryPackage(memoryOverrides), makeUserPolicy(policyOverrides));
}

function makeValidDecision(overrides: Partial<DecisionIntelligence> = {}): DecisionIntelligence {
  const metadata = buildCandidateDecisionMetadata({ providerVersion: 'test:test', buildDurationMs: 1, reasoningHash: 'x', promptHash: 'prompt-hash' });
  const decision: DecisionIntelligence = {
    decisionId: 'decision-1',
    timestamp: Date.now(),
    primaryDecision: { action: 'HOLD', protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.7 },
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
    confidence: { overall: 0.68, perSection: { primaryDecision: 0.7, alternatives: 0.6, evidence: 0.7, risk: 0.65, expectedOutcome: 0.65 } },
    summary: 'Hold current position; trend supportive but not strong enough to add.',
    metadata: { ...metadata, decisionVersion: '1.0.0', reasoningDurationMs: 1, evidenceCount: 2, alternativeCount: 2, uncertaintyScore: 0.2, promptHash: 'prompt-hash' } as unknown as DecisionIntelligence['metadata'],
    ...overrides,
  };
  const decisionHash = hashDecisionIntelligence(decision);
  return { ...decision, metadata: { ...decision.metadata, decisionHash } };
}

beforeEach(() => resetVerificationMetrics());

// ── Valid decisions ──────────────────────────────────────────────────────────────────────────

describe('verifyDecision: valid decisions', () => {
  it('verifies a well-formed, policy-compliant decision', () => {
    const context = makeContext();
    const result = verifyDecision(makeValidDecision(), context, { now: Date.now() });
    expect(result.status).toBe('verified');
    expect(result.failedRules).toEqual([]);
    expect(result.stagesRun).toHaveLength(10);
    expect(result.verificationHash).toEqual(expect.any(String));
  });

  it('produces a report with passedRules covering every stage', () => {
    const context = makeContext();
    const result = verifyDecision(makeValidDecision(), context, { now: Date.now() });
    const stagesRepresented = new Set(result.ruleResults.map((r) => r.stage));
    expect(stagesRepresented.size).toBe(10);
  });
});

// ── Malformed decisions (schema stage) ──────────────────────────────────────────────────────

describe('verifyDecision: malformed decisions', () => {
  it('rejects a decision with an invalid primary action', () => {
    const context = makeContext();
    const decision = makeValidDecision({ primaryDecision: { action: 'BUY_THE_DIP' as any, protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.7 } });
    const result = verifyDecision(decision, context, { now: Date.now() });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.rejectionStage).toBe('schema');
  });

  it('rejects a decision with invalid confidence (NaN)', () => {
    const context = makeContext();
    const decision = makeValidDecision({ confidence: { overall: NaN, perSection: { primaryDecision: 0.7, alternatives: 0.6, evidence: 0.7, risk: 0.6, expectedOutcome: 0.6 } } });
    const result = verifyDecision(decision, context, { now: Date.now() });
    expect(result.status).toBe('rejected');
  });

  it('rejects a decision with only 1 alternative', () => {
    const context = makeContext();
    const decision = makeValidDecision({ alternatives: [makeValidDecision().alternatives[0]] });
    const result = verifyDecision(decision, context, { now: Date.now() });
    expect(result.status).toBe('rejected');
  });

  it('short-circuits at the schema stage — no later-stage rules run for a malformed decision', () => {
    const context = makeContext();
    const decision = makeValidDecision({ primaryDecision: undefined as any });
    const result = verifyDecision(decision, context, { now: Date.now() });
    expect(result.status).toBe('rejected');
    expect(result.stagesRun).toEqual(['schema']);
  });
});

// ── Policy violations ────────────────────────────────────────────────────────────────────────

describe('verifyDecision: policy violations', () => {
  it('rejects an unsupported protocol', () => {
    const context = makeContext();
    const decision = makeValidDecision({ primaryDecision: { action: 'HOLD', protocol: 'unlisted-protocol', asset: 'XLM', allocation: 0.1, confidence: 0.7 } });
    const result = verifyDecision(decision, context, { now: Date.now() });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('policy.protocol_allowed');
  });

  it('rejects an unsupported asset', () => {
    const context = makeContext();
    const decision = makeValidDecision({ primaryDecision: { action: 'HOLD', protocol: 'blend', asset: 'DOGE', allocation: 0.1, confidence: 0.7 } });
    const result = verifyDecision(decision, context, { now: Date.now() });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('policy.asset_allowed');
  });

  it('rejects allocation overflow beyond the policy ceiling', () => {
    const context = makeContext({}, { maxAllocationPct: 10 });
    const decision = makeValidDecision({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.5, confidence: 0.7 } });
    const result = verifyDecision(decision, context, { now: Date.now() });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('policy.allocation_ceiling');
  });

  it('rejects confidence below the policy minimum', () => {
    const context = makeContext({}, { minConfidence: 0.9 });
    const result = verifyDecision(makeValidDecision(), context, { now: Date.now() });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('policy.min_confidence');
  });

  it('rejects a decision when delegation is not active', () => {
    const context = makeContext({ policy: { ...makeAgentContext().policy, delegationActive: false } });
    const result = verifyDecision(makeValidDecision(), context, { now: Date.now() });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('policy.delegation_permission');
  });
});

// ── Capital violations ───────────────────────────────────────────────────────────────────────

describe('verifyDecision: insufficient capital', () => {
  it('rejects a decision requesting more than deployable capital', () => {
    const context = makeContext({ capital: { ...makeAgentContext().capital, deployableCapital: 10 } });
    const decision = makeValidDecision({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.5, confidence: 0.7 } });
    const result = verifyDecision(decision, context, { now: Date.now() });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('capital.available_capital');
  });

  it('rejects a decision when capital balances are negative', () => {
    const context = makeContext({ capital: { ...makeAgentContext().capital, idleCapital: -5 } });
    const result = verifyDecision(makeValidDecision(), context, { now: Date.now() });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('capital.no_negative_balances');
  });
});

// ── Protocol ─────────────────────────────────────────────────────────────────────────────────

describe('verifyDecision: protocol restrictions', () => {
  it('rejects when protocol execution is unavailable', () => {
    const context = makeContext({ system: { ...makeAgentContext().system, protocolExecutionAvailable: false } });
    const result = verifyDecision(makeValidDecision(), context, { now: Date.now() });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('protocol.enabled');
  });

  it('rejects when requested capital exceeds the agent position limit', () => {
    const context = makeContext({ policy: { ...makeAgentContext().policy, positionLimit: { maxCapital: '50' } }, capital: { ...makeAgentContext().capital, deployableCapital: 900 } });
    const decision = makeValidDecision({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.3, confidence: 0.7 } });
    const result = verifyDecision(decision, context, { now: Date.now() });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('protocol.position_limit');
  });
});

// ── Market: stale context / stale oracle ────────────────────────────────────────────────────

describe('verifyDecision: stale market data', () => {
  it('rejects when the oracle is unhealthy', () => {
    const context = makeContext({ system: { ...makeAgentContext().system, oracleHealthy: false } });
    const result = verifyDecision(makeValidDecision(), context, { now: Date.now() });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('market.oracle_healthy');
  });

  it('rejects a stale oracle (ageSeconds beyond the freshness limit)', () => {
    const context = makeContext({ market: { ...makeAgentContext().market, oracle: { timestamp: Date.now() - 600_000, ageSeconds: 600 } } });
    const result = verifyDecision(makeValidDecision(), context, { now: Date.now() });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('market.oracle_fresh');
  });

  it('rejects a stale AgentContext (builtAt far in the past relative to the verification clock)', () => {
    const context = makeContext({ builtAt: Date.now() - 10 * 60 * 1000 });
    const result = verifyDecision(makeValidDecision(), context, { now: Date.now() });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('market.context_not_stale');
  });

  it('rejects volatility beyond the hard limit', () => {
    const context = makeContext({ features: { ...makeAgentContext().features, volatility: { atr: 0.1, volatilityPct: 90, band: 'high' } } });
    const result = verifyDecision(makeValidDecision(), context, { now: Date.now() });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('market.volatility_within_limits');
  });
});

// ── Evidence: fake evidence / broken references / duplicates ───────────────────────────────

describe('verifyDecision: evidence integrity', () => {
  it('rejects a broken evidence reference (hallucinated citation)', () => {
    const context = makeContext();
    const decision = makeValidDecision({ reasoningChain: [{ step: 'x', evidenceRefs: [99] }] });
    const result = verifyDecision(decision, context, { now: Date.now() });
    expect(result.status).toBe('rejected');
  });

  it('rejects duplicate evidence entries', () => {
    const context = makeContext();
    const dup = { type: 'market_indicator' as const, source: 's', detail: 'd', weight: 0.5 };
    const decision = makeValidDecision({ evidence: [dup, { ...dup }], reasoningChain: [{ step: 'x', evidenceRefs: [0] }] });
    const result = verifyDecision(decision, context, { now: Date.now() });
    expect(result.status).toBe('rejected');
  });
});

// ── Consistency ──────────────────────────────────────────────────────────────────────────────

describe('verifyDecision: consistency', () => {
  it('flags (rejects) a low-confidence decision paired with a large allocation', () => {
    const context = makeContext({}, { maxAllocationPct: 90 });
    const decision = makeValidDecision({
      primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.7, confidence: 0.3 },
      confidence: { overall: 0.3, perSection: { primaryDecision: 0.3, alternatives: 0.3, evidence: 0.3, risk: 0.3, expectedOutcome: 0.3 } },
    });
    const result = verifyDecision(decision, context, { now: Date.now() });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('consistency.allocation_matches_confidence');
  });

  it('flags high uncertainty paired with zero identified risks', () => {
    const context = makeContext();
    const decision = makeValidDecision({ uncertainty: { missingInformation: ['x'], conflictingEvidence: [], lowConfidenceSignals: [], score: 0.9 }, risks: [] });
    const result = verifyDecision(decision, context, { now: Date.now() });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('consistency.risk_matches_uncertainty');
  });
});

// ── Risk violations ──────────────────────────────────────────────────────────────────────────

describe('verifyDecision: risk violations', () => {
  it('rejects allocation beyond the risk-tolerance ceiling', () => {
    const context = makeContext({}, { riskTolerance: 'low', maxAllocationPct: 90 });
    const decision = makeValidDecision({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.5, confidence: 0.8 } });
    const result = verifyDecision(decision, context, { now: Date.now() });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('risk.tolerance_alignment');
  });

  it('rejects when drawdown exceeds the hard limit', () => {
    const context = makeContext({ features: { ...makeAgentContext().features, risk: { realizedPnl: 0, unrealizedPnl: 0, drawdownPct: 45, volatilityPct: 1 } } });
    const result = verifyDecision(makeValidDecision(), context, { now: Date.now() });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('risk.drawdown_limit');
  });

  it('rejects when requested capital exceeds a liquidity-safe fraction of recent volume', () => {
    const context = makeContext({ features: { ...makeAgentContext().features, liquidity: { recentVolume: 10 } }, capital: { ...makeAgentContext().capital, deployableCapital: 900 } }, { maxAllocationPct: 90, riskTolerance: 'high' });
    const decision = makeValidDecision({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.5, confidence: 0.8 } });
    const result = verifyDecision(decision, context, { now: Date.now() });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('risk.liquidity_sufficient');
  });
});

// ── Execution feasibility ────────────────────────────────────────────────────────────────────

describe('verifyDecision: execution feasibility', () => {
  it('rejects when the system is not ready to execute', () => {
    const context = makeContext({ system: { ...makeAgentContext().system, executionAvailable: false } });
    const decision = makeValidDecision({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.7 } });
    const result = verifyDecision(decision, context, { now: Date.now() });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('execution.system_ready');
  });

  it('rejects when the agent is in cooldown', () => {
    const context = makeContext({ historical: { ...makeAgentContext().historical, cooldown: { active: true, remainingSeconds: 60 } } });
    const decision = makeValidDecision({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.7 } });
    const result = verifyDecision(decision, context, { now: Date.now() });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('execution.no_cooldown');
  });

  it('HOLD bypasses execution-readiness checks entirely (no execution needed)', () => {
    const context = makeContext({ system: { ...makeAgentContext().system, executionAvailable: false } });
    const result = verifyDecision(makeValidDecision(), context, { now: Date.now() }); // makeValidDecision defaults to HOLD
    const executionRules = result.ruleResults.filter((r) => r.stage === 'execution_feasibility');
    expect(executionRules).toHaveLength(1);
    expect(executionRules[0].rule).toBe('execution.hold_no_op');
  });
});

// ── Invalid hashes ───────────────────────────────────────────────────────────────────────────

describe('verifyDecision: invalid hashes', () => {
  it('rejects a decision with a tampered decisionHash', () => {
    const context = makeContext();
    const decision = makeValidDecision();
    const tampered = { ...decision, metadata: { ...decision.metadata, decisionHash: 'not-the-real-hash' } };
    const result = verifyDecision(tampered, context, { now: Date.now() });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.rejectionStage).toBe('schema');
  });
});

// ── Security: bypass attempts ────────────────────────────────────────────────────────────────

describe('verifyDecision: bypass attempts must all fail', () => {
  it('cannot bypass policy by claiming an allowed protocol in a different case', () => {
    // This should actually PASS (case-insensitive match is intentional, matching Phase 1/3
    // behavior) — included to document the boundary is deliberate, not a bypass.
    const context = makeContext();
    const decision = makeValidDecision({ primaryDecision: { action: 'HOLD', protocol: 'BLEND', asset: 'xlm', allocation: 0.1, confidence: 0.7 } });
    const result = verifyDecision(decision, context, { now: Date.now() });
    expect(result.status).toBe('verified');
  });

  it('cannot bypass the allocation ceiling via an alternative instead of the primary decision', () => {
    const context = makeContext({}, { maxAllocationPct: 10 });
    const decision = makeValidDecision({
      primaryDecision: { action: 'HOLD', protocol: 'blend', asset: 'XLM', allocation: 0.05, confidence: 0.7 },
      alternatives: [
        { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.9, confidence: 0.5, tradeoffs: 'huge bet' },
        { action: 'WITHDRAW', protocol: 'blend', asset: 'USDC', allocation: 0.05, confidence: 0.5, tradeoffs: 'safe' },
      ],
    });
    const result = verifyDecision(decision, context, { now: Date.now() });
    // Primary decision itself is compliant, so overall status is verified — but the smuggled
    // alternative must be flagged, not silently accepted.
    expect(result.status).toBe('verified');
    expect(result.warnings.some((w) => w.includes('policy.alternatives_compliant'))).toBe(true);
  });

  it('cannot bypass evidence-reference checks by citing a negative index', () => {
    const context = makeContext();
    const decision = makeValidDecision({ reasoningChain: [{ step: 'x', evidenceRefs: [-1] }] });
    const result = verifyDecision(decision, context, { now: Date.now() });
    expect(result.status).toBe('rejected');
  });

  it('cannot bypass capital checks by requesting exactly deployable capital plus a rounding sliver', () => {
    const context = makeContext({ capital: { ...makeAgentContext().capital, totalManagedCapital: 1000, deployableCapital: 100 } }, { maxAllocationPct: 90 });
    const decision = makeValidDecision({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.11, confidence: 0.7 } }); // 110 > 100 deployable
    const result = verifyDecision(decision, context, { now: Date.now() });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('capital.available_capital');
  });

  it('cannot bypass schema validation with a re-hashed but still-invalid decision', () => {
    const context = makeContext();
    const decision = makeValidDecision({ primaryDecision: { action: 'HOLD', protocol: 'blend', asset: 'XLM', allocation: 5, confidence: 0.7 } }); // allocation out of [0,1]
    const rehashed = { ...decision, metadata: { ...decision.metadata, decisionHash: hashDecisionIntelligence(decision) } };
    const result = verifyDecision(rehashed, context, { now: Date.now() });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.rejectionStage).toBe('schema');
  });
});

// ── Determinism ──────────────────────────────────────────────────────────────────────────────

describe('verifyDecision: determinism', () => {
  it('produces byte-identical results (including verificationHash) for identical inputs', () => {
    const context = makeContext();
    const decision = makeValidDecision();
    const fixedNow = 1700000000000;
    const r1 = verifyDecision(decision, context, { now: fixedNow });
    const r2 = verifyDecision(decision, context, { now: fixedNow });
    expect(r1).toEqual(r2);
    expect(r1.verificationHash).toBe(r2.verificationHash);
  });

  it('verificationHash changes when any rule outcome would change', () => {
    const context = makeContext();
    const fixedNow = 1700000000000;
    const r1 = verifyDecision(makeValidDecision(), context, { now: fixedNow });
    const r2 = verifyDecision(makeValidDecision({ primaryDecision: { action: 'HOLD', protocol: 'blend', asset: 'DOGE', allocation: 0.1, confidence: 0.7 } }), context, { now: fixedNow });
    expect(r1.verificationHash).not.toBe(r2.verificationHash);
  });
});

// ── Concurrency stress ───────────────────────────────────────────────────────────────────────

describe('verifyDecision: concurrency', () => {
  it.each([10, 50, 100, 250])('produces identical, isolated results across %i "parallel" verification calls', (n) => {
    const context = makeContext();
    const decision = makeValidDecision();
    const fixedNow = 1700000000000;

    const results = Array.from({ length: n }, () => verifyDecision(decision, context, { now: fixedNow }));

    expect(results).toHaveLength(n);
    const hashes = new Set(results.map((r) => r.verificationHash));
    expect(hashes.size).toBe(1); // fully deterministic — every call produces the same hash
    for (const r of results) expect(r.status).toBe('verified');
  });

  it('handles 100 concurrent verifications of DIFFERENT decisions without cross-contamination', async () => {
    const context = makeContext();
    const decisions = Array.from({ length: 100 }, (_, i) =>
      makeValidDecision({ decisionId: `decision-${i}`, primaryDecision: { action: 'HOLD', protocol: 'blend', asset: 'XLM', allocation: i / 1000, confidence: 0.7 } })
    );

    const results = await Promise.all(decisions.map((d) => Promise.resolve(verifyDecision(d, context, { now: 1700000000000 }))));

    expect(results).toHaveLength(100);
    const hashes = new Set(results.map((r) => r.verificationHash));
    expect(hashes.size).toBe(100); // each distinct allocation produces a distinct hash
  });
});

// ── Metrics ──────────────────────────────────────────────────────────────────────────────────

describe('verification metrics', () => {
  it('tracks approval rate, rejection rate, and rule failure counts', () => {
    const context = makeContext();
    verifyDecision(makeValidDecision(), context, { now: Date.now() });
    verifyDecision(makeValidDecision({ primaryDecision: { action: 'HOLD', protocol: 'unlisted', asset: 'XLM', allocation: 0.1, confidence: 0.7 } }), context, { now: Date.now() });

    const metrics = getVerificationMetrics();
    expect(metrics.total).toBe(2);
    expect(metrics.approved).toBe(1);
    expect(metrics.rejected).toBe(1);
    expect(metrics.approvalRate).toBe(0.5);
    expect(metrics.rejectionRate).toBe(0.5);
    expect(metrics.ruleFailureCounts['policy.protocol_allowed']).toBe(1);
  });
});
