// Public surface of the Execution Engine (Phase 7). Callers import only from here.
export { executeRoute } from './engine.js';
export { createSoroswapRealTransactionProvider } from './soroswapProvider.js';
export { createBlendRealTransactionProvider } from './blendProvider.js';
export { computeSyntheticResourceEstimate, encodeSyntheticXdr } from './resourceEstimate.js';
export { hashExecutionResult, recomputeTransactionHash, hashResourceEstimate } from './hashing.js';
export { withRetry } from './retry.js';
export {
  checkRouteSelected,
  checkRouteFreshness,
  checkAdapterIdentity,
  checkTransactionWellFormed,
  checkTransactionIntegrity,
  checkSimulationWellFormed,
  checkSimulationSuccess,
  checkValidationOk,
  checkFeeEstimate,
  checkRealTransactionDetail,
} from './rules.js';
export { EXECUTION_ENGINE_VERSION, EXECUTION_RESULT_STATUSES, EXECUTION_FAILURE_REASONS, DATA_SOURCES, DEFAULT_RETRY_POLICY } from './types.js';

export type { SoroswapRealProviderOptions } from './soroswapProvider.js';
export type { BlendRealProviderOptions } from './blendProvider.js';
export type { RuleFailure } from './rules.js';
export type { RetryOutcome, RetryFailure } from './retry.js';
export type {
  ExecutionResultStatus,
  ExecutionFailureReason,
  DataSource,
  ResourceEstimate,
  ExecutionResultMetadata,
  ExecutionResult,
  RetryPolicy,
  RealTransactionProvider,
  ExecuteRouteOptions,
} from './types.js';
