// Discovery: finds every protocol adapter registered in a ProtocolRegistry capable of executing
// a requested RouteAction. Deterministic — always returns candidates sorted by protocol name, so
// downstream ranking never depends on registry insertion order.
import type { ProtocolAdapter } from '../../protocolAdapters/adapter.js';
import type { ProtocolMetadata } from '../../protocolAdapters/types.js';
import type { ProtocolRegistry } from '../../protocolAdapters/registry.js';
import type { RouteAction, RouteRequest } from './types.js';

/** Maps a RouteAction onto the underlying adapter action string each protocol's own vocabulary
 *  uses (AquariusAction/BlendAction/PhoenixAction/SoroswapAction). LENDING and DEPOSIT both
 *  resolve to the adapter action 'DEPOSIT' — they are distinguished by whether the adapter also
 *  declares 'BORROW' support (a true lending market) vs not (an AMM liquidity deposit); see
 *  `isEligible` below. This is what lets "lending" and "deposit" be different RouteActions even
 *  though no protocol adapter itself has a distinct 'LENDING' action string. */
const ADAPTER_ACTION_BY_ROUTE_ACTION: Record<RouteAction, string> = {
  SWAP: 'SWAP',
  MULTI_HOP_SWAP: 'SWAP_CHAINED',
  LENDING: 'DEPOSIT',
  BORROWING: 'BORROW',
  DEPOSIT: 'DEPOSIT',
  WITHDRAW: 'WITHDRAW',
  REWARD_CLAIM: 'CLAIM_REWARDS',
};

export function adapterActionFor(routeAction: RouteAction): string {
  return ADAPTER_ACTION_BY_ROUTE_ACTION[routeAction];
}

/** True if this protocol's declared capabilities make it a candidate for the requested
 *  RouteAction + asset + network. Never inspects live adapter behavior — that happens later
 *  during quoting (validate/simulate/health), so an ineligible protocol is filtered out cheaply,
 *  before any adapter call is made. */
function isEligible(metadata: ProtocolMetadata, request: RouteRequest): boolean {
  const { capabilities } = metadata;
  const adapterAction = adapterActionFor(request.action);
  if (!capabilities.supportedActions.includes(adapterAction)) return false;

  const isLendingMarket = capabilities.supportedActions.includes('BORROW');
  if (request.action === 'LENDING' && !isLendingMarket) return false;
  if (request.action === 'DEPOSIT' && isLendingMarket) return false;

  if (!capabilities.supportedNetworks.includes(request.network)) return false;
  if (!capabilities.supportedAssets.includes(request.asset)) return false;
  if ((request.action === 'SWAP' || request.action === 'MULTI_HOP_SWAP') && request.outputAsset) {
    if (!capabilities.supportedAssets.includes(request.outputAsset)) return false;
  }
  return true;
}

export interface DiscoveredCandidate {
  protocol: string;
  adapter: ProtocolAdapter;
  metadata: ProtocolMetadata;
  adapterAction: string;
}

export function discoverCandidates(request: RouteRequest, registry: ProtocolRegistry): DiscoveredCandidate[] {
  const adapterAction = adapterActionFor(request.action);
  return registry
    .list()
    .filter((metadata) => isEligible(metadata, request))
    .map((metadata) => ({
      protocol: metadata.protocol,
      adapter: registry.lookup(metadata.protocol),
      metadata,
      adapterAction,
    }))
    .sort((a, b) => a.protocol.localeCompare(b.protocol));
}
