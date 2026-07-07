// Bridges the real Blend Soroban integration (`protocolAdapters/blend/realTransactionBuilder.ts`)
// into a `RealTransactionProvider` — same pattern as `phoenixProvider.ts`/`aquariusProvider.ts`/
// `soroswapProvider.ts`. Unlike Phoenix, Blend has a real, official testnet deployment (see
// `protocolAdapters/blend/invocation.ts`'s header).
import { buildRealBlendTransaction } from '../../protocolAdapters/blend/index.js';
import type { AssetResolver, BlendNetwork } from '../../protocolAdapters/blend/index.js';
import type { BlendAction } from '../../protocolAdapters/blend/index.js';
import type { TransactionBuilder } from '../../protocolAdapters/types.js';
import type { RealTransactionProvider } from './types.js';

export interface BlendRealProviderOptions {
  rpcUrl: string;
  sourceAccountPublicKey: string;
  assetResolver: AssetResolver;
}

export function createBlendRealTransactionProvider(options: BlendRealProviderOptions): RealTransactionProvider {
  return async (tx: TransactionBuilder) => {
    if (tx.protocol !== 'blend') {
      return { success: false, errors: [`Blend real transaction provider cannot handle protocol '${tx.protocol}'`] };
    }
    const detail = await buildRealBlendTransaction(tx.contractId, tx.action as BlendAction, tx.args, tx.network as BlendNetwork, {
      rpcUrl: options.rpcUrl,
      sourceAccountPublicKey: options.sourceAccountPublicKey,
      assetResolver: options.assetResolver,
    });
    if (!detail.success) return { success: false, errors: detail.simulationErrors };
    return { success: true, unsignedXdr: detail.unsignedXdr, resourceEstimate: detail.resourceEstimate };
  };
}
