// Provider/model registry for the Reasoning Benchmark Framework. This is the ONE place a new
// provider or model needs to be added — no other file in benchmarks/ or src/reasoning/ changes.
// Purely additive data; reuses (never modifies) reasoning/decisionIntelligence's existing
// DecisionIntelligenceProviderConfig shape.
import type { DecisionIntelligenceProviderConfig, DecisionIntelligenceProviderName } from '../../../src/reasoning/decisionIntelligence/requestClient.js';

export interface RegisteredModel {
  /** Stable id used for --model filtering and report labeling, e.g. "nvidia-glm-5.2". */
  id: string;
  provider: DecisionIntelligenceProviderName;
  model: string;
  /** Env var holding the API key. If unset or empty, the runner skips this entry with a warning
   *  rather than failing the whole benchmark run. */
  apiKeyEnvVar: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
  structuredOutput?: boolean;
  baseUrl?: string;
}

/**
 * To add a new provider or model: add one entry here. Nothing else in benchmarks/ needs to
 * change — the runner, scoring, and reports all iterate this list generically.
 */
export const PROVIDER_REGISTRY: RegisteredModel[] = [
  { id: 'openai-gpt-4o-mini', provider: 'openai', model: 'gpt-4o-mini', apiKeyEnvVar: 'OPENAI_API_KEY' },
  { id: 'anthropic-claude-sonnet-5', provider: 'anthropic', model: 'claude-sonnet-5', apiKeyEnvVar: 'ANTHROPIC_API_KEY' },
  { id: 'deepseek-chat', provider: 'deepseek', model: 'deepseek-chat', apiKeyEnvVar: 'DEEPSEEK_API_KEY' },
  { id: 'nvidia-glm-5.2', provider: 'nvidia', model: 'z-ai/glm-5.2', apiKeyEnvVar: 'NVIDIA_API_KEY', timeoutMs: 80000, maxTokens: 4000 },
  {
    id: 'huggingface-llama-3.1-8b',
    provider: 'huggingface',
    model: 'meta-llama/Llama-3.1-8B-Instruct',
    apiKeyEnvVar: 'HUGGINGFACE_API_KEY',
    timeoutMs: 40000,
    maxTokens: 4000,
    // This model's backend doesn't support json_schema (confirmed live) — requestClient.ts
    // already falls back to json_object for any provider not on its JSON_SCHEMA_CAPABLE_PROVIDERS
    // allowlist, so no special-casing is needed here.
  },
];

const DEFAULTS = {
  temperature: 0,
  maxTokens: 2000,
  timeoutMs: 45000,
  maxRetries: 1,
  structuredOutput: true,
};

export interface ResolvedModel extends RegisteredModel {
  apiKey: string;
}

/** Resolves API keys from env for every registered model, skipping (with a console warning) any
 *  entry whose key is missing. Never throws — a benchmark run should proceed with whatever
 *  providers are actually configured in this environment. */
export function resolveConfiguredModels(registry: RegisteredModel[] = PROVIDER_REGISTRY): ResolvedModel[] {
  const resolved: ResolvedModel[] = [];
  for (const entry of registry) {
    const apiKey = process.env[entry.apiKeyEnvVar];
    if (!apiKey) {
      console.warn(`[benchmark] skipping ${entry.id}: ${entry.apiKeyEnvVar} is not set`);
      continue;
    }
    resolved.push({ ...entry, apiKey });
  }
  return resolved;
}

export function toProviderConfig(model: ResolvedModel): DecisionIntelligenceProviderConfig {
  return {
    provider: model.provider,
    model: model.model,
    apiKey: model.apiKey,
    temperature: model.temperature ?? DEFAULTS.temperature,
    maxTokens: model.maxTokens ?? DEFAULTS.maxTokens,
    timeoutMs: model.timeoutMs ?? DEFAULTS.timeoutMs,
    maxRetries: model.maxRetries ?? DEFAULTS.maxRetries,
    structuredOutput: model.structuredOutput ?? DEFAULTS.structuredOutput,
    baseUrl: model.baseUrl,
  };
}
