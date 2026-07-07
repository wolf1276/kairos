// Builds a fully in-memory, zero-network ProtocolRegistry for the E2E pipeline harnesses, using
// the soroswap adapter's own deterministic test doubles (src/protocolAdapters/soroswap/testDoubles.ts) —
// the same fakes its own unit tests use. No real Soroban RPC / router contract is ever touched.
import { ProtocolRegistry } from '../../src/protocolAdapters/registry.js';
import { createSoroswapAdapter, createDeterministicRouterClient, createDeterministicSorobanRpcClient } from '../../src/protocolAdapters/soroswap/index.js';
import { FIXTURE_ASSET, FIXTURE_OUTPUT_ASSET } from './fixtures.js';

// The soroswap adapter reads its router contract id from env (never hardcoded — see
// protocolAdapters/soroswap/config.ts) even when only ever driven through deterministic test
// doubles; this harness never touches a real network, so a fixed placeholder id is sufficient.
process.env.SOROSWAP_ROUTER_CONTRACT_ID_TESTNET ??= 'CA' + 'E2E'.repeat(18);

export interface RegistryFaultOptions {
  /** Simulate the protocol's Soroban RPC being unavailable/unhealthy. */
  simulationFails?: boolean;
  /** Remove the adapter entirely — used by the "provider unavailable" fault scenario. */
  unregisterAfterBuild?: boolean;
}

export function buildProtocolRegistry(options: RegistryFaultOptions = {}): ProtocolRegistry {
  const registry = new ProtocolRegistry();
  const adapter = createSoroswapAdapter({
    supportedAssets: [FIXTURE_ASSET, FIXTURE_OUTPUT_ASSET],
    routerClient: createDeterministicRouterClient({ rates: { [`${FIXTURE_ASSET}->${FIXTURE_OUTPUT_ASSET}`]: 0.12 } }),
    sorobanRpcClient: createDeterministicSorobanRpcClient({ success: !options.simulationFails }),
  });
  registry.register(adapter);
  if (options.unregisterAfterBuild) registry.unregister(adapter.protocol);
  return registry;
}
