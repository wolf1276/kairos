// Wires the real router/Soroban RPC clients into `createAquariusAdapter()` — the same factory
// used with test doubles, unchanged. This is the only file that assembles "real mode"; nothing
// in `adapter.ts` needed to change to support it.
import { createAquariusAdapter } from './adapter.js';
import { createRealAquariusRouterClient } from './realRouterClient.js';
import { createRealSorobanRpcClient } from './realSorobanRpcClient.js';
import { getAquariusBackendApiUrl, getSorobanRpcUrl, getAquariusSimulationSourceAccount } from './config.js';
import type { ProtocolAdapter } from '../adapter.js';
import type { AquariusNetwork } from './config.js';

export interface ProductionAquariusAdapterOptions {
  supportedAssets: string[];
  network?: AquariusNetwork;
  maxSlippagePct?: number;
  feeRatePct?: number;
}

/** Builds a real (non-test-double) Aquarius adapter: real Soroban RPC simulation against the
 *  live router, real pool discovery via the Aquarius backend API. Still simulation-only —
 *  `execute()` throws, per this integration's explicit scope. */
export function createProductionAquariusAdapter(options: ProductionAquariusAdapterOptions): ProtocolAdapter {
  const network = options.network ?? 'testnet';
  const backendApiBaseUrl = getAquariusBackendApiUrl(network);
  const rpcUrl = getSorobanRpcUrl(network);
  const sourceAccountPublicKey = getAquariusSimulationSourceAccount();

  return createAquariusAdapter({
    supportedAssets: options.supportedAssets,
    maxSlippagePct: options.maxSlippagePct,
    feeRatePct: options.feeRatePct,
    routerClient: createRealAquariusRouterClient({ rpcUrl, sourceAccountPublicKey, backendApiBaseUrl }),
    sorobanRpcClient: createRealSorobanRpcClient({ rpcUrl, sourceAccountPublicKey, backendApiBaseUrl }),
    // No backendApiClient: the real backend API can only prove route *existence*, never a
    // trustworthy output amount (see realBackendApi.ts) — the adapter's own on-chain fallback in
    // resolveSwapRoute() already gives a real, simulated amount, so wiring a route-existence-only
    // client here would add a network round trip without changing behavior.
  });
}
