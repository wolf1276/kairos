// Deterministic hashing for the Protocol Adapter Framework — reuses the same
// SHA-256-over-stableStringify technique as the rest of the codebase (read-only import of the
// frozen Reasoning Engine's `sha256` helper; nothing in `reasoning/` is modified by this file).
import { sha256 } from '../reasoning/hashing.js';
import type { ProtocolCapabilities, SimulationResult } from './types.js';

/** Hashes a capability set — order-independent for the array fields (sorted before hashing) so
 *  two capability declarations that list the same actions/assets/networks in different order
 *  hash identically. */
export function hashCapabilities(capabilities: ProtocolCapabilities): string {
  const canonical = {
    ...capabilities,
    supportedActions: [...capabilities.supportedActions].sort(),
    supportedAssets: [...capabilities.supportedAssets].sort(),
    supportedNetworks: [...capabilities.supportedNetworks].sort(),
  };
  return sha256(canonical);
}

/** Hashes an adapter's identity as declared at registration time: protocol + version + capability
 *  hash. Excludes `registeredAt` (wall-clock, non-deterministic) so re-registering the same
 *  adapter (protocol/version/capabilities unchanged) always produces the same `adapterHash`. */
export function hashAdapter(protocol: string, version: string, capabilityHash: string): string {
  return sha256({ protocol, version, capabilityHash });
}

/** Hashes a SimulationResult's deterministic content — excludes nothing else, since
 *  SimulationResult carries no wall-clock/random fields itself; the caller must exclude the
 *  `simulationHash` field itself before calling (self-reference), the same discipline used by
 *  `hashExecutionPlan`/`hashExecutionResult` elsewhere in this codebase. */
export function hashSimulationResult(result: Omit<SimulationResult, 'simulationHash'>): string {
  return sha256(result);
}
