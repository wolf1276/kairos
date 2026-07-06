// Executes one (model, scenario) pair through the existing, unmodified Decision Intelligence
// pipeline (reasoning/decisionIntelligence) and collects every field the framework tracks.
import { buildReasoningContext } from '../../../src/reasoning/contextBuilder.js';
import { buildPrompt } from '../../../src/reasoning/promptBuilder.js';
import {
  generateDecisionIntelligence,
  getDecisionIntelligenceMetrics,
  resetDecisionIntelligenceMetrics,
  DECISION_PROMPT_TEMPLATE_VERSION,
} from '../../../src/reasoning/decisionIntelligence/index.js';
import type { DecisionIntelligenceProviderConfig } from '../../../src/reasoning/decisionIntelligence/requestClient.js';
import type { BenchmarkScenario } from '../scenarios/types.js';
import type { ResolvedModel } from './providerRegistry.js';

export interface BenchmarkRunResult {
  modelId: string;
  provider: string;
  model: string;
  scenarioId: string;
  scenarioCategory: string;
  scenarioVersion: string;
  success: boolean;
  validationOk: boolean;
  validationErrors: string[];
  errorKind?: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  retryCount: number;
  responseSizeBytes: number;
  promptHash: string;
  decision?: {
    action: string;
    protocol: string;
    asset: string;
    allocation: number;
    confidence: number;
    perSectionConfidence: Record<string, number>;
    alternativeCount: number;
    alternatives: { action: string; asset: string; allocation: number; confidence: number; tradeoffs: string }[];
    evidenceCount: number;
    evidenceTypes: string[];
    reasoningChainLength: number;
    risksCount: number;
    uncertaintyScore: number;
    expectedOutcomeDirection: string;
    decisionHash: string;
  };
}

export async function executeScenario(model: ResolvedModel, config: DecisionIntelligenceProviderConfig, scenario: BenchmarkScenario): Promise<BenchmarkRunResult> {
  const context = buildReasoningContext(scenario.agentContext, scenario.memoryPackage, scenario.userPolicy);
  const prompt = buildPrompt(context, DECISION_PROMPT_TEMPLATE_VERSION);

  resetDecisionIntelligenceMetrics();
  const t0 = performance.now();
  try {
    const { decision, validation } = await generateDecisionIntelligence(context, prompt, config);
    const latencyMs = performance.now() - t0;
    const bucket = getDecisionIntelligenceMetrics()[`${config.provider}:${config.model}`];

    return {
      modelId: model.id, provider: config.provider, model: config.model,
      scenarioId: scenario.id, scenarioCategory: scenario.category, scenarioVersion: scenario.version,
      success: true, validationOk: validation.ok, validationErrors: validation.errors,
      latencyMs,
      promptTokens: bucket?.totalPromptTokens ?? 0,
      completionTokens: bucket?.totalCompletionTokens ?? 0,
      totalTokens: bucket?.totalTokens ?? 0,
      retryCount: bucket?.totalRetries ?? 0,
      responseSizeBytes: JSON.stringify(decision).length,
      promptHash: prompt.promptHash,
      decision: {
        action: decision.primaryDecision.action,
        protocol: decision.primaryDecision.protocol,
        asset: decision.primaryDecision.asset,
        allocation: decision.primaryDecision.allocation,
        confidence: decision.confidence.overall,
        perSectionConfidence: decision.confidence.perSection as unknown as Record<string, number>,
        alternativeCount: decision.alternatives.length,
        alternatives: decision.alternatives.map((a) => ({ action: a.action, asset: a.asset, allocation: a.allocation, confidence: a.confidence, tradeoffs: a.tradeoffs })),
        evidenceCount: decision.evidence.length,
        evidenceTypes: decision.evidence.map((e) => e.type),
        reasoningChainLength: decision.reasoningChain.length,
        risksCount: decision.risks.length,
        uncertaintyScore: decision.uncertainty.score,
        expectedOutcomeDirection: decision.expectedOutcome.direction,
        decisionHash: decision.metadata.decisionHash,
      },
    };
  } catch (err: unknown) {
    const latencyMs = performance.now() - t0;
    const e = err as { kind?: string; message?: string };
    return {
      modelId: model.id, provider: config.provider, model: config.model,
      scenarioId: scenario.id, scenarioCategory: scenario.category, scenarioVersion: scenario.version,
      success: false, validationOk: false,
      validationErrors: e?.kind === 'validation_failed' && e.message ? e.message.split('; ') : [],
      errorKind: e?.kind ?? 'unknown',
      latencyMs, promptTokens: 0, completionTokens: 0, totalTokens: 0, retryCount: 0,
      responseSizeBytes: 0, promptHash: prompt.promptHash,
    };
  }
}
