// SoroswapAdapter: a ProtocolAdapter implementation for the Soroswap AMM router. One on-chain
// integration point (the router contract: `swap_exact_tokens_for_tokens` / `add_liquidity` /
// `remove_liquidity`) — single-router architecture, same shape as the Aquarius adapter. No
// Soroban SDK dependency: `SoroswapRouterClient`/`SorobanRpcClient` are caller-supplied
// interfaces (see `testDoubles.ts`) — this file never calls a protocol SDK itself. Transaction
// *execution* is out of scope: `execute()` always throws; simulation only, never submission.
import { hashQuote, hashTransaction } from './hashing.js';
import { getSoroswapRouterContractId, type SoroswapNetwork } from './config.js';
import { SOROSWAP_ACTIONS, type SoroswapAction, type SoroswapRouterClient, type SorobanRpcClient } from './types.js';
import { hashSimulationResult } from '../hashing.js';
import type { ProtocolAdapter } from '../adapter.js';
import type {
  ProtocolCapabilities,
  AdapterActionRequest,
  ValidationResult,
  SimulationResult,
  AdapterExecutionResult,
  Quote,
  TransactionBuilder,
  HealthStatus,
} from '../types.js';

export const SOROSWAP_ADAPTER_VERSION = '1.0.0';
export const NATIVE_ASSET = 'XLM';
export const DEFAULT_MAX_SLIPPAGE_PCT = 5;
export const DEFAULT_FEE_RATE_PCT = 0.3;

const ROUTER_METHOD_BY_ACTION: Record<SoroswapAction, string> = {
  SWAP: 'swap_exact_tokens_for_tokens',
  SWAP_CHAINED: 'swap_exact_tokens_for_tokens',
  ADD_LIQUIDITY: 'add_liquidity',
  REMOVE_LIQUIDITY: 'remove_liquidity',
};

export class SoroswapExecutionNotImplementedError extends Error {
  constructor() {
    super('SoroswapAdapter.execute() is not implemented — protocol execution (signing/submission) is explicitly out of scope. Use simulate()/buildTransaction() instead.');
    this.name = 'SoroswapExecutionNotImplementedError';
  }
}

export interface SoroswapAdapterOptions {
  supportedAssets: string[];
  routerClient: SoroswapRouterClient;
  sorobanRpcClient: SorobanRpcClient;
  maxSlippagePct?: number;
  feeRatePct?: number;
  onHealth?: () => Promise<HealthStatus> | HealthStatus;
}

function isNative(asset: string): boolean {
  return asset.toUpperCase() === NATIVE_ASSET;
}

function requestedNetwork(request: AdapterActionRequest): SoroswapNetwork {
  if (request.network !== 'testnet' && request.network !== 'mainnet') {
    throw new Error(`Invalid Soroswap network '${request.network}' — must be 'testnet' or 'mainnet'.`);
  }
  return request.network;
}

