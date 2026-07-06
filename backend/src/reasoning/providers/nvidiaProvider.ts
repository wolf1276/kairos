// NVIDIA provider — NVIDIA's hosted inference API (integrate.api.nvidia.com), which exposes an
// OpenAI-compatible Chat Completions endpoint. Reuses the same shared request logic as
// OpenAiProvider/OpenRouterProvider (openAiCompatible.ts) — only the base URL and default model
// differ.
import { BaseProvider } from './baseProvider.js';
import { requestOpenAiCompatibleChatCompletion } from './openAiCompatible.js';
import type { Prompt } from '../types.js';
import type { ProviderName, RawProviderResponse } from './types.js';

export const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

export class NvidiaProvider extends BaseProvider {
  readonly name = 'nvidia';
  protected readonly providerName: ProviderName = 'nvidia';

  protected async doRequest(prompt: Prompt, signal: AbortSignal): Promise<RawProviderResponse> {
    return requestOpenAiCompatibleChatCompletion({
      baseUrl: this.config.baseUrl ?? NVIDIA_BASE_URL,
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
