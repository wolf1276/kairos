// Bridges the real Phoenix Soroban integration (`protocolAdapters/phoenix/
// realTransactionBuilder.ts`) into a `RealTransactionProvider` — same pattern as
// `aquariusProvider.ts`/`soroswapProvider.ts`. See `protocolAdapters/phoenix/invocation.ts`'s
// header: source-verified against the real, tagged-release contract code, but not
// live-testnet-verified (no public deployed Phoenix testnet address could be found).
import { buildRealPhoenixTransaction } from '../../protocolAdapters/phoenix/index.js';
import type { AssetResolver, PhoenixNetwork } from '../../protocolAdapters/phoenix/index.js';
import type { TransactionBuilder } from '../../protocolAdapters/types.js';
import type { RealTransactionProvider } from './types.js';

export interface PhoenixRealProviderOptions {
  rpcUrl: string;
  sourceAccountPublicKey: string;
  assetResolver: AssetResolver;
}

export function createPhoenixRealTransactionProvider(options: PhoenixRealProviderOptions): RealTransactionProvider {
  return async (tx: TransactionBuilder) => {
    if (tx.protocol !== 'phoenix') {
      return { success: false, errors: [`Phoenix real transaction provider cannot handle protocol '${tx.protocol}'`] };
    }
    const detail = await buildRealPhoenixTransaction(tx.contractId, tx.method, tx.args, tx.network as PhoenixNetwork, {
      rpcUrl: options.rpcUrl,
      sourceAccountPublicKey: options.sourceAccountPublicKey,
      assetResolver: options.assetResolver,
    });
    if (!detail.success) return { success: false, errors: detail.simulationErrors };
    return { success: true, unsignedXdr: detail.unsignedXdr, resourceEstimate: detail.resourceEstimate };
  };
}