export function createSoroswapAdapter(options: SoroswapAdapterOptions): ProtocolAdapter {
  const maxSlippagePct = options.maxSlippagePct ?? DEFAULT_MAX_SLIPPAGE_PCT;
  const feeRatePct = options.feeRatePct ?? DEFAULT_FEE_RATE_PCT;

  const capabilities: ProtocolCapabilities = {
    protocol: 'soroswap',
    supportedActions: [...SOROSWAP_ACTIONS],
    supportedAssets: [...options.supportedAssets],
    supportedNetworks: ['testnet', 'mainnet'],
    simulationSupport: true,
    batchingSupport: true, // SWAP_CHAINED supports multi-hop routing in a single call.
    rollbackSupport: false,
  };

  function validateShape(request: AdapterActionRequest): string[] {
    const errors: string[] = [];
    if (!SOROSWAP_ACTIONS.includes(request.action as SoroswapAction)) {
      errors.push(`action '${request.action}' is not supported by 'soroswap' (supported: ${SOROSWAP_ACTIONS.join(', ')})`);
      return errors;
    }
    if (request.network !== 'testnet' && request.network !== 'mainnet') {
      errors.push(`network '${request.network}' is not supported by 'soroswap' (supported: testnet, mainnet)`);
    }
    return errors;
  }

  function checkAssetSupported(asset: string, errors: string[], label = 'asset'): void {
    if (!options.supportedAssets.includes(asset)) errors.push(`${label} '${asset}' is not supported by 'soroswap'`);
  }

  function checkAmount(request: AdapterActionRequest, errors: string[], field = 'amount'): void {
    const value = Number(request.amount);
    if (request.amount === '' || !Number.isFinite(value) || value <= 0) {
      errors.push(`${field} '${request.amount}' must be a positive finite decimal string`);
      return;
    }
    const decimalPart = request.amount.split('.')[1];
    if (decimalPart && decimalPart.length > 7) {
      errors.push(`${field} '${request.amount}' has more than 7 decimal places — not a valid Stellar asset amount`);
    }
  }

  function checkTrustline(asset: string, request: AdapterActionRequest, errors: string[]): void {
    if (isNative(asset)) return;
    if (request.params?.trustlineEstablished !== true) errors.push(`trustline required for asset '${asset}' before this action can proceed`);
  }

  function checkSlippage(request: AdapterActionRequest, errors: string[]): void {
    const requested = request.params?.maxSlippagePct;
    if (requested === undefined) return;
    if (typeof requested !== 'number' || !Number.isFinite(requested) || requested < 0) {
      errors.push('params.maxSlippagePct must be a non-negative finite number');
      return;
    }
    if (requested > maxSlippagePct) errors.push(`params.maxSlippagePct (${requested}) exceeds the adapter's allowed maximum (${maxSlippagePct})`);
  }

  /** A swap with no deadline (or one already in the past) can be replayed/held by a validator and
   *  executed far later at a stale price — a real fund-loss vector for AMM swaps, not a
   *  cosmetic check. Every SWAP/SWAP_CHAINED request must carry a future-dated
   *  `params.deadline` (Unix seconds). Modeled directly on Soroswap's own router signature
   *  (`swap_exact_tokens_for_tokens(..., deadline)`). */
  function checkDeadline(request: AdapterActionRequest, errors: string[], now: () => number = Date.now): void {
    const deadline = request.params?.deadline;
    if (deadline === undefined) {
      errors.push('params.deadline is required for a swap — an undated swap can be executed at an arbitrarily stale price');
      return;
    }
    if (typeof deadline !== 'number' || !Number.isFinite(deadline) || deadline <= 0) {
      errors.push('params.deadline must be a positive Unix-seconds timestamp');
      return;
    }
    if (deadline * 1000 <= now()) errors.push(`params.deadline (${deadline}) is in the past — a swap must have a future deadline`);
  }

  /** A swap with no `minOutput` (or one set to 0/undefined) accepts *any* output amount, which
   *  defeats slippage protection entirely regardless of `maxSlippagePct` — a malicious or
   *  front-run block could return dust and this adapter would still call it a success. Requiring
   *  a positive `minOutput` here (separate from `checkSlippage`, which only bounds the
   *  *requested* tolerance) closes that gap. */
  function checkMinOutput(request: AdapterActionRequest, errors: string[]): void {
    const minOutput = request.params?.minOutput;
    if (minOutput === undefined) {
      errors.push('params.minOutput is required for a swap — a swap with no minimum output has no slippage protection');
      return;
    }
    if (typeof minOutput !== 'string' || !Number.isFinite(Number(minOutput)) || Number(minOutput) <= 0) {
      errors.push('params.minOutput must be a positive numeric string');
    }
  }

  function checkPath(path: unknown, request: AdapterActionRequest, errors: string[]): string[] | null {
    if (!Array.isArray(path) || path.length < 2 || !path.every((p) => typeof p === 'string')) {
      errors.push('params.path must be an array of at least 2 asset codes for a chained swap');
      return null;
    }
    const typedPath = path as string[];
    if (typedPath[0] !== request.asset) errors.push(`params.path[0] ('${typedPath[0]}') must match the request's input asset ('${request.asset}') — token ordering must start at the declared input`);
    for (let i = 0; i < typedPath.length; i++) {
      checkAssetSupported(typedPath[i], errors, `params.path[${i}]`);
      if (i > 0 && typedPath[i] === typedPath[i - 1]) errors.push(`params.path has a repeated hop at index ${i} ('${typedPath[i]}') — invalid route`);
    }
    if (new Set(typedPath).size !== typedPath.length) {
      errors.push(`params.path revisits the same asset more than once ('${typedPath.join(' -> ')}') — circular routes are not valid`);
    }
    return typedPath;
  }

  async function adapterHealth(): Promise<HealthStatus> {
    if (!options.onHealth) return 'READY';
    try {
      return await options.onHealth();
    } catch {
      return 'UNAVAILABLE';
    }
  }

  async function checkPairExists(assetA: string, assetB: string, network: SoroswapNetwork, errors: string[]): Promise<void> {
    try {
      const exists = await options.routerClient.pairExists(assetA, assetB, network);
      if (!exists) errors.push(`no Soroswap pair exists for asset pair '${assetA}'/'${assetB}' — no liquidity route available`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`router client failure while checking pair '${assetA}'/'${assetB}': ${message}`);
    }
  }

  async function validateRequest(request: AdapterActionRequest): Promise<ValidationResult> {
    const errors = validateShape(request);
    if (errors.length > 0) return { ok: false, errors };

    const health = await adapterHealth();
    if (health === 'UNAVAILABLE' || health === 'UNKNOWN') errors.push(`Soroswap router is not available (health: ${health})`);

    checkAmount(request, errors);

    const network = request.network === 'testnet' || request.network === 'mainnet' ? request.network : 'testnet';
    const action = request.action as SoroswapAction;
    switch (action) {
      case 'SWAP': {
        checkAssetSupported(request.asset, errors, 'input asset');
        const outputAsset = request.params?.outputAsset;
        if (typeof outputAsset !== 'string' || outputAsset.length === 0) errors.push('params.outputAsset is required for SWAP');
        else checkAssetSupported(outputAsset, errors, 'output asset');
        checkTrustline(request.asset, request, errors);
        if (typeof outputAsset === 'string') checkTrustline(outputAsset, request, errors);
        checkSlippage(request, errors);
        checkDeadline(request, errors);
        checkMinOutput(request, errors);
        if (typeof outputAsset === 'string' && options.supportedAssets.includes(request.asset) && options.supportedAssets.includes(outputAsset)) {
          await checkPairExists(request.asset, outputAsset, network, errors);
        }
        break;
      }
      case 'SWAP_CHAINED': {
        const path = checkPath(request.params?.path, request, errors);
        checkSlippage(request, errors);
        checkDeadline(request, errors);
        checkMinOutput(request, errors);
        if (path) {
          for (const hop of path) checkTrustline(hop, request, errors);
          for (let i = 1; i < path.length; i++) {
            if (options.supportedAssets.includes(path[i - 1]) && options.supportedAssets.includes(path[i])) {
              await checkPairExists(path[i - 1], path[i], network, errors);
            }
          }
        }
        break;
      }
      case 'ADD_LIQUIDITY': {
        checkAssetSupported(request.asset, errors, 'asset');
        const assetB = request.params?.assetB;
        const amountB = request.params?.amountB;
        if (typeof assetB !== 'string' || assetB.length === 0) errors.push('params.assetB is required for ADD_LIQUIDITY');
        else checkAssetSupported(assetB, errors, 'assetB');
        if (typeof amountB !== 'string' || !Number.isFinite(Number(amountB)) || Number(amountB) <= 0) errors.push('params.amountB must be a positive numeric string for ADD_LIQUIDITY');
        checkTrustline(request.asset, request, errors);
        if (typeof assetB === 'string') checkTrustline(assetB, request, errors);
        if (typeof assetB === 'string' && options.supportedAssets.includes(request.asset) && options.supportedAssets.includes(assetB)) {
          await checkPairExists(request.asset, assetB, network, errors);
        }
        break;
      }
      case 'REMOVE_LIQUIDITY': {
        checkAssetSupported(request.asset, errors, 'asset');
        const assetB = request.params?.assetB;
        if (typeof assetB !== 'string' || assetB.length === 0) errors.push('params.assetB is required for REMOVE_LIQUIDITY');
        else checkAssetSupported(assetB, errors, 'assetB');
        break;
      }
    }

    return { ok: errors.length === 0, errors };
  }

  function assertValidRouteResult(result: { outputAmount: unknown; priceImpactPct: unknown }, source: string): void {
    if (typeof result.outputAmount !== 'string' || result.outputAmount.length === 0 || !Number.isFinite(Number(result.outputAmount))) {
      throw new Error(`Malformed response from ${source}: 'outputAmount' must be a non-empty numeric string, got ${JSON.stringify(result.outputAmount)}.`);
    }
    if (typeof result.priceImpactPct !== 'number' || !Number.isFinite(result.priceImpactPct)) {
      throw new Error(`Malformed response from ${source}: 'priceImpactPct' must be a finite number, got ${JSON.stringify(result.priceImpactPct)}.`);
    }
  }

  async function buildQuote(request: AdapterActionRequest): Promise<Quote> {
    const action = request.action as SoroswapAction;
    const path: string[] = action === 'SWAP_CHAINED' ? (request.params?.path as string[]) : [request.asset, request.params?.outputAsset as string];
    const network = requestedNetwork(request);

    const result = await options.routerClient.quoteSwap(path, request.amount, network);
    assertValidRouteResult(result, 'Soroswap router client');
    const fees = (Number(request.amount) * (feeRatePct / 100)).toFixed(6);

    const base: Omit<Quote, 'quoteHash'> = {
      protocol: 'soroswap',
      action,
      inputAsset: path[0],
      outputAsset: path[path.length - 1],
      inputAmount: request.amount,
      outputAmount: result.outputAmount,
      route: path,
      priceImpactPct: result.priceImpactPct,
      estimatedFees: fees,
      source: 'on-chain',
    };
    return { ...base, quoteHash: hashQuote(base) };
  }

  function buildRouterArgs(action: SoroswapAction, request: AdapterActionRequest): Record<string, unknown> {
    switch (action) {
      case 'SWAP':
        return { path: [request.asset, request.params?.outputAsset], amountIn: request.amount, minOutput: request.params?.minOutput, deadline: request.params?.deadline };
      case 'SWAP_CHAINED':
        return { path: request.params?.path, amountIn: request.amount, minOutput: request.params?.minOutput, deadline: request.params?.deadline };
      case 'ADD_LIQUIDITY':
        return { assetA: request.asset, assetB: request.params?.assetB, amountA: request.amount, amountB: request.params?.amountB };
      case 'REMOVE_LIQUIDITY':
        return { assetA: request.asset, assetB: request.params?.assetB, lpAmount: request.amount };
    }
  }

  const adapter: ProtocolAdapter = {
    protocol: 'soroswap',
    version: SOROSWAP_ADAPTER_VERSION,

    async initialize() {
      // No-op: nothing to warm up without a real Soroban connection.
    },

    health: adapterHealth,

    capabilities() {
      return capabilities;
    },

    validate: validateRequest,

    async estimateFees(request) {
      return (Number(request.amount) * (feeRatePct / 100)).toFixed(6);
    },

    async estimateSlippage(request) {
      const action = request.action as SoroswapAction;
      if (action !== 'SWAP' && action !== 'SWAP_CHAINED') return 0;
      try {
        const quote = await buildQuote(request);
        return quote.priceImpactPct;
      } catch {
        return 0;
      }
    },

    async quote(request) {
      const validation = await validateRequest(request);
      if (!validation.ok) throw new Error(`Cannot quote an invalid request: ${validation.errors.join('; ')}`);
      return buildQuote(request);
    },

    async simulate(request): Promise<SimulationResult> {
      const validation = await validateRequest(request);
      if (!validation.ok) {
        const base = { success: false, estimatedFees: '0.000000', estimatedSlippagePct: 0, warnings: [], errors: validation.errors, estimatedOutputs: {} };
        return { ...base, simulationHash: hashSimulationResult(base) };
      }

      const network = requestedNetwork(request);
      const action = request.action as SoroswapAction;
      const method = ROUTER_METHOD_BY_ACTION[action];

      const warnings: string[] = [];
      let estimatedOutputs: Record<string, string> = {};
      let estimatedFees = '0.000000';
      let estimatedSlippagePct = 0;
      let contractId: string;

      // The contractId (config) resolution AND every router-client call are inside this try — a
      // missing config env var or a client failure (unreachable, malformed response) must
      // degrade simulate() to a failed SimulationResult, never a thrown rejection. Found via
      // adversarial testing (same bug class Phoenix's production audit fixed).
      try {
        contractId = getSoroswapRouterContractId(network);
        if (action === 'ADD_LIQUIDITY') {
          const assetB = request.params?.assetB as string;
          const amountB = request.params?.amountB as string;
          const result = await options.routerClient.quoteAddLiquidity(request.asset, assetB, request.amount, amountB, network);
          estimatedOutputs = { lpTokensMinted: result.lpTokensMinted };
          estimatedSlippagePct = result.priceImpactPct;
          estimatedFees = (Number(request.amount) * (feeRatePct / 100)).toFixed(6);
        } else if (action === 'REMOVE_LIQUIDITY') {
          const assetB = request.params?.assetB as string;
          const result = await options.routerClient.quoteRemoveLiquidity(request.asset, assetB, request.amount, network);
          estimatedOutputs = { assetAReturned: result.assetAReturned, assetBReturned: result.assetBReturned };
        } else {
          const quote = await buildQuote(request);
          estimatedOutputs = { [quote.outputAsset]: quote.outputAmount };
          estimatedFees = quote.estimatedFees;
          estimatedSlippagePct = quote.priceImpactPct;
          if (quote.priceImpactPct > maxSlippagePct) warnings.push(`estimated price impact (${quote.priceImpactPct}%) is high`);
          const minOutput = request.params?.minOutput as string | undefined;
          if (minOutput !== undefined && Number(quote.outputAmount) < Number(minOutput)) {
            const base = { success: false, estimatedFees, estimatedSlippagePct, warnings, errors: [`estimated output (${quote.outputAmount}) is below params.minOutput (${minOutput}) — swap would revert on-chain`], estimatedOutputs: {} };
            return { ...base, simulationHash: hashSimulationResult(base) };
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const base = { success: false, estimatedFees: '0.000000', estimatedSlippagePct: 0, warnings: [], errors: [`client failure: ${message}`], estimatedOutputs: {} };
        return { ...base, simulationHash: hashSimulationResult(base) };
      }

      const rpcArgs = buildRouterArgs(action, request);
      let rpcResult: { success: boolean; cost: string; result: Record<string, unknown>; errors: string[] };
      try {
        rpcResult = await options.sorobanRpcClient.simulateTransaction(contractId, method, rpcArgs, network);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        rpcResult = { success: false, cost: '0', result: {}, errors: [`Soroban RPC failure: ${message}`] };
      }

      const base = { success: rpcResult.success, estimatedFees, estimatedSlippagePct, warnings, errors: rpcResult.errors, estimatedOutputs };
      return { ...base, simulationHash: hashSimulationResult(base) };
    },

    async buildTransaction(request): Promise<TransactionBuilder> {
      const validation = await validateRequest(request);
      if (!validation.ok) throw new Error(`Cannot build a transaction for an invalid request: ${validation.errors.join('; ')}`);

      const network = requestedNetwork(request);
      const action = request.action as SoroswapAction;
      const method = ROUTER_METHOD_BY_ACTION[action];
      const contractId = getSoroswapRouterContractId(network);
      const args = buildRouterArgs(action, request);

      const base: Omit<TransactionBuilder, 'transactionHash'> = { protocol: 'soroswap', action, network, contractId, method, args };
      return { ...base, transactionHash: hashTransaction(base) };
    },

    async execute(): Promise<AdapterExecutionResult> {
      throw new SoroswapExecutionNotImplementedError();
    },
  };

  return adapter;
}
