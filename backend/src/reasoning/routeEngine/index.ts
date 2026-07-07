// Public surface of the Route Engine. Callers import only from here.
export { computeRoute, RouteRequestValidationError } from './routeEngine.js';
export { routeRequestsFromPlan, computeRoutesForPlan } from './planAdapter.js';
export { discoverCandidates, adapterActionFor } from './discovery.js';
export { evaluateCandidate } from './quoting.js';
export { rankCandidates, scoreCandidateQuote, WEIGHT_OUTPUT, WEIGHT_FEE, WEIGHT_SLIPPAGE, WEIGHT_LIQUIDITY, WEIGHT_COMPLEXITY, DEGRADED_HEALTH_PENALTY } from './ranking.js';
export {
  checkHealth,
  checkValidation,
  checkSimulation,
  checkQuoteFreshness,
  checkAdapterSpoofing,
  checkProtocolSpoofing,
  checkForgedQuote,
  checkManipulatedFee,
  checkManipulatedSlippage,
  checkUnsupportedAsset,
  checkUnsupportedAction,
  checkDuplicate,
} from './rules.js';
export { hashCandidateQuoteFields, hashRouteRequest, hashExecutionRoute, hashRanking } from './hashing.js';
export { ROUTE_ENGINE_VERSION, ROUTE_ACTIONS, ROUTE_REJECTION_REASONS } from './types.js';

export type { DiscoveredCandidate } from './discovery.js';
export type { QuoteOutcome } from './quoting.js';
export type { PlanRouteRequestOptions } from './planAdapter.js';
export type {
  RouteAction,
  RouteRequest,
  RouteRejectionReason,
  RouteRejection,
  CandidateQuote,
  RouteCandidate,
  RankedCandidate,
  ExecutionRouteMetadata,
  ExecutionRoute,
  RouteEngineOptions,
} from './types.js';
