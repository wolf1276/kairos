// Public surface of the Reasoning Engine's provider layer (Phase 2). Callers outside providers/
// import only from here.
export { createProvider } from './factory.js';
export { getProviderConfigFromEnv } from './config.js';
export { getProviderMetrics, resetProviderMetrics } from './metrics.js';
export { ProviderError } from './errors.js';
export { CANDIDATE_DECISION_JSON_SCHEMA } from './schema.js';
export { OPENROUTER_BASE_URL, OPENROUTER_AUTO_MODEL } from './openrouterProvider.js';
export {
  getFreeModelIds,
  isModelFree,
  fetchOpenRouterModelRegistry,
  resetOpenRouterRegistryCache,
} from './openrouterModelRegistry.js';
export type { ClassifiedModel } from './openrouterModelRegistry.js';

export type {
  ProviderName,
  ProviderCallConfig,
  TokenUsage,
  RawProviderResponse,
  ProviderObservability,
  ProviderErrorKind,
} from './types.js';
