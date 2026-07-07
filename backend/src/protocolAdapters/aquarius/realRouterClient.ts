// Real AquariusRouterClient — replaces the deterministic test double for production use.
// Verified live during development (see architecture doc): `listPools` against the real backend
// API, and `quoteSwapChained`/`quoteDeposit`/`quoteWithdraw`/`quoteClaimRewards` via real
// `simulateTransaction` calls against the live Aquarius Router on Stellar testnet
// (CBCFTQSPDBAIZ6R6PJQKSQWKNKWH2QIV3I4J72SHWBIK3ADRRAM5A6GD). No transaction is ever submitted —
// simulation only, matching this adapter's explicit execution-out-of-scope boundary.
import { simulateRouterCall, fromStroops } from './invocation.js';
import { createAssetPoolRegistry, type AssetPoolRegistry } from './realBackendApi.js';
import { getAquariusRouterContractId } from './config.js';
import type { AquariusRouterClient, PoolInfo, RouteResult } from './types.js';
import type { AquariusNetwork } from './config.js';

export interface RealRouterClientOptions {
  rpcUrl: string;
  sourceAccountPublicKey: string;
  backendApiBaseUrl: string;
}

export function createRealAquariusRouterClient(options: RealRouterClientOptions): AquariusRouterClient {
  const registry: AssetPoolRegistry = createAssetPoolRegistry({ baseUrl: options.backendApiBaseUrl });

  async function call(routerContractId: string, method: string, args: Record<string, unknown>, network: AquariusNetwork) {
    const result = await simulateRouterCall(routerContractId, method, args, network, {
      rpcUrl: options.rpcUrl,
      sourceAccountPublicKey: options.sourceAccountPublicKey,
      registry,
    });
    if (!result.success) throw new Error(`Aquarius Router simulation failed for '${method}': ${result.errors.join('; ')}`);
    return result.retval;
  }

  return {
    async listPools(_network: string): Promise<PoolInfo[]> {
      return registry.listPools();
    },

    async quoteSwapChained(path: string[], amount: string, network: string): Promise<RouteResult> {
      const contractId = getAquariusRouterContractId(network as AquariusNetwork);
      const retval = (await call(contractId, 'swap_chained', { path, amount, minOutput: '0' }, network as AquariusNetwork)) as bigint;
      return { path, estimatedOutput: fromStroops(retval), priceImpactPct: 0 };
    },

    async quoteDeposit(assetA: string, assetB: string, amount: string, network: string) {
      const contractId = getAquariusRouterContractId(network as AquariusNetwork);
      const retval = (await call(contractId, 'deposit', { assetA, assetB, amount }, network as AquariusNetwork)) as [bigint[], bigint];
      return { estimatedLpTokens: fromStroops(retval[1]), priceImpactPct: 0 };
    },

    async quoteWithdraw(poolId: string, amount: string, network: string) {
      const contractId = getAquariusRouterContractId(network as AquariusNetwork);
      const retval = (await call(contractId, 'withdraw', { poolId, amount }, network as AquariusNetwork)) as bigint[];
      return { estimatedAssetA: fromStroops(retval[0]), estimatedAssetB: fromStroops(retval[1]) };
    },

    async quoteClaimRewards(poolId: string, network: string) {
      const contractId = getAquariusRouterContractId(network as AquariusNetwork);
      const retval = (await call(contractId, 'claim_rewards', { poolId }, network as AquariusNetwork)) as bigint;
      return { estimatedRewards: fromStroops(retval), rewardAsset: 'AQUA' };
    },
  };
}
