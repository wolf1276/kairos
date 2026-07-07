// Ollama provider — a locally-hosted Ollama instance (reached over the internet via a Cloudflare
// Tunnel + auth-proxy on a separate machine), which exposes an OpenAI-compatible Chat Completions
// endpoint. Reuses the same shared request logic as OpenAiProvider/OpenRouterProvider/
// NvidiaProvider (openAiCompatible.ts) — only the base URL and default model differ.
//
// Ollama itself has no auth of its own; `apiKey` here is actually the shared secret the
// auth-proxy in front of the tunnel expects via `Authorization: Bearer <secret>`, which
// openAiCompatible.ts already sends unmodified.
import { BaseProvider } from './baseProvider.js';
import { requestOpenAiCompatibleChatCompletion } from './openAiCompatible.js';
import type { Prompt } from '../types.js';
import type { ProviderName, RawProviderResponse } from './types.js';

// Fallback for local dev without a tunnel. In deployment, OLLAMA_BASE_URL is always set via env
// to the stable relay URL, so this.config.baseUrl always wins.
export const OLLAMA_BASE_URL = 'http://localhost:11434/v1';

export class OllamaProvider extends BaseProvider {
  readonly name = 'ollama';
  protected readonly providerName: ProviderName = 'ollama';

  protected async doRequest(prompt: Prompt, signal: AbortSignal): Promise<RawProviderResponse> {
    return requestOpenAiCompatibleChatCompletion({
      baseUrl: this.config.baseUrl ?? OLLAMA_BASE_URL,
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
