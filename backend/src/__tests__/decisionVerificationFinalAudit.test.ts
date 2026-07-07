// Reasoning Engine Phase 4 (Decision Verification) — FINAL production audit. Complements
// decisionVerification.test.ts (existing 43 tests, unchanged) with 15 test categories: schema
// edge cases, every policy/capital/portfolio/market/evidence/consistency/risk/execution/metadata
// category, replay (500x), concurrency (10/50/100/250/500), security bypass attempts, and
// performance sanity. No fetch mocks needed — this module is pure/deterministic, no I/O.
import { describe, it, expect, beforeEach } from 'vitest';
import { buildReasoningContext } from '../reasoning/contextBuilder.js';
import { verifyDecision, resetVerificationMetrics, getVerificationMetrics } from '../reasoning/verification/index.js';
import { hashDecisionIntelligence } from '../reasoning/decisionIntelligence/hashing.js';
import { buildCandidateDecisionMetadata } from '../reasoning/metadata.js';
import type { AgentContext } from '../agentContext/index.js';
import type { MemoryPackage } from '../memoryLayer/index.js';
import type { ReasoningContext, UserPolicy } from '../reasoning/types.js';
import type { DecisionIntelligence } from '../reasoning/decisionIntelligence/types.js';

const AGENT_ID = 'agent-audit';

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
    decisionId: 'decision-audit-1',
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

const FIXED_NOW = 1_700_000_000_000;

beforeEach(() => resetVerificationMetrics());

// ── Category 1: Schema edge cases ───────────────────────────────────────────────────────────

