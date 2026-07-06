// Paced rerun for models that got starved by upstream per-model rate limiting in the first
// unpaced batch run. Adds an inter-request delay and one backoff-retry on rate_limit.
import { writeFileSync } from 'fs';
import { buildReasoningRequest, validateDecision } from '../../src/reasoning/orchestrator.js';
import { OpenAiProvider } from '../../src/reasoning/providers/openaiProvider.js';
import { OPENROUTER_BASE_URL } from '../../src/reasoning/providers/openrouterProvider.js';
import { getProviderMetrics, resetProviderMetrics } from '../../src/reasoning/providers/metrics.js';
import type { AgentContext } from '../../src/agentContext/index.js';
import type { MemoryPackage } from '../../src/memoryLayer/index.js';
import type { UserPolicy, CandidateDecision } from '../../src/reasoning/types.js';

const OPENROUTER_KEY = process.env.OPENROUTER!;
const OUT_PATH = process.argv[2];
if (!OUT_PATH) throw new Error('usage: tsx rerun_paced.ts <out.json>');

function baseAgentContext(): AgentContext {
  return {
    agentId: 'agent-benchmark', owner: 'owner-1', role: 'trend_follower' as unknown as AgentContext['role'], pair: 'XLM/USDC',
    regime: { base: 'XLM', label: 'trending_up' as unknown as AgentContext['regime']['label'], breakout: false, volatilityBand: 'normal' },
    features: {
      pair: 'XLM/USDC', price: 0.12, trend: { ema20: 0.11, ema50: 0.1, sma20: 0.115, trendStrength: 25, direction: 'up' },
      momentum: { rsi: 55, macdHistogram: 0.001, roc: 0.02 }, volatility: { atr: 0.002, volatilityPct: 1.5, band: 'normal' },
      volume: { window24h: 1000000, changePct: 5 }, liquidity: { recentVolume: 500000 },
      wallet: { publicKey: 'GABC', smartWalletAddress: null, delegationActive: true, mode: 'auto' as unknown as AgentContext['features']['wallet']['mode'], capital: '1000' },
      portfolio: { xlmPct: 50, usdcPct: 50, idleUsd: 100, totalValue: 1000, targetXlmPct: 50, targetUsdcPct: 50, driftPct: 0 },
      protocolExposure: [], risk: { realizedPnl: 10, unrealizedPnl: -2, drawdownPct: 5, volatilityPct: 1.5 }, computedAt: Date.now(),
    },
    builtAt: Date.now(), meta: { version: '2.1.0', timestamp: Date.now(), marketId: 'market-1', snapshotId: 'snapshot-1', contextHash: 'agent-context-hash' },
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
  } as AgentContext;
}
function baseMemoryPackage(): MemoryPackage {
  return { meta: { version: '1.0.0', agentId: 'agent-benchmark', timestamp: Date.now(), packageId: 'pkg-1', packageHash: 'memory-package-hash' }, episodic: [], semantic: [], working: [], validation: { ok: true, errors: [] }, status: 'valid' };
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
  { name: 'high_volatility', category: 'high_volatility', agentPatch: { features: { volatility: { atr: 0.02, volatilityPct: 18, band: 'high' } }, regime: { volatilityBand: 'high' } } },
  { name: 'empty_memory', category: 'empty_memory', memoryPatch: { episodic: [], semantic: [], working: [] } },
  { name: 'conflicting_evidence', category: 'conflicting_evidence', agentPatch: { features: { trend: { direction: 'up', trendStrength: 45, ema20: 0.13, ema50: 0.1 }, momentum: { rsi: 25, macdHistogram: -0.008, roc: -0.03 } } } },
];

function buildScenario(s: Scenario) {
  const agentContext = deepMerge(baseAgentContext(), s.agentPatch ?? {});
  const memoryPackage = deepMerge(baseMemoryPackage(), s.memoryPatch ?? {});
  const userPolicy = deepMerge(baseUserPolicy(), s.policyPatch ?? {});
  return buildReasoningRequest(agentContext, memoryPackage, userPolicy);
}

const MODELS = [
  'google/gemma-4-26b-a4b-it:free',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'openrouter/free',
  'liquid/lfm-2.5-1.2b-thinking:free',
  'liquid/lfm-2.5-1.2b-instruct:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'nvidia/nemotron-nano-12b-v2-vl:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'nvidia/nemotron-nano-9b-v2:free',
  'openai/gpt-oss-120b:free',
  'openai/gpt-oss-20b:free',
  'qwen/qwen3-coder:free',
  'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'meta-llama/llama-3.2-3b-instruct:free',
  'nousresearch/hermes-3-llama-3.1-405b:free',
];

interface RunResult {
  provider: 'openrouter'; model: string; scenario: string; category: string;
  success: boolean; validationOk: boolean; validationErrors: string[]; errorKind?: string;
  latencyMs: number; promptTokens: number; completionTokens: number; totalTokens: number;
  decision?: { action: string; protocol: string; asset: string; allocation: number; confidence: number; uncertainty: number; evidenceCount: number; risksCount: number; alternativesCount: number };
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function attemptOnce(model: string, scenario: Scenario): Promise<RunResult> {
  const { context, prompt } = buildScenario(scenario);
  const impl = new OpenAiProvider({ provider: 'openai', model, apiKey: OPENROUTER_KEY, temperature: 0, maxTokens: 1200, timeoutMs: 25000, maxRetries: 0, structuredOutput: true, baseUrl: OPENROUTER_BASE_URL });
  resetProviderMetrics();
  const t0 = performance.now();
  try {
    const decision: CandidateDecision = await impl.generateDecision(context, prompt);
    const latencyMs = performance.now() - t0;
    const validation = validateDecision(decision, context);
    const bucket = getProviderMetrics().openai;
    return {
      provider: 'openrouter', model, scenario: scenario.name, category: scenario.category,
      success: true, validationOk: validation.ok, validationErrors: validation.errors,
      latencyMs, promptTokens: bucket?.totalPromptTokens ?? 0, completionTokens: bucket?.totalCompletionTokens ?? 0, totalTokens: bucket?.totalTokens ?? 0,
      decision: { action: decision.action, protocol: decision.protocol, asset: decision.asset, allocation: decision.allocation, confidence: decision.confidence, uncertainty: decision.uncertainty, evidenceCount: decision.supportingEvidence.length, risksCount: decision.risks.length, alternativesCount: decision.alternatives.length },
    };
  } catch (err: any) {
    const latencyMs = performance.now() - t0;
    return { provider: 'openrouter', model, scenario: scenario.name, category: scenario.category, success: false, validationOk: false, validationErrors: [], errorKind: err?.kind ?? 'unknown', latencyMs, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }
}

async function runOnePaced(model: string, scenario: Scenario): Promise<RunResult> {
  let result = await attemptOnce(model, scenario);
  if (!result.success && result.errorKind === 'rate_limit') {
    await sleep(20000);
    result = await attemptOnce(model, scenario);
  }
  return result;
}

async function main() {
  const results: RunResult[] = [];
  const total = MODELS.length * SCENARIOS.length;
  let done = 0;
  for (const model of MODELS) {
    for (const scenario of SCENARIOS) {
      const result = await runOnePaced(model, scenario);
      results.push(result);
      done += 1;
      console.error(`[${done}/${total}] ${model} / ${scenario.name} -> ${result.success ? 'ok' : 'FAIL:' + result.errorKind} (${result.latencyMs.toFixed(0)}ms)`);
      writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
      await sleep(6000);
    }
  }
  console.error('DONE');
}

main();
