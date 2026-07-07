// Public surface of the Blend protocol adapter.
export { createBlendAdapter, BlendExecutionNotImplementedError, BLEND_ADAPTER_VERSION, NATIVE_ASSET, DEFAULT_FEE_RATE_PCT } from './adapter.js';
export { getBlendPoolContractId, getSorobanRpcUrl, getMinHealthFactor } from './config.js';
export { hashTransaction } from './hashing.js';
export { BLEND_ACTIONS } from './types.js';
export { createDeterministicBlendPoolClient, createDeterministicSorobanRpcClient } from './testDoubles.js';

export type { BlendAdapterOptions } from './adapter.js';
export type { BlendNetwork } from './config.js';
export type {
  BlendAction,
  ReserveData,
  DepositResult,
  WithdrawResult,
  BorrowResult,
  RepayResult,
  UserPosition,
  BlendPoolClient,
  SorobanRpcClient,
} from './types.js';