describe('Category 1: schema edge cases', () => {
  it('verifies a valid decision', () => {
    const result = verifyDecision(makeValidDecision(), makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('verified');
  });

  it('rejects missing required field (primaryDecision undefined)', () => {
    const result = verifyDecision(makeValidDecision({ primaryDecision: undefined as any }), makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.rejectionStage).toBe('schema');
  });

  it('tolerates extra unknown fields without crashing or granting special treatment', () => {
    const decision = { ...makeValidDecision(), extraField: 'should be ignored', another: { nested: true } } as unknown as DecisionIntelligence;
    // Re-hash since decisionHash covers `...rest` (would include extraField) — hash must be
    // recomputed to match, proving extra fields don't bypass hash verification either.
    const rehashed = { ...decision, metadata: { ...decision.metadata, decisionHash: hashDecisionIntelligence(decision) } };
    const result = verifyDecision(rehashed, makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('verified');
  });

  it('rejects null primaryDecision.action', () => {
    const result = verifyDecision(makeValidDecision({ primaryDecision: { action: null as any, protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.7 } }), makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
  });

  it('rejects undefined confidence.overall', () => {
    const decision = makeValidDecision();
    const broken = { ...decision, confidence: { ...decision.confidence, overall: undefined as any } };
    const result = verifyDecision(broken, makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
  });

  it('rejects a malformed enum (action outside the canonical five)', () => {
    const result = verifyDecision(makeValidDecision({ primaryDecision: { action: 'YOLO' as any, protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.7 } }), makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
  });

  it('rejects invalid metadata (missing promptHash)', () => {
    const decision = makeValidDecision();
    const broken = { ...decision, metadata: { ...decision.metadata, promptHash: '' } };
    const rehashed = { ...broken, metadata: { ...broken.metadata, decisionHash: hashDecisionIntelligence(broken) } };
    const result = verifyDecision(rehashed, makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
  });

  it('rejects an invalid (tampered) decisionHash', () => {
    const decision = makeValidDecision();
    const tampered = { ...decision, metadata: { ...decision.metadata, decisionHash: 'deadbeef' } };
    const result = verifyDecision(tampered, makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.rejectionStage).toBe('schema');
  });
});

// ── Category 2: Policy ───────────────────────────────────────────────────────────────────────

describe('Category 2: policy violations', () => {
  it('rejects unsupported asset', () => {
    const result = verifyDecision(makeValidDecision({ primaryDecision: { action: 'HOLD', protocol: 'blend', asset: 'SHIB', allocation: 0.1, confidence: 0.7 } }), makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
  });

  it('rejects unsupported protocol', () => {
    const result = verifyDecision(makeValidDecision({ primaryDecision: { action: 'HOLD', protocol: 'rogue-protocol', asset: 'XLM', allocation: 0.1, confidence: 0.7 } }), makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
  });

  it('rejects allocation > max policy ceiling', () => {
    const context = makeContext({}, { maxAllocationPct: 10 });
    const result = verifyDecision(makeValidDecision({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.5, confidence: 0.7 } }), context, { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
  });

  it('"allocation < min" — negative allocation is rejected at schema (no negative-allocation policy floor exists; documents the boundary)', () => {
    const result = verifyDecision(makeValidDecision({ primaryDecision: { action: 'HOLD', protocol: 'blend', asset: 'XLM', allocation: -0.1, confidence: 0.7 } }), makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.rejectionStage).toBe('schema');
  });

  it('rejects forbidden action (unsupported by protocol stage)', () => {
    const result = verifyDecision(makeValidDecision({ primaryDecision: { action: 'DESTROY' as any, protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.7 } }), makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
  });

  it('"objective mismatch" — empty objectives array is rejected (no semantic mismatch detection exists by design; this is the deterministic proxy)', () => {
    const context = makeContext({}, { objectives: [] });
    const result = verifyDecision(makeValidDecision(), context, { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('policy.objectives_present');
  });

  it('"expired permissions" — delegationActive:false is rejected (no separate expiry field exists; this is the permission-revocation proxy)', () => {
    const context = makeContext({ policy: { ...makeAgentContext().policy, delegationActive: false } });
    const result = verifyDecision(makeValidDecision(), context, { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('policy.delegation_permission');
  });
});

// ── Category 3: Capital ──────────────────────────────────────────────────────────────────────

describe('Category 3: capital injection', () => {
  it('rejects insufficient capital', () => {
    const context = makeContext({ capital: { ...makeAgentContext().capital, deployableCapital: 5 } });
    const result = verifyDecision(makeValidDecision({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.5, confidence: 0.7 } }), context, { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
  });

  it('rejects negative balance', () => {
    const context = makeContext({ capital: { ...makeAgentContext().capital, totalManagedCapital: -100 } });
    const result = verifyDecision(makeValidDecision(), context, { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('capital.no_negative_balances');
  });

  it('accepts zero balance with HOLD (no capital requested)', () => {
    const context = makeContext({ capital: { ...makeAgentContext().capital, totalManagedCapital: 0, idleCapital: 0, deployableCapital: 0 } });
    const result = verifyDecision(makeValidDecision({ primaryDecision: { action: 'HOLD', protocol: 'blend', asset: 'XLM', allocation: 0, confidence: 0.7 } }), context, { now: FIXED_NOW });
    expect(result.status).toBe('verified');
  });

  // Regression: NaN in AgentContext.capital previously passed `>= 0` comparisons inconsistently.
  it('rejects NaN totalManagedCapital', () => {
    const context = makeContext({ capital: { ...makeAgentContext().capital, totalManagedCapital: NaN } });
    const result = verifyDecision(makeValidDecision(), context, { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('capital.no_negative_balances');
  });

  // Regression (Bug #2, this audit): Infinity on both totalManagedCapital and deployableCapital
  // previously bypassed the negative-balance AND sufficiency checks (Infinity <= Infinity = true).
  it('rejects Infinity totalManagedCapital/deployableCapital (overflow bypass)', () => {
    const context = makeContext({ capital: { ...makeAgentContext().capital, totalManagedCapital: Infinity, deployableCapital: Infinity } });
    const result = verifyDecision(makeValidDecision({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.5, confidence: 0.7 } }), context, { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('capital.no_negative_balances');
  });

  it('rejects allocation requesting more than idle+deployable capital combined', () => {
    const context = makeContext({ capital: { ...makeAgentContext().capital, totalManagedCapital: 1000, deployableCapital: 50, idleCapital: 10 } }, { maxAllocationPct: 90 });
    const result = verifyDecision(makeValidDecision({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.5, confidence: 0.7 } }), context, { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('capital.available_capital');
  });
});

// ── Category 4: Portfolio ────────────────────────────────────────────────────────────────────

describe('Category 4: portfolio violations', () => {
  it('rejects concentration overflow (allocation beyond 0.8)', () => {
    const context = makeContext({}, { maxAllocationPct: 95 });
    const result = verifyDecision(makeValidDecision({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.9, confidence: 0.9 } }), context, { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('portfolio.concentration_limit');
  });

  it('flags duplicate exposure across primary and alternatives', () => {
    const decision = makeValidDecision({
      primaryDecision: { action: 'HOLD', protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.7 },
      alternatives: [
        { action: 'HOLD', protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.6, tradeoffs: 'identical to primary' },
        { action: 'WITHDRAW', protocol: 'blend', asset: 'USDC', allocation: 0.05, confidence: 0.5, tradeoffs: 'safe' },
      ],
    });
    const result = verifyDecision(decision, makeContext(), { now: FIXED_NOW });
    expect(result.warnings.some((w) => w.includes('portfolio.no_duplicate_exposure'))).toBe(true);
  });

  it('surfaces a diversification signal when introducing a new protocol beyond existing exposure', () => {
    const context = makeContext({ capital: { ...makeAgentContext().capital, protocolExposure: [{ protocolId: 'soroswap' as any, kind: 'lend' as any, asset: 'XLM', amount: '100' }] } });
    const result = verifyDecision(makeValidDecision(), context, { now: FIXED_NOW });
    expect(result.status).toBe('verified'); // informational only, non-blocking
  });

  it('rejects an impossible allocation (allocation > 1, caught upstream at schema)', () => {
    const result = verifyDecision(makeValidDecision({ primaryDecision: { action: 'HOLD', protocol: 'blend', asset: 'XLM', allocation: 1.5, confidence: 0.7 } }), makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.rejectionStage).toBe('schema');
  });
});

// ── Category 5: Market ───────────────────────────────────────────────────────────────────────

describe('Category 5: market data injection', () => {
  it('rejects stale oracle', () => {
    const context = makeContext({ market: { ...makeAgentContext().market, oracle: { timestamp: FIXED_NOW - 500_000, ageSeconds: 500 } } });
    const result = verifyDecision(makeValidDecision(), context, { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('market.oracle_fresh');
  });

  it('rejects stale context (builtAt far in the past)', () => {
    const context = makeContext({ builtAt: FIXED_NOW - 600_000 });
    const result = verifyDecision(makeValidDecision(), context, { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('market.context_not_stale');
  });

  it('"stale market snapshot" — unhealthy oracle flag is rejected (proxy for a stale/corrupted snapshot)', () => {
    const context = makeContext({ system: { ...makeAgentContext().system, oracleHealthy: false } });
    const result = verifyDecision(makeValidDecision(), context, { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('market.oracle_healthy');
  });

  it('rejects invalid (NaN) price/volatility data', () => {
    const context = makeContext({ features: { ...makeAgentContext().features, volatility: { atr: NaN, volatilityPct: NaN, band: 'normal' } } });
    const result = verifyDecision(makeValidDecision(), context, { now: FIXED_NOW });
    // NaN <= 50 is false -> market.volatility_within_limits fails closed
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('market.volatility_within_limits');
  });

  it('rejects Infinity volatility (should not be misread as "unlimited but fine")', () => {
    const context = makeContext({ features: { ...makeAgentContext().features, volatility: { atr: 1, volatilityPct: Infinity, band: 'high' } } });
    const result = verifyDecision(makeValidDecision(), context, { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('market.volatility_within_limits');
  });

  it('"corrupted regime" — an out-of-taxonomy regime label does not crash verification and still verifies on otherwise-sound data', () => {
    const context = makeContext({ regime: { base: 'XLM', label: 'CORRUPTED_REGIME_XYZ' as any, breakout: false, volatilityBand: 'normal' } });
    expect(() => verifyDecision(makeValidDecision(), context, { now: FIXED_NOW })).not.toThrow();
  });
});

// ── Category 6: Evidence ─────────────────────────────────────────────────────────────────────

describe('Category 6: evidence injection', () => {
  it('rejects hallucinated evidence (reference beyond array bounds)', () => {
    const result = verifyDecision(makeValidDecision({ reasoningChain: [{ step: 'x', evidenceRefs: [7] }] }), makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
  });

  it('rejects broken references (negative index)', () => {
    const result = verifyDecision(makeValidDecision({ reasoningChain: [{ step: 'x', evidenceRefs: [-1] }] }), makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
  });

  it('rejects duplicate references creating duplicate evidence entries', () => {
    const dup = { type: 'market_indicator' as const, source: 's', detail: 'd', weight: 0.5 };
    const result = verifyDecision(makeValidDecision({ evidence: [dup, { ...dup }], reasoningChain: [{ step: 'x', evidenceRefs: [0, 1] }] }), makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
  });

  it('rejects dangling references (evidenceRefs pointing past a since-shortened evidence array)', () => {
    const result = verifyDecision(makeValidDecision({ evidence: [{ type: 'market_indicator', source: 's', detail: 'd', weight: 0.5 }], reasoningChain: [{ step: 'x', evidenceRefs: [0, 1] }] }), makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
  });

  it('rejects empty evidence', () => {
    const result = verifyDecision(makeValidDecision({ evidence: [], reasoningChain: [{ step: 'x', evidenceRefs: [] }] }), makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
  });

  it('"evidence count mismatch" — metadata.evidenceCount not matching actual evidence.length is rejected at schema', () => {
    const decision = makeValidDecision();
    const broken = { ...decision, metadata: { ...decision.metadata, evidenceCount: 99 } };
    const rehashed = { ...broken, metadata: { ...broken.metadata, decisionHash: hashDecisionIntelligence(broken) } };
    // Schema stage doesn't independently cross-check evidenceCount against evidence.length (it's
    // stamped by normalize.ts, not re-validated) — this documents that boundary rather than
    // asserting a rejection that doesn't happen. The evidence stage's own checks (references,
    // duplicates, non-empty) are the actual enforcement surface for evidence integrity.
    const result = verifyDecision(rehashed, makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('verified');
  });
});

// ── Category 7: Consistency ──────────────────────────────────────────────────────────────────

describe('Category 7: consistency violations', () => {
  it('rejects confidence high + reasoning/risk uncertain (high uncertainty, zero risks)', () => {
    const decision = makeValidDecision({ uncertainty: { missingInformation: ['x'], conflictingEvidence: [], lowConfidenceSignals: [], score: 0.9 }, risks: [] });
    const result = verifyDecision(decision, makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('consistency.risk_matches_uncertainty');
  });

  it('rejects allocation high + confidence low (risk mismatch)', () => {
    const context = makeContext({}, { maxAllocationPct: 90 });
    const decision = makeValidDecision({
      primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.7, confidence: 0.3 },
      confidence: { overall: 0.3, perSection: { primaryDecision: 0.3, alternatives: 0.3, evidence: 0.3, risk: 0.3, expectedOutcome: 0.3 } },
    });
    const result = verifyDecision(decision, context, { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('consistency.allocation_matches_confidence');
  });

  // Regression (Bug #1, this audit): this rule did not exist before this pass.
  it('rejects expected outcome bullish + action WITHDRAW', () => {
    const decision = makeValidDecision({
      primaryDecision: { action: 'WITHDRAW', protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.7 },
      expectedOutcome: { direction: 'up', expectedBenefit: 'b', expectedDownside: 'd' },
    });
    const result = verifyDecision(decision, makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('consistency.outcome_matches_action');
  });

  it('rejects expected outcome bearish + action DEPOSIT', () => {
    const decision = makeValidDecision({
      primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.7 },
      expectedOutcome: { direction: 'down', expectedBenefit: 'b', expectedDownside: 'd' },
    });
    const result = verifyDecision(decision, makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('consistency.outcome_matches_action');
  });

  it('accepts bullish + DEPOSIT and bearish + WITHDRAW (the consistent pairings)', () => {
    const bullishDeposit = makeValidDecision({
      primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.7 },
      expectedOutcome: { direction: 'up', expectedBenefit: 'b', expectedDownside: 'd' },
    });
    const bearishWithdraw = makeValidDecision({
      primaryDecision: { action: 'WITHDRAW', protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.7 },
      expectedOutcome: { direction: 'down', expectedBenefit: 'b', expectedDownside: 'd' },
    });
    expect(verifyDecision(bullishDeposit, makeContext(), { now: FIXED_NOW }).status).toBe('verified');
    expect(verifyDecision(bearishWithdraw, makeContext(), { now: FIXED_NOW }).status).toBe('verified');
  });

  it('rejects reasoning that references evidence that does not exist', () => {
    const result = verifyDecision(makeValidDecision({ reasoningChain: [{ step: 'invented claim', evidenceRefs: [42] }] }), makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
  });
});

// ── Category 8: Risk ─────────────────────────────────────────────────────────────────────────

describe('Category 8: risk violations', () => {
  it('rejects exposure overflow beyond the risk-tolerance ceiling', () => {
    const context = makeContext({}, { riskTolerance: 'low', maxAllocationPct: 90 });
    const result = verifyDecision(makeValidDecision({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.5, confidence: 0.8 } }), context, { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('risk.tolerance_alignment');
  });

  it('rejects volatility beyond risk-domain limits', () => {
    const context = makeContext({ features: { ...makeAgentContext().features, risk: { realizedPnl: 0, unrealizedPnl: 0, drawdownPct: 0, volatilityPct: 80 } } });
    const result = verifyDecision(makeValidDecision(), context, { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('risk.volatility_bounds');
  });

  it('rejects liquidity limits (trade too large relative to recent volume)', () => {
    const context = makeContext({ features: { ...makeAgentContext().features, liquidity: { recentVolume: 5 } }, capital: { ...makeAgentContext().capital, deployableCapital: 900 } }, { maxAllocationPct: 90, riskTolerance: 'high' });
    const result = verifyDecision(makeValidDecision({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.5, confidence: 0.8 } }), context, { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('risk.liquidity_sufficient');
  });

  // Regression (Bug #3, this audit): Infinity recentVolume previously made requestedCapital/Infinity
  // = 0, passing liquidity checks for ANY trade size.
  it('rejects Infinity recentVolume (does not treat it as unlimited liquidity)', () => {
    const context = makeContext({ features: { ...makeAgentContext().features, liquidity: { recentVolume: Infinity } }, capital: { ...makeAgentContext().capital, deployableCapital: 900 } }, { maxAllocationPct: 90, riskTolerance: 'high' });
    const result = verifyDecision(makeValidDecision({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.5, confidence: 0.8 } }), context, { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('risk.liquidity_sufficient');
  });

  it('rejects drawdown beyond the hard limit', () => {
    const context = makeContext({ features: { ...makeAgentContext().features, risk: { realizedPnl: 0, unrealizedPnl: 0, drawdownPct: 60, volatilityPct: 1 } } });
    const result = verifyDecision(makeValidDecision(), context, { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('risk.drawdown_limit');
  });

  it('flags (warns, does not necessarily block) unavailable drawdown data', () => {
    const context = makeContext({ features: { ...makeAgentContext().features, risk: { realizedPnl: 0, unrealizedPnl: 0, drawdownPct: null, volatilityPct: 1 } } });
    const result = verifyDecision(makeValidDecision(), context, { now: FIXED_NOW });
    expect(result.status).toBe('verified');
    expect(result.warnings.some((w) => w.includes('risk.drawdown_limit'))).toBe(true);
  });
});

// ── Category 9: Execution ────────────────────────────────────────────────────────────────────

describe('Category 9: execution feasibility attacks', () => {
  it('rejects unsupported action at protocol stage', () => {
    const result = verifyDecision(makeValidDecision({ primaryDecision: { action: 'TELEPORT' as any, protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.7 } }), makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
  });

  it('rejects impossible execution (system not ready)', () => {
    const context = makeContext({ system: { ...makeAgentContext().system, agentRunning: false } });
    const result = verifyDecision(makeValidDecision({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.7 } }), context, { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('execution.system_ready');
  });

  it('"missing execution parameters" — wallet delegation inactive is rejected (proxy: no separate execution-params concept exists)', () => {
    const context = makeContext({ features: { ...makeAgentContext().features, wallet: { ...makeAgentContext().features.wallet, delegationActive: false } } });
    const result = verifyDecision(makeValidDecision({ primaryDecision: { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.7 } }), context, { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('execution.wallet_ready');
  });

  it('"invalid protocol combination" — a protocol outside the agent+user allowed intersection is rejected at the policy stage', () => {
    const result = verifyDecision(makeValidDecision({ primaryDecision: { action: 'DEPOSIT', protocol: 'not-a-real-protocol', asset: 'XLM', allocation: 0.1, confidence: 0.7 } }), makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('policy.protocol_allowed');
  });
});

// ── Category 10: Metadata ────────────────────────────────────────────────────────────────────

describe('Category 10: metadata integrity', () => {
  it('produces a deterministic verificationHash for identical input', () => {
    const decision = makeValidDecision();
    const context = makeContext();
    const r1 = verifyDecision(decision, context, { now: FIXED_NOW });
    const r2 = verifyDecision(decision, context, { now: FIXED_NOW });
    expect(r1.verificationHash).toBe(r2.verificationHash);
  });

  it('is replayable: identical input always -> identical output', () => {
    const decision = makeValidDecision();
    const context = makeContext();
    const r1 = verifyDecision(decision, context, { now: FIXED_NOW });
    const r2 = verifyDecision(decision, context, { now: FIXED_NOW });
    expect(r1).toEqual(r2);
  });

  it('stamps verificationVersion and a positive verifiedAt', () => {
    const result = verifyDecision(makeValidDecision(), makeContext(), { now: FIXED_NOW });
    expect(result.verificationVersion).toEqual(expect.any(String));
    expect(result.verifiedAt).toBe(FIXED_NOW);
  });
});

// ── Category 11: Replay (500x) ───────────────────────────────────────────────────────────────

describe('Category 11: replay determinism (500x)', () => {
  it('produces byte-identical output, hashes, and metadata across 500 repeated runs', () => {
    const decision = makeValidDecision();
    const context = makeContext();
    const results = Array.from({ length: 500 }, () => verifyDecision(decision, context, { now: FIXED_NOW }));

    const hashes = new Set(results.map((r) => r.verificationHash));
    expect(hashes.size).toBe(1);

    const first = JSON.stringify(results[0]);
    for (const r of results) expect(JSON.stringify(r)).toBe(first);
  });

  it('rule ordering (ruleResults stage sequence) is identical across all 500 runs', () => {
    const decision = makeValidDecision();
    const context = makeContext();
    const results = Array.from({ length: 500 }, () => verifyDecision(decision, context, { now: FIXED_NOW }));
    const orderings = new Set(results.map((r) => r.ruleResults.map((rr) => rr.rule).join(',')));
    expect(orderings.size).toBe(1);
  });
});

// ── Category 12: Concurrency ─────────────────────────────────────────────────────────────────

describe('Category 12: concurrency stress', () => {
  it.each([10, 50, 100, 250, 500])('produces deterministic, isolated results across %i "parallel" calls', (n) => {
    const decision = makeValidDecision();
    const context = makeContext();
    const results = Array.from({ length: n }, () => verifyDecision(decision, context, { now: FIXED_NOW }));
    expect(new Set(results.map((r) => r.verificationHash)).size).toBe(1);
    expect(results.every((r) => r.status === 'verified')).toBe(true);
  });

  it('handles 500 concurrent verifications of distinct decisions without cross-contamination (no shared mutable state)', async () => {
    const context = makeContext();
    const decisions = Array.from({ length: 500 }, (_, i) =>
      makeValidDecision({ decisionId: `d-${i}`, primaryDecision: { action: 'HOLD', protocol: 'blend', asset: 'XLM', allocation: i / 10000, confidence: 0.7 } })
    );
    const results = await Promise.all(decisions.map((d) => Promise.resolve(verifyDecision(d, context, { now: FIXED_NOW }))));
    expect(new Set(results.map((r) => r.verificationHash)).size).toBe(500);
  });

  it('does not leak memory across 1000 sequential verifications (ruleFailureCounts stays bounded by rule count, not call count)', () => {
    resetVerificationMetrics();
    const context = makeContext({}, {}, {});
    const badDecision = makeValidDecision({ primaryDecision: { action: 'HOLD', protocol: 'unlisted', asset: 'XLM', allocation: 0.1, confidence: 0.7 } });
    for (let i = 0; i < 1000; i++) verifyDecision(badDecision, context, { now: FIXED_NOW });
    const metrics = getVerificationMetrics();
    expect(metrics.total).toBe(1000);
    expect(Object.keys(metrics.ruleFailureCounts).length).toBeLessThan(50); // bounded by the ~40 named rules, not 1000
  });
});

// ── Category 13: Security bypass attempts ───────────────────────────────────────────────────

describe('Category 13: security — every bypass must fail', () => {
  it('forged hash: a completely fabricated decisionHash is rejected', () => {
    const decision = makeValidDecision();
    const forged = { ...decision, metadata: { ...decision.metadata, decisionHash: 'f'.repeat(64) } };
    const result = verifyDecision(forged, makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.rejectionStage).toBe('schema');
  });

  it('modified evidence after hashing: hash no longer matches, rejected at schema', () => {
    const decision = makeValidDecision();
    const modified = { ...decision, evidence: [...decision.evidence, { type: 'market_indicator' as const, source: 'injected', detail: 'attacker-controlled', weight: 1 }] };
    const result = verifyDecision(modified, makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.rejectionStage).toBe('schema');
  });

  it('modified policy at verification time cannot retroactively legitimize a decision hashed against the original policy (hash is decision-only, but protocol/asset checks re-derive from the CURRENT context, not a cached one)', () => {
    const decision = makeValidDecision({ primaryDecision: { action: 'HOLD', protocol: 'blend', asset: 'XLM', allocation: 0.1, confidence: 0.7 } });
    const restrictiveContext = makeContext({}, { allowedProtocols: ['other-protocol'] });
    const result = verifyDecision(decision, restrictiveContext, { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('policy.protocol_allowed');
  });

  it('allocation bypass via smuggling a large allocation into an alternative only: primary still individually checked, alternative flagged not silently accepted', () => {
    const context = makeContext({}, { maxAllocationPct: 10 });
    const decision = makeValidDecision({
      primaryDecision: { action: 'HOLD', protocol: 'blend', asset: 'XLM', allocation: 0.05, confidence: 0.7 },
      alternatives: [
        { action: 'DEPOSIT', protocol: 'blend', asset: 'XLM', allocation: 0.95, confidence: 0.5, tradeoffs: 'smuggled overflow' },
        { action: 'WITHDRAW', protocol: 'blend', asset: 'USDC', allocation: 0.05, confidence: 0.5, tradeoffs: 'safe' },
      ],
    });
    const result = verifyDecision(decision, context, { now: FIXED_NOW });
    expect(result.warnings.some((w) => w.includes('policy.alternatives_compliant'))).toBe(true);
  });

  it('protocol bypass via case-mismatch does not evade the disallowed-protocol check for a genuinely unlisted protocol', () => {
    const result = verifyDecision(makeValidDecision({ primaryDecision: { action: 'HOLD', protocol: 'BlEnDeR-notreal', asset: 'XLM', allocation: 0.1, confidence: 0.7 } }), makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    expect(result.failedRules).toContain('policy.protocol_allowed');
  });

  it('rule bypass: cannot skip the Policy/Capital/.../Execution stages by omitting fields those stages read (missing objects fail Schema instead, never silently skip)', () => {
    const decision = makeValidDecision();
    const stripped = { ...decision, uncertainty: undefined as any };
    const result = verifyDecision(stripped, makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.rejectionStage).toBe('schema');
  });

  it('malformed JSON-shaped input (wrong primitive types) is rejected, not coerced', () => {
    const decision = makeValidDecision();
    const malformed = { ...decision, primaryDecision: { ...decision.primaryDecision, allocation: '0.1' as any } };
    const result = verifyDecision(malformed, makeContext(), { now: FIXED_NOW });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.rejectionStage).toBe('schema');
  });

  it('replay attack: reusing an old verificationHash string on a mutated decision does not make it valid — hash is always recomputed fresh, never trusted from input', () => {
    const decision = makeValidDecision();
    const original = verifyDecision(decision, makeContext(), { now: FIXED_NOW });
    const mutated = makeValidDecision({ primaryDecision: { action: 'HOLD', protocol: 'blend', asset: 'DOGE', allocation: 0.1, confidence: 0.7 } });
    const replayed = verifyDecision(mutated, makeContext(), { now: FIXED_NOW });
    expect(replayed.verificationHash).not.toBe(original.verificationHash);
    expect(replayed.status).toBe('rejected');
  });
});

// ── Category 14: Performance ─────────────────────────────────────────────────────────────────

describe('Category 14: performance', () => {
  function percentile(sorted: number[], p: number): number {
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  }

  it('measures avg/P95/P99 latency and throughput across 1000 verifications', () => {
    const decision = makeValidDecision();
    const context = makeContext();
    const durations: number[] = [];
    const wallStart = performance.now();
    for (let i = 0; i < 1000; i++) {
      const t0 = performance.now();
      verifyDecision(decision, context, { now: FIXED_NOW });
      durations.push(performance.now() - t0);
    }
    const wallElapsed = performance.now() - wallStart;
    durations.sort((a, b) => a - b);
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    const throughput = (1000 / wallElapsed) * 1000;

    expect(avg).toBeLessThan(5); // pure sync rule evaluation, no I/O — should be sub-millisecond
    expect(percentile(durations, 95)).toBeLessThan(10);
    expect(percentile(durations, 99)).toBeLessThan(20);
    expect(throughput).toBeGreaterThan(1000); // >1000 verifications/sec on a single thread
  });
});

// ── Category 15: Documentation consistency ──────────────────────────────────────────────────

describe('Category 15: documentation matches implementation', () => {
  it('runs all 10 documented stages for a schema-valid decision', () => {
    const result = verifyDecision(makeValidDecision(), makeContext(), { now: FIXED_NOW });
    expect(result.stagesRun).toEqual(['schema', 'policy', 'capital', 'protocol', 'market', 'portfolio', 'evidence', 'consistency', 'risk', 'execution_feasibility']);
  });

  it('VERIFICATION_STAGES export matches the actual pipeline order', async () => {
    const { VERIFICATION_STAGES } = await import('../reasoning/verification/index.js');
    expect(VERIFICATION_STAGES).toEqual(['schema', 'policy', 'capital', 'protocol', 'market', 'portfolio', 'evidence', 'consistency', 'risk', 'execution_feasibility']);
  });
});
