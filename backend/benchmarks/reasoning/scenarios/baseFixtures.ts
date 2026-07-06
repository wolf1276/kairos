// Base AgentContext/MemoryPackage/UserPolicy builders shared by every scenario. Scenarios patch
// these with deepMerge rather than duplicating the full fixture — keeps every scenario's diff
// visible and small. This is scenario *data*, not a modification of the Context/Memory/Reasoning
// engines — it constructs the same input shapes those engines already accept.
import type { AgentContext } from '../../../src/agentContext/index.js';
import type { MemoryPackage } from '../../../src/memoryLayer/index.js';
import type { UserPolicy } from '../../../src/reasoning/types.js';

export const BASE_AGENT_ID = 'agent-benchmark';

export function baseAgentContext(): AgentContext {
  return {
    agentId: BASE_AGENT_ID,
    owner: 'owner-benchmark',
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
      wallet: {
        publicKey: 'GABCDEXAMPLE',
        smartWalletAddress: null,
        delegationActive: true,
        mode: 'auto' as unknown as AgentContext['features']['wallet']['mode'],
        capital: '1000',
      },
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
  } as AgentContext;
}

export function baseMemoryPackage(): MemoryPackage {
  return {
    meta: { version: '1.0.0', agentId: BASE_AGENT_ID, timestamp: Date.now(), packageId: 'pkg-benchmark', packageHash: 'memory-package-hash' },
    episodic: [],
    semantic: [],
    working: [],
    validation: { ok: true, errors: [] },
    status: 'valid',
  };
}

export function baseUserPolicy(): UserPolicy {
  return {
    userId: 'user-benchmark',
    riskTolerance: 'medium',
    maxAllocationPct: 35,
    allowedProtocols: ['blend'],
    allowedAssets: ['XLM', 'USDC'],
    minConfidence: 0.6,
    objectives: ['grow capital steadily', 'manage risk'],
  };
}
