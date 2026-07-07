// Public surface of the Soroswap protocol adapter.
export { createSoroswapAdapter, SoroswapExecutionNotImplementedError, SOROSWAP_ADAPTER_VERSION, NATIVE_ASSET, DEFAULT_MAX_SLIPPAGE_PCT, DEFAULT_FEE_RATE_PCT } from './adapter.js';
export { getSoroswapRouterContractId, getSorobanRpcUrl } from './config.js';
export { hashQuote, hashTransaction } from './hashing.js';
export { SOROSWAP_ACTIONS } from './types.js';
export { createDeterministicRouterClient, createDeterministicSorobanRpcClient } from './testDoubles.js';
export { buildRealSoroswapTransaction, verifyUnsignedXdr } from './realTransactionBuilder.js';
export { buildRouterOperation, getNetworkPassphrase, simulateRouterCall, toStroops } from './invocation.js';

export type { SoroswapAdapterOptions } from './adapter.js';
export type { SoroswapNetwork } from './config.js';
export type {
  SoroswapAction,
  RouteResult,
  AddLiquidityResult,
  RemoveLiquidityResult,
  SoroswapRouterClient,
  SorobanRpcClient,
} from './types.js';
export type { RealTransactionDetail, RealResourceEstimate } from './realTransactionBuilder.js';
export type { InvocationOptions, AssetResolver } from './invocation.js';
