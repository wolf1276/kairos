// Shared types for Reasoning Engine providers (Phase 2). Nothing here leaks a provider-specific
// field into CandidateDecision — this module only describes configuration, raw request/response
// shapes internal to providers/, and observability records.

export type ProviderName = 'openai' | 'anthropic' | 'deepseek' | 'openrouter' | 'nvidia';

export type ProviderErrorKind =
  | 'timeout'
  | 'invalid_json'
  | 'empty_response'
  | 'network'
  | 'authentication'
  | 'rate_limit'
  | 'provider_unavailable'
  | 'model_unavailable'
  | 'validation_failed';

/** Configuration for a single provider call. No hardcoded values — every field is supplied by
 *  the caller (ultimately sourced from env / per-agent config), with defaults only for
 *  operational knobs (timeout, retries) that are safe to default. */
export interface ProviderCallConfig {
  provider: ProviderName;
  model: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  maxRetries: number;
  structuredOutput: boolean;
  baseUrl?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Raw result of one HTTP round trip to a provider, before JSON-schema normalization into
 *  CandidateDecision. Provider-specific response fields never travel past this shape. */
export interface RawProviderResponse {
  raw: string;
  usage: TokenUsage;
  requestId: string;
  providerVersion: string;
  /** How many other models were tried and abandoned (model_unavailable/rate_limit/
   *  empty_response) before this response was obtained. 0 for providers with no model-fallback
   *  chain (OpenAI, Anthropic, DeepSeek, NVIDIA); only OpenRouterProvider ever sets this > 0. */
  fallbackCount?: number;
}

export interface ProviderObservability {
  provider: ProviderName;
  model: string;
  latencyMs: number;
  usage: TokenUsage;
  estimatedCost: number;
  retryCount: number;
  fallbackCount: number;
  timedOut: boolean;
  failed: boolean;
  errorKind?: ProviderErrorKind;
  requestId?: string;
}
