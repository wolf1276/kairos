// Model Interface — the provider abstraction future LLM integrations (OpenAI, Claude, Gemini,
// DeepSeek, ...) will implement. No implementation lives here: no HTTP, no SDK, no LLM calls.
// Phase 2 introduces concrete providers behind this interface.
import type { ReasoningContext, Prompt, CandidateDecision } from './types.js';

export interface ReasoningProvider {
  /** Name of the provider implementation, stamped into CandidateDecisionMetadata.providerVersion
   *  by whatever orchestration invokes it. */
  readonly name: string;
  generateDecision(context: ReasoningContext, prompt: Prompt): Promise<CandidateDecision>;
}
