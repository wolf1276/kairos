// Types for the Protocol Adapter Framework. Deterministic abstraction layer only — no blockchain
// logic, no Blend/Soroswap implementation, no Execution Engine wiring. A future Execution
// Engine consumes this layer through ProtocolRegistry; it must never import a protocol SDK
// directly, and neither does anything in this directory.
export const PROTOCOL_ADAPTER_FRAMEWORK_VERSION = '1.0.0';

export const HEALTH_STATUSES = ['READY', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

/** What one protocol adapter declares it can do. Declared once at registration and never
 *  re-derived from runtime behavior — the registry treats this as the adapter's contract, and
 *  cross-checks live behavior (e.g. `validate()`) against it rather than trusting it blindly. */
export interface ProtocolCapabilities {
  protocol: string;
  supportedActions: string[];
  supportedAssets: string[];
  supportedNetworks: string[];
  simulationSupport: boolean;
  batchingSupport: boolean;
  rollbackSupport: boolean;
}

/** One request to simulate/validate/execute/estimate against a protocol. Deliberately generic
 *  (plain strings, no dependency on Reasoning/Decision Intelligence types) — this framework is a
 *  standalone infrastructure layer, not a Reasoning Engine extension. */
export interface AdapterActionRequest {
  action: string;
  asset: string;
  network: string;
  amount: string;
  params?: Record<string, unknown>;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export interface SimulationResult {
  success: boolean;
  estimatedFees: string;
  estimatedSlippagePct: number;
  warnings: string[];
  errors: string[];
  estimatedOutputs: Record<string, string>;
  simulationHash: string;
}

export const EXECUTION_STATUSES = ['success', 'failed'] as const;
export type AdapterExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export interface AdapterExecutionResult {
  status: AdapterExecutionStatus;
  txHash: string | null;
  fees: string;
  durationMs: number;
  metadata: Record<string, unknown>;
}

/** A standardized price quote — shared shape so every adapter that supports routing/quoting
 *  (e.g. a router-based DEX aggregator) returns the same fields, instead of each adapter
 *  inventing its own. Optional on `ProtocolAdapter` (`adapter.quote`) since not every protocol
 *  (e.g. a pure lending pool) has a meaningful "quote". */
export interface Quote {
  protocol: string;
  action: string;
  inputAsset: string;
  outputAsset: string;
  inputAmount: string;
  outputAmount: string;
  route: string[];
  priceImpactPct: number;
  estimatedFees: string;
  source: 'on-chain' | 'backend-api';
  quoteHash: string;
}

/** A standardized, unsigned transaction description — deliberately not a real signed/submittable
 *  transaction envelope (no Soroban SDK dependency exists in this framework). Optional on
 *  `ProtocolAdapter` (`adapter.buildTransaction`) for protocols that support pre-building a
 *  transaction ahead of signing/submission. */
export interface TransactionBuilder {
  protocol: string;
  action: string;
  network: string;
  contractId: string;
  method: string;
  args: Record<string, unknown>;
  transactionHash: string;
}

/** Immutable, registry-held record describing a registered adapter — never the adapter instance
 *  itself. `adapterHash`/`capabilityHash` let a caller prove which exact capability set an
 *  adapter was registered with, independent of the adapter's live in-memory identity. */
export interface ProtocolMetadata {
  protocol: string;
  version: string;
  capabilities: ProtocolCapabilities;
  registeredAt: number;
  adapterHash: string;
  capabilityHash: string;
}
