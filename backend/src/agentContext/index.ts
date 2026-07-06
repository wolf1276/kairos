// Public surface of the Context Layer — future agents import only from here, never reaching
// into decisionEngine/positionService/portfolioService/etc directly.
export { buildAgentContext, refreshAgentContext, AGENT_CONTEXT_SCHEMA_VERSION } from './contextBuilder.js';
export { buildFeatureSet, buildFeatureResult } from './featureEngine.js';
export { classifyRegime } from './regimeDetector.js';
export { validateAgentContext } from './validation.js';
export {
  getFeatureCacheProvider,
  setFeatureCacheProvider,
  resetFeatureCacheProvider,
  InMemoryFeatureCacheProvider,
} from './cache/index.js';
export type { FeatureCacheProvider, CachedFeatureResult } from './cache/types.js';
export type { AgentContext, FeatureSet, ContextMeta, ContextQuality } from './types.js';
export type { RegimeClassification, ExtendedRegimeLabel } from './regimeDetector.js';
export type { MarketContextView } from './domains/marketContext.js';
export type { ManagedCapitalContextView, PendingExecutionSummary } from './domains/capitalContext.js';
export type { PolicyContextView } from './domains/policyContext.js';
export type { SystemContextView } from './domains/systemContext.js';
export type { HistoricalContextView } from './domains/historicalContext.js';
export type { ContextValidationResult } from './validation.js';
