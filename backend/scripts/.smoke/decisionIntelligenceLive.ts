// Live production smoke test for Decision Intelligence (Phase 3) — NVIDIA NIM + Hugging Face
// Inference only. Not part of the committed test suite; scratch/manual verification.
import { writeFileSync } from 'fs';
import { buildReasoningContext } from '../../src/reasoning/contextBuilder.js';
import { buildPrompt } from '../../src/reasoning/promptBuilder.js';
import { generateDecisionIntelligence, getDecisionIntelligenceMetrics, resetDecisionIntelligenceMetrics } from '../../src/reasoning/decisionIntelligence/index.js';
import type { AgentContext } from '../../src/agentContext/index.js';
import type { MemoryPackage } from '../../src/memoryLayer/index.js';
import type { UserPolicy } from '../../src/reasoning/types.js';
import type { DecisionIntelligenceProviderConfig } from '../../src/reasoning/decisionIntelligence/requestClient.js';

const NVIDIA_KEY = process.env.NVIDIA_API_KEY!;
const HF_KEY = process.env.HUGGINGFACE_API_KEY!;
const OUT_PATH = process.argv[2];

function baseAgentContext(): AgentContext {
  return {
    agentId: 'agent-di-smoke', owner: 'owner-1', role: 'trend_follower' as any, pair: 'XLM/USDC',
    regime: { base: 'XLM', label: 'trending_up' as any, breakout: false, volatilityBand: 'normal' },
    features: {
      pair: 'XLM/USDC', price: 0.12,
      trend: { ema20: 0.11, ema50: 0.1, sma20: 0.115, trendStrength: 25, direction: 'up' },
      momentum: { rsi: 55, macdHistogram: 0.001, roc: 0.02 },
      volatility: { atr: 0.002, volatilityPct: 1.5, band: 'normal' },
      volume: { window24h: 1000000, changePct: 5 }, liquidity: { recentVolume: 500000 },
      wallet: { publicKey: 'GABC', smartWalletAddress: null, delegationActive: true, mode: 'auto' as any, capital: '1000' },
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
    policy: { objective: 'trend_follower' as any, riskProfile: 'moderate', allowedAssets: ['XLM', 'USDC'], allowedProtocols: ['blend'], delegationActive: true, spendingLimitPerTrade: '100', minConfidence: 0.6, positionLimit: { maxCapital: '500' }, confidence: 1 },
    system: { oracleHealthy: true, schedulerRunning: true, priceFeedRunning: true, agentRunning: true, protocolExecutionAvailable: true, executionAvailable: true, featureFlags: {}, confidence: 1 },
    historical: { lastExecution: null, lastDecision: null, recentFailureCount: 0, cooldown: { active: false, remainingSeconds: 0 }, recentExecutionSummary: { tradeCount: 0, successCount: 0, failureCount: 0 }, confidence: 1 },
    validation: { ok: true, errors: [] }, status: 'valid',
    quality: { score: 0.95, level: 'high', domainConfidence: { market: 0.9, capital: 0.95, policy: 1, system: 1, historical: 1 } },
  } as AgentContext;
}

function baseMemoryPackage(): MemoryPackage {
  return { meta: { version: '1.0.0', agentId: 'agent-di-smoke', timestamp: Date.now(), packageId: 'pkg-1', packageHash: 'memory-package-hash' }, episodic: [], semantic: [], working: [], validation: { ok: true, errors: [] }, status: 'valid' };
}

function baseUserPolicy(): UserPolicy {
  return { userId: 'user-1', riskTolerance: 'medium', maxAllocationPct: 25, allowedProtocols: ['blend'], allowedAssets: ['XLM', 'USDC'], minConfidence: 0.6, objectives: ['grow capital steadily'] };
}

function deepMerge<T>(base: T, patch: any): T {
  if (Array.isArray(patch)) return patch;
  if (patch && typeof patch === 'object') {
    const out: any = { ...(base as any) };
    for (const k of Object.keys(patch)) out[k] = deepMerge((base as any)?.[k], patch[k]);
    return out;
  }
  return patch === undefined ? base : patch;
}

interface Scenario { name: string; category: string; agentPatch?: any; memoryPatch?: any; policyPatch?: any; }

const SCENARIOS: Scenario[] = [
  { name: 'bull_trend', category: 'bull', agentPatch: { features: { trend: { direction: 'up', trendStrength: 60 }, momentum: { rsi: 68, macdHistogram: 0.01, roc: 0.05 } }, regime: { label: 'trending_up', breakout: true } } },
  { name: 'bear_trend', category: 'bear', agentPatch: { features: { trend: { direction: 'down', trendStrength: 60, ema20: 0.09, ema50: 0.11 }, momentum: { rsi: 28, macdHistogram: -0.01, roc: -0.05 } }, regime: { label: 'trending_down', breakout: true } } },
  { name: 'sideways', category: 'sideways', agentPatch: { features: { trend: { direction: 'flat', trendStrength: 3 }, momentum: { rsi: 50, macdHistogram: 0.0001, roc: 0.001 } }, regime: { label: 'ranging', breakout: false } } },
  { name: 'high_volatility', category: 'high_volatility', agentPatch: { features: { volatility: { atr: 0.02, volatilityPct: 18, band: 'high' } }, regime: { volatilityBand: 'high' } } },
  { name: 'low_volatility', category: 'low_volatility', agentPatch: { features: { volatility: { atr: 0.0003, volatilityPct: 0.2, band: 'low' } }, regime: { volatilityBand: 'low' } } },
  { name: 'empty_memory', category: 'empty_memory', memoryPatch: { episodic: [], semantic: [], working: [] } },
  {
    name: 'rich_memory', category: 'rich_memory',
    memoryPatch: {
      episodic: [
        { id: 'ep-1', agentId: 'agent-di-smoke', timestamp: Date.now() - 86400000, contextRef: 'snap-1', decisionRef: 'dec-1', executionRef: 'exec-1', outcome: 'win', pnl: 22.5, holdingTimeSeconds: 3600, confidence: 0.8, quality: 'high', tags: ['xlm', 'trend'] },
        { id: 'ep-2', agentId: 'agent-di-smoke', timestamp: Date.now() - 172800000, contextRef: 'snap-2', decisionRef: 'dec-2', executionRef: 'exec-2', outcome: 'loss', pnl: -8.1, holdingTimeSeconds: 1800, confidence: 0.6, quality: 'medium', tags: ['xlm'] },
      ],
      semantic: [{ id: 'fact-1', agentId: 'agent-di-smoke', key: 'preferred-pair', value: 'XLM/USDC', confidence: 1, updatedAt: Date.now(), tags: [] }],
      working: [],
    },
  },
  { name: 'conflicting_evidence', category: 'conflicting_evidence', agentPatch: { features: { trend: { direction: 'up', trendStrength: 45, ema20: 0.13, ema50: 0.1 }, momentum: { rsi: 25, macdHistogram: -0.008, roc: -0.03 } } } },
  { name: 'large_portfolio', category: 'large_portfolio', agentPatch: { capital: { totalManagedCapital: 1000000, idleCapital: 150000, deployableCapital: 850000 }, features: { portfolio: { totalValue: 1000000 } } } },
  { name: 'small_portfolio', category: 'small_portfolio', agentPatch: { capital: { totalManagedCapital: 50, idleCapital: 5, deployableCapital: 45 }, features: { portfolio: { totalValue: 50 } } } },
];

function buildScenario(s: Scenario) {
  const agentContext = deepMerge(baseAgentContext(), s.agentPatch ?? {});
  const memoryPackage = deepMerge(baseMemoryPackage(), s.memoryPatch ?? {});
  const userPolicy = deepMerge(baseUserPolicy(), s.policyPatch ?? {});
  const context = buildReasoningContext(agentContext, memoryPackage, userPolicy);
  const prompt = buildPrompt(context, 'v2');
  return { context, prompt };
}

interface RunResult {
  provider: string; model: string; scenario: string; category: string;
  success: boolean; validationOk: boolean; validationErrors: string[]; errorKind?: string;
  latencyMs: number; promptTokens: number; completionTokens: number; totalTokens: number; responseSizeBytes: number;
  decision?: {
    action: string; protocol: string; asset: string; allocation: number; confidence: number;
    alternativeCount: number; evidenceCount: number; uncertaintyScore: number;
    reasoningChainLength: number; risksCount: number; expectedOutcomeDirection: string;
  };
}

async function runOne(config: DecisionIntelligenceProviderConfig, scenario: Scenario): Promise<RunResult> {
  const { context, prompt } = buildScenario(scenario);
  resetDecisionIntelligenceMetrics();
  const t0 = performance.now();
  try {
    const { decision, validation } = await generateDecisionIntelligence(context, prompt, config);
    const latencyMs = performance.now() - t0;
    const bucket = getDecisionIntelligenceMetrics()[`${config.provider}:${config.model}`];
    return {
      provider: config.provider, model: config.model, scenario: scenario.name, category: scenario.category,
      success: true, validationOk: validation.ok, validationErrors: validation.errors,
      latencyMs,
      promptTokens: bucket?.totalPromptTokens ?? 0,
      completionTokens: bucket?.totalCompletionTokens ?? 0,
      totalTokens: bucket?.totalTokens ?? 0,
      responseSizeBytes: JSON.stringify(decision).length,
      decision: {
        action: decision.primaryDecision.action, protocol: decision.primaryDecision.protocol, asset: decision.primaryDecision.asset,
        allocation: decision.primaryDecision.allocation, confidence: decision.confidence.overall,
        alternativeCount: decision.alternatives.length, evidenceCount: decision.evidence.length,
        uncertaintyScore: decision.uncertainty.score, reasoningChainLength: decision.reasoningChain.length,
        risksCount: decision.risks.length, expectedOutcomeDirection: decision.expectedOutcome.direction,
      },
    };
  } catch (err: any) {
    const latencyMs = performance.now() - t0;
    return {
      provider: config.provider, model: config.model, scenario: scenario.name, category: scenario.category,
      success: false, validationOk: false, validationErrors: [], errorKind: err?.kind ?? 'unknown',
      latencyMs, promptTokens: 0, completionTokens: 0, totalTokens: 0, responseSizeBytes: 0,
    };
  }
}

async function main() {
  const results: RunResult[] = [];
  const configs: DecisionIntelligenceProviderConfig[] = [
    { provider: 'nvidia', model: 'z-ai/glm-5.2', apiKey: NVIDIA_KEY, temperature: 0, maxTokens: 4000, timeoutMs: 75000, maxRetries: 0, structuredOutput: true },
    { provider: 'huggingface', model: 'meta-llama/Llama-3.1-8B-Instruct', apiKey: HF_KEY, temperature: 0, maxTokens: 4000, timeoutMs: 75000, maxRetries: 0, structuredOutput: true },
  ];

  let done = 0;
  const total = configs.length * SCENARIOS.length;
  for (const config of configs) {
    for (const scenario of SCENARIOS) {
      const result = await runOne(config, scenario);
      results.push(result);
      done += 1;
      console.error(`[${done}/${total}] ${config.provider}:${config.model} / ${scenario.name} -> ${result.success ? (result.validationOk ? 'ok' : 'INVALID') : 'FAIL:' + result.errorKind} (${result.latencyMs.toFixed(0)}ms)`);
      if (OUT_PATH) writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
    }
  }
  console.error('DONE');
}

main();
