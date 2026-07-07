// Public surface of the Phoenix protocol adapter.
export { createPhoenixAdapter, PhoenixExecutionNotImplementedError, PHOENIX_ADAPTER_VERSION, NATIVE_ASSET, DEFAULT_MAX_SLIPPAGE_PCT, DEFAULT_FEE_RATE_PCT, DEFAULT_POOL_TYPE } from './adapter.js';
export { getPhoenixMultihopContractId, getPhoenixFactoryContractId, getSorobanRpcUrl } from './config.js';
export { hashQuote, hashTransaction } from './hashing.js';
export { PHOENIX_ACTIONS, PHOENIX_POOL_TYPES } from './types.js';
export { createDeterministicMultihopClient, createDeterministicFactoryClient, createDeterministicPoolClient, createDeterministicSorobanRpcClient } from './testDoubles.js';

export type { PhoenixAdapterOptions } from './adapter.js';
export type { PhoenixNetwork } from './config.js';
export type {
  PhoenixAction,
  PhoenixPoolType,
  PoolInfo,
  SwapHop,
  MultihopSwapResult,
  PhoenixMultihopClient,
  PhoenixFactoryClient,
  ProvideLiquidityQuote,
  WithdrawLiquidityQuote,
  PhoenixPoolClient,
  SorobanRpcClient,
} from './types.js';
