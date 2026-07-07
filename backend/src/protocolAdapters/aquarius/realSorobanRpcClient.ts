// Real SorobanRpcClient — replaces the deterministic test double. This is the one Soroban RPC
// touchpoint `aquarius/adapter.ts::simulate()` already calls
// (`options.sorobanRpcClient.simulateTransaction(contractId, method, args, network)`) — no change
// to the adapter's own call site was needed; only what's injected changes. Simulation only, never
// submission, per this adapter's execute()-is-out-of-scope boundary.
import { simulateRouterCall } from './invocation.js';
import { createAssetPoolRegistry, type AssetPoolRegistry } from './realBackendApi.js';
import type { SorobanRpcClient } from './types.js';
import type { AquariusNetwork } from './config.js';

export interface RealSorobanRpcClientOptions {
  rpcUrl: string;
  sourceAccountPublicKey: string;
  backendApiBaseUrl: string;
}

export function createRealSorobanRpcClient(options: RealSorobanRpcClientOptions): SorobanRpcClient {
  const registry: AssetPoolRegistry = createAssetPoolRegistry({ baseUrl: options.backendApiBaseUrl });

  return {
    async simulateTransaction(contractId: string, method: string, args: Record<string, unknown>, network: string) {
      if (method === 'get_pools') {
        // POOL_DISCOVERY never builds a router method call (see ROUTER_METHOD_BY_ACTION in
        // adapter.ts — its method is `null`), so this branch is unreachable through the adapter
        // today; kept only so a direct caller of this client for pool discovery still gets a
        // real, well-formed (if trivial) response instead of an opaque error.
        return { success: true, cost: '0', result: {}, errors: [] };
      }
      const result = await simulateRouterCall(contractId, method, args, network as AquariusNetwork, {
        rpcUrl: options.rpcUrl,
        sourceAccountPublicKey: options.sourceAccountPublicKey,
        registry,
      });
      return {
        success: result.success,
        cost: result.costCpuInsns,
        result: result.success ? ({ retval: result.retval } as Record<string, unknown>) : {},
        errors: result.errors,
      };
    },
  };
}
