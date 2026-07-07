// Maps a provider name to its constructor. New providers register here only — the factory and
// orchestrator never branch on provider name themselves.
import { OpenAiProvider } from './openaiProvider.js';
import { AnthropicProvider } from './anthropicProvider.js';
import { DeepSeekProvider } from './deepseekProvider.js';
import { OpenRouterProvider } from './openrouterProvider.js';
import { NvidiaProvider } from './nvidiaProvider.js';
import { OllamaProvider } from './ollamaProvider.js';
import type { BaseProvider } from './baseProvider.js';
import type { ProviderCallConfig, ProviderName } from './types.js';

type ProviderConstructor = new (config: ProviderCallConfig) => BaseProvider;

const PROVIDER_REGISTRY: Record<ProviderName, ProviderConstructor> = {
  openai: OpenAiProvider,
  anthropic: AnthropicProvider,
  deepseek: DeepSeekProvider,
  openrouter: OpenRouterProvider,
  nvidia: NvidiaProvider,
  ollama: OllamaProvider,
};

export function getProviderConstructor(name: ProviderName): ProviderConstructor {
  const ctor = PROVIDER_REGISTRY[name];
  if (!ctor) throw new Error(`No provider registered for: ${name}`);
  return ctor;
}
