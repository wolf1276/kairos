// AdapterFactory: builds a ProtocolAdapter from a declarative spec, so every adapter (including
// future real Blend/Soroswap integrations, and every test double in this framework's own
// test suite) gets the same default validation/health/simulate wiring instead of hand-rolling it.
// No blockchain logic here — defaults are pure, deterministic, in-memory behavior only.
import { randomUUID } from 'crypto';
import { hashSimulationResult } from './hashing.js';
import type { ProtocolAdapter } from './adapter.js';
import type {
  ProtocolCapabilities,
  AdapterActionRequest,
  ValidationResult,
  SimulationResult,
  AdapterExecutionResult,
  HealthStatus,
} from './types.js';

export interface AdapterSpec {
  protocol: string;
  version: string;
  capabilities: ProtocolCapabilities;
  /** Required `params` keys per action, e.g. `{ SWAP: ['minOutput'] }`. Actions not listed have
   *  no required params beyond action/asset/network/amount. */
  requiredParams?: Record<string, string[]>;
  onInitialize?: () => Promise<void>;
  onHealth?: () => Promise<HealthStatus> | HealthStatus;
  onEstimateFees?: (request: AdapterActionRequest) => Promise<string> | string;
  onEstimateSlippage?: (request: AdapterActionRequest) => Promise<number> | number;
  onSimulate?: (request: AdapterActionRequest) => Promise<Partial<SimulationResult>> | Partial<SimulationResult>;
  onExecute?: (request: AdapterActionRequest) => Promise<Partial<AdapterExecutionResult>> | Partial<AdapterExecutionResult>;
}

/** Default request validation: supported action/asset/network membership + required-params
 *  presence, all derived from the spec's own declared capabilities — never assumes upstream
 *  (Execution Engine / Registry) already checked this, matching the fail-closed, re-derive-
 *  everything discipline used throughout this codebase's Reasoning Engine. */
function defaultValidate(capabilities: ProtocolCapabilities, requiredParams: Record<string, string[]>, request: AdapterActionRequest): ValidationResult {
  const errors: string[] = [];
  if (!capabilities.supportedActions.includes(request.action)) errors.push(`action '${request.action}' is not supported by '${capabilities.protocol}'`);
  if (!capabilities.supportedAssets.includes(request.asset)) errors.push(`asset '${request.asset}' is not supported by '${capabilities.protocol}'`);
  if (!capabilities.supportedNetworks.includes(request.network)) errors.push(`network '${request.network}' is not supported by '${capabilities.protocol}'`);
  const required = requiredParams[request.action] ?? [];
  for (const key of required) {
    if (!request.params || !(key in request.params)) errors.push(`action '${request.action}' requires param '${key}'`);
  }
  return { ok: errors.length === 0, errors };
}

/** Thrown at build time (not registration time) when a spec's own `protocol` and
 *  `capabilities.protocol` disagree — silently normalizing one to the other would hide a real
 *  config bug in a future adapter, so the factory fails loud instead. */
export class AdapterSpecMismatchError extends Error {
  constructor(protocol: string, capabilitiesProtocol: string) {
    super(`AdapterSpec.protocol ('${protocol}') does not match AdapterSpec.capabilities.protocol ('${capabilitiesProtocol}') — fix the spec, the factory will not silently reconcile them.`);
    this.name = 'AdapterSpecMismatchError';
  }
}

export function createAdapter(spec: AdapterSpec): ProtocolAdapter {
  if (spec.capabilities.protocol !== spec.protocol) throw new AdapterSpecMismatchError(spec.protocol, spec.capabilities.protocol);
  const requiredParams = spec.requiredParams ?? {};
  const capabilities: ProtocolCapabilities = { ...spec.capabilities };

  const adapter: ProtocolAdapter = {
    protocol: spec.protocol,
    version: spec.version,

    async initialize() {
      if (spec.onInitialize) await spec.onInitialize();
    },

    async health() {
      if (spec.onHealth) return spec.onHealth();
      return 'READY';
    },

    capabilities() {
      return capabilities;
    },

    async validate(request) {
      return defaultValidate(capabilities, requiredParams, request);
    },

    async estimateFees(request) {
      if (spec.onEstimateFees) return spec.onEstimateFees(request);
      return '0.000000';
    },

    async estimateSlippage(request) {
      if (spec.onEstimateSlippage) return spec.onEstimateSlippage(request);
      return 0;
    },

    async simulate(request) {
      const validation = await adapter.validate(request);
      const overrides = validation.ok && spec.onSimulate ? await spec.onSimulate(request) : {};
      const base = {
        success: validation.ok && (overrides.success ?? true),
        estimatedFees: overrides.estimatedFees ?? (await adapter.estimateFees(request)),
        estimatedSlippagePct: overrides.estimatedSlippagePct ?? (await adapter.estimateSlippage(request)),
        warnings: overrides.warnings ?? [],
        errors: validation.ok ? (overrides.errors ?? []) : validation.errors,
        estimatedOutputs: overrides.estimatedOutputs ?? {},
      };
      const simulationHash = hashSimulationResult(base);
      return { ...base, simulationHash };
    },

    async execute(request) {
      const startedAt = Date.now();
      const validation = await adapter.validate(request);
      if (!validation.ok) {
        return { status: 'failed', txHash: null, fees: '0.000000', durationMs: Date.now() - startedAt, metadata: { errors: validation.errors } };
      }
      const overrides = spec.onExecute ? await spec.onExecute(request) : {};
      return {
        status: overrides.status ?? 'success',
        txHash: overrides.txHash ?? `tx-${spec.protocol}-${randomUUID()}`,
        fees: overrides.fees ?? (await adapter.estimateFees(request)),
        durationMs: overrides.durationMs ?? Date.now() - startedAt,
        metadata: overrides.metadata ?? {},
      };
    },
  };

  return adapter;
}
