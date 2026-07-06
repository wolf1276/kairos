import { KairosClient } from '../client';
import { RpcError } from '../errors';
import { PROTOCOL_REGISTRY } from './registry';
import { BlendAdapter } from './blend';
import { SoroswapAdapter } from './soroswap';
import { ProtocolAdapter, ProtocolId } from './types';

export * from './types';
export * from './registry';
export * from './blend';
export * from './soroswap';

/**
 * Resolves a typed adapter for a known protocol on the client's configured network,
 * so callers build `Execution`s from real ABI-aware helpers instead of hand-rolled ScVals.
 */
export function getAdapter(client: KairosClient, protocolId: ProtocolId): ProtocolAdapter {
  const network = client.network || 'testnet';
  const config = PROTOCOL_REGISTRY[network]?.[protocolId];
  if (!config) {
    throw new RpcError(`No protocol config for '${protocolId}' on network '${network}'`);
  }

  switch (protocolId) {
    case 'blend':
      return new BlendAdapter(config.contractId);
    case 'soroswap':
      return new SoroswapAdapter(config.contractId);
    default:
      throw new RpcError(`Unsupported protocol id: ${protocolId}`);
  }
}
