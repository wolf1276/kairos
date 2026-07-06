// Versioned prompt templates for the Reasoning Engine. A template is a pure function from
// ReasoningContext -> PromptSections — no LLM calls, no I/O. New versions are added here without
// touching orchestration or the prompt builder's assembly logic.
import { stableStringify } from '../stableStringify.js';
import type { ReasoningContext, PromptSections } from './types.js';

export type PromptTemplateFn = (context: ReasoningContext) => PromptSections;

function buildV1Sections(context: ReasoningContext): PromptSections {
  const { agentContext, memoryPackage, userPolicy } = context;

  return {
    system:
      'You are the reasoning component of an autonomous trading agent. Produce a structured ' +
      'candidate decision only. You do not execute trades, call external systems, or verify ' +
      'outcomes — that is the responsibility of other engines.',

    agentIdentity: stableStringify({
      agentId: agentContext.agentId,
      owner: agentContext.owner,
      role: agentContext.role,
      pair: agentContext.pair,
      regime: agentContext.regime,
    }),

    marketContext: stableStringify({
      pair: agentContext.pair,
      price: agentContext.features.price,
      trend: agentContext.features.trend,
      momentum: agentContext.features.momentum,
      volatility: agentContext.features.volatility,
      volume: agentContext.features.volume,
      liquidity: agentContext.features.liquidity,
      market: agentContext.market,
    }),

    managedCapital: stableStringify({
      portfolio: agentContext.features.portfolio,
      protocolExposure: agentContext.features.protocolExposure,
      capital: agentContext.capital,
      risk: agentContext.features.risk,
    }),

    historicalExperience: stableStringify({
      episodic: memoryPackage.episodic,
      historical: agentContext.historical,
    }),

    detectedPatterns: stableStringify({
      semantic: memoryPackage.semantic,
      working: memoryPackage.working,
    }),

    evidence: stableStringify({
      contextQuality: agentContext.quality,
      memoryValidation: memoryPackage.validation,
    }),

    riskConstraints: stableStringify({
      agentPolicy: agentContext.policy,
      userRiskTolerance: userPolicy.riskTolerance,
      maxAllocationPct: userPolicy.maxAllocationPct,
      minConfidence: userPolicy.minConfidence,
    }),

    allowedProtocols: stableStringify({
      agentAllowedProtocols: agentContext.policy.allowedProtocols,
      agentAllowedAssets: agentContext.policy.allowedAssets,
      userAllowedProtocols: userPolicy.allowedProtocols,
      userAllowedAssets: userPolicy.allowedAssets,
    }),

    objectives: stableStringify({
      objectives: userPolicy.objectives,
      role: agentContext.role,
    }),

    outputSchema:
      'Respond with a CandidateDecision: { decisionId, timestamp, action, protocol, asset, ' +
      'allocation, confidence, reasoning, supportingEvidence, risks, assumptions, alternatives, ' +
      'uncertainty, metadata }. No execution fields.',
  };
}

/**
 * v2 — Decision Intelligence (Phase 3). Identical to v1 in every section except `system` and
 * `outputSchema`: the underlying context (market/capital/memory/policy) hasn't changed, only what
 * the model is asked to produce has. Kept as a full function (not a v1 override) so v1 remains
 * untouched and independently versioned, per the "new prompt template version" extension point.
 */
function buildV2Sections(context: ReasoningContext): PromptSections {
  const v1 = buildV1Sections(context);
  return {
    ...v1,
    system:
      'You are the Decision Intelligence component of an autonomous portfolio agent. Produce a ' +
      'structured decision analysis only: a primary decision, 2-3 alternatives, a reasoning ' +
      'chain where every step cites evidence, a risk assessment, explicit assumptions, an ' +
      'uncertainty assessment, a qualitative expected outcome, and confidence per section. ' +
      'Reference only the facts given to you below — never invent facts, market data, or ' +
      'history not present in this prompt. You do not execute trades, call external systems, ' +
      'write memory, or verify outcomes — that is the responsibility of other engines.',

    outputSchema:
      'Respond with a Decision Intelligence object: { primaryDecision: { action (one of HOLD, ' +
      'DEPOSIT, WITHDRAW, SWAP, REBALANCE — never another value), protocol, asset, allocation ' +
      '[0,1], confidence [0,1] }, alternatives (2-3 items, each with action, protocol, asset, ' +
      'allocation, confidence, tradeoffs), reasoningChain (each step citing evidence indices via ' +
      'evidenceRefs), evidence (each item typed as market_indicator, historical_statistic, ' +
      'historical_pattern, historical_conflict, or policy_rule), risks (description, ' +
      'probability, severity, mitigation), assumptions (non-empty — no hidden assumptions), ' +
      'uncertainty { missingInformation, conflictingEvidence, lowConfidenceSignals, score }, ' +
      'expectedOutcome { direction (up/down/flat/uncertain), expectedBenefit, expectedDownside ' +
      '— qualitative only, never fabricate numeric precision }, confidence { overall, ' +
      'perSection: { primaryDecision, alternatives, evidence, risk, expectedOutcome } }, and a ' +
      'concise summary. No execution fields.',
  };
}

const TEMPLATES: Record<string, PromptTemplateFn> = {
  v1: buildV1Sections,
  v2: buildV2Sections,
};

export function getPromptTemplate(version: string): PromptTemplateFn {
  const template = TEMPLATES[version];
  if (!template) throw new Error(`Unknown prompt template version: ${version}`);
  return template;
}
