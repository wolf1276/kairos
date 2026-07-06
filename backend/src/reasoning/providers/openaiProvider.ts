// OpenAI provider. Uses Chat Completions with strict JSON-schema structured output so the
// response is never parsed as natural language. Request/response handling lives in
// openAiCompatible.ts, shared with OpenRouterProvider (an OpenAI-compatible API).
import { BaseProvider } from './baseProvider.js';
import { requestOpenAiCompatibleChatCompletion } from './openAiCompatible.js';
import type { Prompt } from '../types.js';
import type { ProviderName, RawProviderResponse } from './types.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export class OpenAiProvider extends BaseProvider {
  readonly name = 'openai';
  protected readonly providerName: ProviderName = 'openai';

  protected async doRequest(prompt: Prompt, signal: AbortSignal): Promise<RawProviderResponse> {
    return requestOpenAiCompatibleChatCompletion({
      baseUrl: this.config.baseUrl ?? DEFAULT_BASE_URL,
      apiKey: this.config.apiKey,
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      structuredOutput: this.config.structuredOutput,
      prompt,
      signal,
      providerName: this.providerName,
    });
  }
}
