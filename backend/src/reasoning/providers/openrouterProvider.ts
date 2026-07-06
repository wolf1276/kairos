// OpenRouter provider — the only live provider that requires no OpenAI/Anthropic/DeepSeek/Gemini
// key. Reuses the OpenAI-compatible request path (openAiCompatible.ts) pointed at OpenRouter's
// endpoint, plus a free-model fallback chain sourced from openrouterModelRegistry.ts: model
// selection is never a hardcoded id, and a decision is never routed to a paid model.
import { BaseProvider } from './baseProvider.js';
import { ProviderError } from './errors.js';
import { requestOpenAiCompatibleChatCompletion } from './openAiCompatible.js';
import { getFreeModelIds, isModelFree } from './openrouterModelRegistry.js';
import type { Prompt } from '../types.js';
import type { ProviderName, RawProviderResponse } from './types.js';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/** Sentinel `REASONING_MODEL` value meaning "resolve a free model dynamically at request time" —
 *  the only "default" this provider ever hardcodes, since any specific free model id can vanish
 *  from OpenRouter's catalog without notice. */
export const OPENROUTER_AUTO_MODEL = 'auto';

/** Upper bound on how many free models one generateDecision() call will try before giving up —
 *  bounds worst-case latency/request volume if many free models are unavailable at once. Free
 *  models are rate-limited fairly often in practice, so this is intentionally higher than a
 *  single retry. */
const MAX_FALLBACK_ATTEMPTS = 8;

export class OpenRouterProvider extends BaseProvider {
  readonly name = 'openrouter';
  protected readonly providerName: ProviderName = 'openrouter';

  protected async doRequest(prompt: Prompt, signal: AbortSignal): Promise<RawProviderResponse> {
    const candidates = await this.resolveCandidateModels();
    let lastError: ProviderError | undefined;
    let fallbackCount = 0;

    for (const model of candidates.slice(0, MAX_FALLBACK_ATTEMPTS)) {
      try {
        const response = await requestOpenAiCompatibleChatCompletion({
          baseUrl: this.config.baseUrl ?? OPENROUTER_BASE_URL,
          apiKey: this.config.apiKey,
          model,
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
          structuredOutput: this.config.structuredOutput,
          prompt,
          signal,
          providerName: this.providerName,
        });
        return { ...response, fallbackCount };
      } catch (err) {
        // A model-availability failure, a rate limit, or an empty completion triggers fallback
        // to the next free model rather than retrying the same one: OpenRouter's free-tier
        // models are commonly rate-limited independently of each other (shared upstream capacity
        // per model) and some catalog entries aren't actually chat-capable (e.g. audio/image
        // models slipping through the free-pricing filter), which surfaces as an empty
        // completion. None of that says anything about whether a different free model would have
        // the same problem, and trying the next one is far more likely to succeed than retrying
        // the same model. Auth/network/timeout failures are account- or connectivity-level, not
        // model-specific, so those still propagate immediately for BaseProvider's own retry loop
        // (which re-invokes doRequest as a whole) to handle.
        if (err instanceof ProviderError && (err.kind === 'model_unavailable' || err.kind === 'rate_limit' || err.kind === 'empty_response')) {
          lastError = err;
          fallbackCount += 1;
          console.log(
            JSON.stringify({
              component: 'reasoning-engine-provider',
              event: 'model_fallback',
              provider: this.providerName,
              abandonedModel: model,
              reason: err.kind,
              fallbackCount,
            })
          );
          continue;
        }
        throw err;
      }
    }

    throw lastError ?? new ProviderError('model_unavailable', this.providerName, 'no free OpenRouter model available');
  }

  /** Builds the ordered list of models to try: the configured model first (only if the registry
   *  confirms it is currently free), then every other known-free model as fallback — sorted
   *  deterministically by openrouterModelRegistry.ts. A configured model that is paid, unknown,
   *  or unverifiable is dropped entirely rather than ever being attempted. */
  private async resolveCandidateModels(): Promise<string[]> {
    const freeModels = await getFreeModelIds(this.config.apiKey);
    if (freeModels.length === 0) {
      throw new ProviderError('provider_unavailable', this.providerName, 'no free OpenRouter models are currently available');
    }

    const configured = this.config.model;
    if (!configured || configured === OPENROUTER_AUTO_MODEL) {
      return freeModels;
    }

    const configuredIsFree = await isModelFree(this.config.apiKey, configured);
    if (!configuredIsFree) {
      return freeModels;
    }

    return [configured, ...freeModels.filter((m) => m !== configured)];
  }
}
