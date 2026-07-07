// Bridges the real Aquarius Soroban integration (`protocolAdapters/aquarius/
// realTransactionBuilder.ts`) into a `RealTransactionProvider` the Execution Engine can use via
// `ExecuteRouteOptions.realTransactionProviders`. Lives here, not in `protocolAdapters/aquarius/`
// — it depends on this engine's own `RealTransactionProvider` shape, so putting it in the
// Protocol Layer would mean the (frozen) Protocol Layer depending on Phase 7, backwards. The
// Protocol Layer itself is untouched by this file; it only imports what Aquarius's real
// integration already exports.
import { buildRealAquariusTransaction, createAssetPoolRegistry } from '../../protocolAdapters/aquarius/index.js';
import type { AquariusNetwork } from '../../protocolAdapters/aquarius/index.js';
import type { TransactionBuilder } from '../../protocolAdapters/types.js';
import type { RealTransactionProvider } from './types.js';

export interface AquariusRealProviderOptions {
  rpcUrl: string;
  sourceAccountPublicKey: string;
  backendApiBaseUrl: string;
}

/** Only handles `TransactionBuilder`s with `protocol: 'aquarius'` — returns a structured failure
 *  (never throws) for anything else, so a misconfigured `realTransactionProviders` map fails
 *  closed rather than silently producing a wrong-protocol XDR. */
export function createAquariusRealTransactionProvider(options: AquariusRealProviderOptions): RealTransactionProvider {
  const registry = createAssetPoolRegistry({ baseUrl: options.backendApiBaseUrl });

  return async (tx: TransactionBuilder) => {
    if (tx.protocol !== 'aquarius') {
      return { success: false, errors: [`Aquarius real transaction provider cannot handle protocol '${tx.protocol}'`] };
    }
    const detail = await buildRealAquariusTransaction(tx.contractId, tx.method, tx.args, tx.network as AquariusNetwork, {
      rpcUrl: options.rpcUrl,
      sourceAccountPublicKey: options.sourceAccountPublicKey,
      registry,
    });
    if (!detail.success) return { success: false, errors: detail.simulationErrors };
    return { success: true, unsignedXdr: detail.unsignedXdr, resourceEstimate: detail.resourceEstimate };
  };
}
