// Configuration for Reasoning Engine providers. Every knob is env-driven — no hardcoded model,
// temperature, timeout, or retry count anywhere in providers/.
import { OPENROUTER_AUTO_MODEL } from './openrouterProvider.js';
import type { ProviderCallConfig, ProviderName } from './types.js';

const VALID_PROVIDERS: ReadonlySet<string> = new Set(['openai', 'anthropic', 'deepseek', 'openrouter', 'nvidia']);

function readEnv(key: string): string | undefined {
  return process.env[key] || undefined;
}

function readNumberEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function readBoolEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return raw === 'true';
}

/** Resolves the API key for a provider. OpenRouter is special-cased to also accept the bare
 *  `OPENROUTER` env var (in addition to the standard `OPENROUTER_API_KEY`) since that's the
 *  variable name commonly used for OpenRouter keys in practice. */
function readApiKey(provider: ProviderName): { envVar: string; apiKey: string | undefined } {
  const envVar = `${provider.toUpperCase()}_API_KEY`;
  let apiKey = readEnv(envVar);
  if (!apiKey && provider === 'openrouter') {
    apiKey = readEnv('OPENROUTER');
  }
  return { envVar, apiKey };
}

/** Builds provider call configuration from environment. Defaults to `openrouter` — the only
 *  provider that requires no OpenAI/Anthropic/DeepSeek/Gemini key — so a fresh deployment works
 *  with just one API key. Throws if the selected provider has no API key configured — fail
 *  closed rather than silently falling back to a heuristic. */
export function getProviderConfigFromEnv(): ProviderCallConfig {
  const provider = (readEnv('REASONING_PROVIDER') || 'openrouter') as ProviderName;
  if (!VALID_PROVIDERS.has(provider)) {
    throw new Error(`Unsupported REASONING_PROVIDER: ${provider}`);
  }

  const { envVar: apiKeyEnvVar, apiKey } = readApiKey(provider);
  if (!apiKey) {
    throw new Error(`Missing env var: ${apiKeyEnvVar}`);
  }

  return {
    provider,
    model: readEnv('REASONING_MODEL') || defaultModelFor(provider),
    apiKey,
    temperature: readNumberEnv('REASONING_TEMPERATURE', 0.2),
    maxTokens: readNumberEnv('REASONING_MAX_TOKENS', 2000),
    timeoutMs: readNumberEnv('REASONING_TIMEOUT_MS', 30_000),
    maxRetries: readNumberEnv('REASONING_MAX_RETRIES', 2),
    structuredOutput: readBoolEnv('REASONING_STRUCTURED_OUTPUT', true),
    baseUrl: readEnv(`${provider.toUpperCase()}_BASE_URL`),
  };
}

function defaultModelFor(provider: ProviderName): string {
  switch (provider) {
    case 'openai':
      return 'gpt-4o-mini';
    case 'anthropic':
      return 'claude-sonnet-5';
    case 'deepseek':
      return 'deepseek-chat';
    case 'openrouter':
      // Never a specific hardcoded model id — resolved dynamically against the free-model
      // registry at request time (see openrouterProvider.ts::resolveCandidateModels).
      return OPENROUTER_AUTO_MODEL;
    case 'nvidia':
      return 'z-ai/glm-5.2';
  }
}
