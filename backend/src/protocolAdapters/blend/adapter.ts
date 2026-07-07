// BlendAdapter: a ProtocolAdapter implementation for the Blend lending pool. Blend is a
// lending/borrowing protocol, not swap-shaped — it has one on-chain integration point (the pool
// contract's `submit` call) and four actions: DEPOSIT/WITHDRAW/BORROW/REPAY. It deliberately does
// NOT implement the framework's optional `quote()` (see `../types.ts` and `types.ts`: "not every
// protocol has a meaningful quote"). No Soroban SDK dependency: `BlendPoolClient`/
// `SorobanRpcClient` are caller-supplied interfaces (see `testDoubles.ts`) — this file never
// calls a protocol SDK itself. Transaction *execution* is out of scope: `execute()` always
// throws; simulation only, never submission.
import { hashTransaction } from './hashing.js';
import { getBlendPoolContractId, getMinHealthFactor, type BlendNetwork } from './config.js';
import { BLEND_ACTIONS, type BlendAction, type BlendPoolClient, type SorobanRpcClient } from './types.js';
import { hashSimulationResult } from '../hashing.js';
import type { ProtocolAdapter } from '../adapter.js';
import type {
  ProtocolCapabilities,
  AdapterActionRequest,
  ValidationResult,
  SimulationResult,
  AdapterExecutionResult,
  TransactionBuilder,
  HealthStatus,
} from '../types.js';

export const BLEND_ADAPTER_VERSION = '1.0.0';
export const NATIVE_ASSET = 'XLM';
export const DEFAULT_FEE_RATE_PCT = 0; // Blend charges no protocol-level swap fee — interest accrues over time, not per-tx.

const POOL_METHOD_BY_ACTION: Record<BlendAction, string> = {
  DEPOSIT: 'submit',
  WITHDRAW: 'submit',
  BORROW: 'submit',
  REPAY: 'submit',
};

export class BlendExecutionNotImplementedError extends Error {
  constructor() {
    super('BlendAdapter.execute() is not implemented — protocol execution (signing/submission) is explicitly out of scope. Use simulate()/buildTransaction() instead.');
    this.name = 'BlendExecutionNotImplementedError';
  }
}

export interface BlendAdapterOptions {
  supportedAssets: string[];
  poolClient: BlendPoolClient;
  sorobanRpcClient: SorobanRpcClient;
  minHealthFactor?: number;
  onHealth?: () => Promise<HealthStatus> | HealthStatus;
}

function requestedNetwork(request: AdapterActionRequest): BlendNetwork {
  if (request.network !== 'testnet' && request.network !== 'mainnet') {
    throw new Error(`Invalid Blend network '${request.network}' — must be 'testnet' or 'mainnet'.`);
  }
  return request.network;
}

