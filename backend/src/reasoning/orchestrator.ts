// Reasoning Orchestrator — wires context assembly, prompt assembly, provider invocation, and
// validation together. Emits structured logs only — no monitoring framework. Provider selection
// (Phase 2) is entirely configuration-driven: this file never branches on provider name.
import { buildReasoningContext } from './contextBuilder.js';
import { buildPrompt } from './promptBuilder.js';
import { validateCandidateDecision, deriveAllowedPolicy } from './validation.js';
import { PROMPT_TEMPLATE_VERSION } from './types.js';
import type { ReasoningProvider } from './interfaces.js';
import type { AgentContext } from '../agentContext/index.js';
import type { MemoryPackage } from '../memoryLayer/index.js';
import type { UserPolicy, ReasoningContext, Prompt, CandidateDecision, DecisionValidationResult } from './types.js';

function log(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ component: 'reasoning-engine', event, ...fields }));
}

export interface ReasoningRequest {
  context: ReasoningContext;
  prompt: Prompt;
}

/** Builds a ReasoningContext from the three raw inputs, timing the assembly step. */
export function buildReasoningRequestContext(
  agentContext: AgentContext,
  memoryPackage: MemoryPackage,
  userPolicy: UserPolicy
): ReasoningContext {
  const start = performance.now();
  const context = buildReasoningContext(agentContext, memoryPackage, userPolicy);
  const durationMs = performance.now() - start;
  log('context_assembly', { agentId: context.meta.agentId, durationMs, reasoningContextHash: context.meta.reasoningContextHash });
  return context;
}

/** Assembles a Prompt from a ReasoningContext, timing the assembly step. */
export function assemblePrompt(context: ReasoningContext, templateVersion: string = PROMPT_TEMPLATE_VERSION): Prompt {
  const start = performance.now();
  const prompt = buildPrompt(context, templateVersion);
  const durationMs = performance.now() - start;
  log('prompt_generation', { agentId: context.meta.agentId, durationMs, promptHash: prompt.promptHash, templateVersion });
  return prompt;
}

/** Builds the full ReasoningRequest (context + prompt) in one call. No provider is invoked. */
export function buildReasoningRequest(
  agentContext: AgentContext,
  memoryPackage: MemoryPackage,
  userPolicy: UserPolicy,
  templateVersion: string = PROMPT_TEMPLATE_VERSION
): ReasoningRequest {
  const context = buildReasoningRequestContext(agentContext, memoryPackage, userPolicy);
  const prompt = assemblePrompt(context, templateVersion);
  return { context, prompt };
}

/** Validates a CandidateDecision, timing the validation step and logging the outcome. When
 *  `context` is supplied, also enforces that `decision.protocol`/`decision.asset` fall within
 *  the effective allowed sets (AgentContext.policy intersected with UserPolicy) — omit only for
 *  shape-only validation (e.g. replay/audit tooling with no live ReasoningContext). */
export function validateDecision(decision: CandidateDecision, context?: ReasoningContext): DecisionValidationResult {
  const start = performance.now();
  const result = validateCandidateDecision(decision, context ? deriveAllowedPolicy(context) : undefined);
  const durationMs = performance.now() - start;
  log('validation', { decisionId: decision?.decisionId, durationMs, ok: result.ok, errorCount: result.errors.length });
  return result;
}

/**
 * End-to-end reasoning run (Phase 2): builds the ReasoningContext + Prompt, invokes the given
 * ReasoningProvider, then validates the resulting CandidateDecision. Fails closed — an invalid
 * decision is never returned, only thrown as part of `validateDecision`'s result via the caller
 * checking `.ok`. The orchestrator never inspects `provider.name` beyond logging it; provider
 * selection and configuration live entirely in providers/factory.ts + providers/config.ts.
 */
export async function runReasoning(
  agentContext: AgentContext,
  memoryPackage: MemoryPackage,
  userPolicy: UserPolicy,
  provider: ReasoningProvider,
  templateVersion: string = PROMPT_TEMPLATE_VERSION
): Promise<{ context: ReasoningContext; prompt: Prompt; decision: CandidateDecision; validation: DecisionValidationResult }> {
  const { context, prompt } = buildReasoningRequest(agentContext, memoryPackage, userPolicy, templateVersion);

  const start = performance.now();
  const decision = await provider.generateDecision(context, prompt);
  const durationMs = performance.now() - start;
  log('provider_invocation', { agentId: context.meta.agentId, provider: provider.name, durationMs, decisionId: decision.decisionId });

  const validation = validateDecision(decision, context);
  return { context, prompt, decision, validation };
}
