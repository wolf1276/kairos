// Public surface of the Aquarius protocol adapter.
export { createAquariusAdapter, AquariusExecutionNotImplementedError, AQUARIUS_ADAPTER_VERSION, NATIVE_ASSET, DEFAULT_MAX_SLIPPAGE_PCT, DEFAULT_FEE_RATE_PCT } from './adapter.js';
export { getAquariusRouterContractId, getAquariusBackendApiUrl, getSorobanRpcUrl, getAquariusSimulationSourceAccount } from './config.js';
export { hashQuote, hashTransaction } from './hashing.js';
export { AQUARIUS_ACTIONS } from './types.js';
export { createDeterministicRouterClient, createDeterministicSorobanRpcClient, createDeterministicBackendApiClient } from './testDoubles.js';
export { createRealAquariusRouterClient } from './realRouterClient.js';
export { createRealSorobanRpcClient } from './realSorobanRpcClient.js';
export { createRealAquariusBackendApiClient, createAssetPoolRegistry } from './realBackendApi.js';
export { createProductionAquariusAdapter } from './production.js';
export { buildRealAquariusTransaction, verifyUnsignedXdr } from './realTransactionBuilder.js';
export { buildRouterOperation, getNetworkPassphrase, simulateRouterCall, toStroops, fromStroops } from './invocation.js';

export type { AquariusAdapterOptions } from './adapter.js';
export type { AquariusNetwork } from './config.js';
export type { AquariusAction, PoolInfo, RouteResult, AquariusRouterClient, AquariusBackendApiClient, SorobanRpcClient } from './types.js';
export type { AssetPoolRegistry } from './realBackendApi.js';
export type { RealTransactionDetail, RealResourceEstimate } from './realTransactionBuilder.js';
export type { InvocationOptions } from './invocation.js';
