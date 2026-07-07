// Bridges the real Soroswap Soroban integration (`protocolAdapters/soroswap/
// realTransactionBuilder.ts`) into a `RealTransactionProvider` — same pattern as
// `aquariusProvider.ts`. See `protocolAdapters/soroswap/invocation.ts`'s header for this
// integration's ABI-confidence caveat (real XDR construction against a documented-but-not-live-
// verified router interface).
import { buildRealSoroswapTransaction } from '../../protocolAdapters/soroswap/index.js';
import type { AssetResolver, SoroswapNetwork } from '../../protocolAdapters/soroswap/index.js';
import type { TransactionBuilder } from '../../protocolAdapters/types.js';
import type { RealTransactionProvider } from './types.js';

export interface SoroswapRealProviderOptions {
  rpcUrl: string;
  sourceAccountPublicKey: string;
  assetResolver: AssetResolver;
}

export function createSoroswapRealTransactionProvider(options: SoroswapRealProviderOptions): RealTransactionProvider {
  return async (tx: TransactionBuilder) => {
    if (tx.protocol !== 'soroswap') {
      return { success: false, errors: [`Soroswap real transaction provider cannot handle protocol '${tx.protocol}'`] };
    }
    const detail = await buildRealSoroswapTransaction(tx.contractId, tx.method, tx.args, tx.network as SoroswapNetwork, {
      rpcUrl: options.rpcUrl,
      sourceAccountPublicKey: options.sourceAccountPublicKey,
      assetResolver: options.assetResolver,
    });
    if (!detail.success) return { success: false, errors: detail.simulationErrors };
    return { success: true, unsignedXdr: detail.unsignedXdr, resourceEstimate: detail.resourceEstimate };
  };
}