export function createBlendAdapter(options: BlendAdapterOptions): ProtocolAdapter {
  const minHealthFactor = options.minHealthFactor ?? getMinHealthFactor();

  const capabilities: ProtocolCapabilities = {
    protocol: 'blend',
    supportedActions: [...BLEND_ACTIONS],
    supportedAssets: [...options.supportedAssets],
    supportedNetworks: ['testnet', 'mainnet'],
    simulationSupport: true,
    batchingSupport: true, // Blend's `submit` carries a Vec<Request> — multiple actions per call.
    rollbackSupport: false,
  };

  function validateShape(request: AdapterActionRequest): string[] {
    const errors: string[] = [];
    if (!BLEND_ACTIONS.includes(request.action as BlendAction)) {
      errors.push(`action '${request.action}' is not supported by 'blend' (supported: ${BLEND_ACTIONS.join(', ')})`);
      return errors;
    }
    if (request.network !== 'testnet' && request.network !== 'mainnet') {
      errors.push(`network '${request.network}' is not supported by 'blend' (supported: testnet, mainnet)`);
    }
    return errors;
  }

  function checkAssetSupported(asset: string, errors: string[], label = 'asset'): void {
    if (!options.supportedAssets.includes(asset)) errors.push(`${label} '${asset}' is not supported by 'blend'`);
  }

  /** `request.amount` was never validated — mirrors the fix applied to Phoenix during its
   *  production audit: a non-numeric ("abc"/""), non-finite ("NaN"/"Infinity"), negative, or
   *  over-precision (>7 decimal places) amount must be rejected here rather than silently
   *  producing NaN/negative fees and estimates downstream. Applied proactively for Blend rather
   *  than discovered later, given the audit already found this exact bug class once. */
  function checkAmount(request: AdapterActionRequest, errors: string[]): void {
    const value = Number(request.amount);
    if (request.amount === '' || !Number.isFinite(value) || value <= 0) {
      errors.push(`amount '${request.amount}' must be a positive finite decimal string`);
      return;
    }
    const decimalPart = request.amount.split('.')[1];
    if (decimalPart && decimalPart.length > 7) {
      errors.push(`amount '${request.amount}' has more than 7 decimal places — not a valid Stellar asset amount`);
    }
  }

  function isNative(asset: string): boolean {
    return asset.toUpperCase() === NATIVE_ASSET;
  }

  function checkTrustline(asset: string, request: AdapterActionRequest, errors: string[]): void {
    if (isNative(asset)) return;
    if (request.params?.trustlineEstablished !== true) errors.push(`trustline required for asset '${asset}' before this action can proceed`);
  }

  function checkOwner(request: AdapterActionRequest, errors: string[]): string | null {
    const owner = request.params?.owner;
    if (typeof owner !== 'string' || owner.length === 0) {
      errors.push('params.owner is required (the Stellar address whose position this action affects)');
      return null;
    }
    return owner;
  }

  /** `options.onHealth` is caller-supplied and may itself fail (real RPC call) — a throwing
   *  health check must be treated as UNAVAILABLE, not propagate as an uncaught rejection out of
   *  validate()/simulate()/buildTransaction() (all of which call this). Same discipline as
   *  Phoenix's `adapterHealth` (found via adversarial testing during Phoenix's audit; applied
   *  here proactively). */
  async function adapterHealth(): Promise<HealthStatus> {
    if (!options.onHealth) return 'READY';
    try {
      return await options.onHealth();
    } catch {
      return 'UNAVAILABLE';
    }
  }

  /** A pool-client failure (unreachable, malformed response) checking the user's post-action
   *  health factor must become a validation error, never a thrown exception — mirrors the
   *  `checkLiquidity` fail-closed pattern from Phoenix's audit. Only BORROW/WITHDRAW can reduce a
   *  position's health factor, so this is only invoked for those two actions; DEPOSIT/REPAY only
   *  ever improve health and are not gated on it. */
  async function checkHealthFactor(request: AdapterActionRequest, owner: string, action: BlendAction, errors: string[]): Promise<void> {
    if (action !== 'BORROW' && action !== 'WITHDRAW') return;
    const network = requestedNetwork(request);
    try {
      const projected = await options.poolClient.projectHealthFactor(owner, action, request.asset, request.amount, network);
      if (typeof projected !== 'number' || !Number.isFinite(projected)) {
        errors.push(`Blend pool client returned a malformed projected health factor: ${JSON.stringify(projected)}`);
        return;
      }
      if (projected < minHealthFactor) {
        errors.push(`action would leave the position at health factor ${projected.toFixed(3)}, below the required minimum of ${minHealthFactor} — rejected to prevent liquidation risk`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`pool client failure while projecting health factor: ${message}`);
    }
  }

  async function validateRequest(request: AdapterActionRequest): Promise<ValidationResult> {
    const errors = validateShape(request);
    if (errors.length > 0) return { ok: false, errors };

    const health = await adapterHealth();
    if (health === 'UNAVAILABLE' || health === 'UNKNOWN') errors.push(`Blend pool is not available (health: ${health})`);

    checkAmount(request, errors);
    checkAssetSupported(request.asset, errors, 'asset');
    checkTrustline(request.asset, request, errors);
    const owner = checkOwner(request, errors);

    const action = request.action as BlendAction;
    if (owner && errors.length === 0) {
      await checkHealthFactor(request, owner, action, errors);
    }

    return { ok: errors.length === 0, errors };
  }

  function buildPoolArgs(action: BlendAction, request: AdapterActionRequest): Record<string, unknown> {
    return {
      requestType: action,
      asset: request.asset,
      amount: request.amount,
      owner: request.params?.owner,
    };
  }

  async function estimatedOutputsFor(action: BlendAction, request: AdapterActionRequest): Promise<{ outputs: Record<string, string>; warnings: string[] }> {
    const network = requestedNetwork(request);
    const warnings: string[] = [];
    switch (action) {
      case 'DEPOSIT': {
        const result = await options.poolClient.simulateDeposit(request.asset, request.amount, network);
        if (typeof result.bTokensMinted !== 'string' || !Number.isFinite(Number(result.bTokensMinted))) {
          throw new Error(`Malformed response from Blend pool client: 'bTokensMinted' must be a numeric string, got ${JSON.stringify(result.bTokensMinted)}.`);
        }
        return { outputs: { bTokensMinted: result.bTokensMinted }, warnings };
      }
      case 'WITHDRAW': {
        const result = await options.poolClient.simulateWithdraw(request.asset, request.amount, network);
        if (typeof result.underlyingReturned !== 'string' || !Number.isFinite(Number(result.underlyingReturned))) {
          throw new Error(`Malformed response from Blend pool client: 'underlyingReturned' must be a numeric string, got ${JSON.stringify(result.underlyingReturned)}.`);
        }
        return { outputs: { underlyingReturned: result.underlyingReturned }, warnings };
      }
      case 'BORROW': {
        const result = await options.poolClient.simulateBorrow(request.asset, request.amount, network);
        if (typeof result.debtTokensMinted !== 'string' || !Number.isFinite(Number(result.debtTokensMinted))) {
          throw new Error(`Malformed response from Blend pool client: 'debtTokensMinted' must be a numeric string, got ${JSON.stringify(result.debtTokensMinted)}.`);
        }
        warnings.push('borrowing increases liquidation risk — monitor position health factor');
        return { outputs: { debtTokensMinted: result.debtTokensMinted }, warnings };
      }
      case 'REPAY': {
        const result = await options.poolClient.simulateRepay(request.asset, request.amount, network);
        if (typeof result.debtRemaining !== 'string' || !Number.isFinite(Number(result.debtRemaining))) {
          throw new Error(`Malformed response from Blend pool client: 'debtRemaining' must be a numeric string, got ${JSON.stringify(result.debtRemaining)}.`);
        }
        return { outputs: { debtRemaining: result.debtRemaining }, warnings };
      }
    }
  }

  const adapter: ProtocolAdapter = {
    protocol: 'blend',
    version: BLEND_ADAPTER_VERSION,

    async initialize() {
      // No-op: nothing to warm up without a real Soroban connection.
    },

    health: adapterHealth,

    capabilities() {
      return capabilities;
    },

    validate: validateRequest,

    async estimateFees() {
      return DEFAULT_FEE_RATE_PCT.toFixed(6);
    },

    async estimateSlippage() {
      // Blend is a lending pool, not an AMM — there is no price impact/slippage concept for
      // deposit/withdraw/borrow/repay.
      return 0;
    },

    // No `quote` — Blend is a pure lending pool with no meaningful standardized price quote (see
    // `types.ts` and the framework's own `ProtocolAdapter.quote?` doc comment).

    async simulate(request): Promise<SimulationResult> {
      const validation = await validateRequest(request);
      if (!validation.ok) {
        const base = { success: false, estimatedFees: '0.000000', estimatedSlippagePct: 0, warnings: [], errors: validation.errors, estimatedOutputs: {} };
        return { ...base, simulationHash: hashSimulationResult(base) };
      }

      const network = requestedNetwork(request);
      const action = request.action as BlendAction;

      let estimatedOutputs: Record<string, string> = {};
      let warnings: string[] = [];
      let contractId: string;
      // Every pool-client call AND the contractId (config) resolution is inside this try — a
      // client failure (unreachable, malformed response) or a missing config env var must
      // degrade simulate() to a failed SimulationResult, never a thrown rejection. Found via
      // adversarial testing (same bug class Phoenix's production audit fixed: contractId
      // resolution previously happened *before* this try block).
      try {
        contractId = getBlendPoolContractId(network);
        const result = await estimatedOutputsFor(action, request);
        estimatedOutputs = result.outputs;
        warnings = result.warnings;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const base = { success: false, estimatedFees: '0.000000', estimatedSlippagePct: 0, warnings: [], errors: [`client failure: ${message}`], estimatedOutputs: {} };
        return { ...base, simulationHash: hashSimulationResult(base) };
      }

      const method = POOL_METHOD_BY_ACTION[action];
      const rpcArgs = buildPoolArgs(action, request);
      let rpcResult: { success: boolean; cost: string; result: Record<string, unknown>; errors: string[] };
      try {
        rpcResult = await options.sorobanRpcClient.simulateTransaction(contractId, method, rpcArgs, network);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        rpcResult = { success: false, cost: '0', result: {}, errors: [`Soroban RPC failure: ${message}`] };
      }

      const base = { success: rpcResult.success, estimatedFees: DEFAULT_FEE_RATE_PCT.toFixed(6), estimatedSlippagePct: 0, warnings, errors: rpcResult.errors, estimatedOutputs };
      return { ...base, simulationHash: hashSimulationResult(base) };
    },

    async buildTransaction(request): Promise<TransactionBuilder> {
      const validation = await validateRequest(request);
      if (!validation.ok) throw new Error(`Cannot build a transaction for an invalid request: ${validation.errors.join('; ')}`);

      const network = requestedNetwork(request);
      const action = request.action as BlendAction;
      const contractId = getBlendPoolContractId(network);
      const method = POOL_METHOD_BY_ACTION[action];
      const args = buildPoolArgs(action, request);

      const base: Omit<TransactionBuilder, 'transactionHash'> = { protocol: 'blend', action, network, contractId, method, args };
      return { ...base, transactionHash: hashTransaction(base) };
    },

    async execute(): Promise<AdapterExecutionResult> {
      throw new BlendExecutionNotImplementedError();
    },
  };

  return adapter;
}
