// PhoenixAdapter: a ProtocolAdapter implementation for the Phoenix DeFi Hub. Two on-chain
// integration points — `multihop` (swaps/routing) and `factory` (pool discovery) — plus direct
// pool-contract calls for liquidity deposit/withdrawal (Phoenix has no liquidity router; this
// mirrors its real architecture, not a shortcut). No Soroban SDK dependency:
// `PhoenixMultihopClient`/`PhoenixFactoryClient`/`PhoenixPoolClient`/`SorobanRpcClient` are
// caller-supplied interfaces (see `testDoubles.ts`) — this file never calls a protocol SDK
// itself. Transaction *execution* is out of scope: `execute()` always throws; simulation only,
// never submission.
import { hashQuote, hashTransaction } from './hashing.js';
import { getPhoenixMultihopContractId, type PhoenixNetwork } from './config.js';
import { PHOENIX_ACTIONS, PHOENIX_POOL_TYPES, type PhoenixAction, type PhoenixPoolType, type PhoenixMultihopClient, type PhoenixFactoryClient, type PhoenixPoolClient, type SorobanRpcClient } from './types.js';
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

export const PHOENIX_ADAPTER_VERSION = '1.0.0';
export const NATIVE_ASSET = 'XLM';
export const DEFAULT_MAX_SLIPPAGE_PCT = 5;
export const DEFAULT_FEE_RATE_PCT = 0.3;
export const DEFAULT_POOL_TYPE: PhoenixPoolType = 'xyk';

const ROUTER_METHOD_BY_ACTION: Record<PhoenixAction, string | null> = {
  SWAP: 'swap',
  SWAP_CHAINED: 'swap',
  DEPOSIT: 'provide_liquidity',
  WITHDRAW: 'withdraw_liquidity',
  POOL_DISCOVERY: null, // read-only — no transaction to build
};

export class PhoenixExecutionNotImplementedError extends Error {
  constructor() {
    super('PhoenixAdapter.execute() is not implemented — protocol execution (signing/submission) is explicitly out of scope. Use simulate()/buildTransaction() instead.');
    this.name = 'PhoenixExecutionNotImplementedError';
  }
}

export interface PhoenixAdapterOptions {
  supportedAssets: string[];
  multihopClient: PhoenixMultihopClient;
  factoryClient: PhoenixFactoryClient;
  poolClient: PhoenixPoolClient;
  sorobanRpcClient: SorobanRpcClient;
  maxSlippagePct?: number;
  feeRatePct?: number;
  onHealth?: () => Promise<HealthStatus> | HealthStatus;
}

function isNative(asset: string): boolean {
  return asset.toUpperCase() === NATIVE_ASSET;
}

function requestedNetwork(request: AdapterActionRequest): PhoenixNetwork {
  if (request.network !== 'testnet' && request.network !== 'mainnet') {
    throw new Error(`Invalid Phoenix network '${request.network}' — must be 'testnet' or 'mainnet'.`);
  }
  return request.network;
}

function requestedPoolType(request: AdapterActionRequest): PhoenixPoolType {
  const poolType = (request.params?.poolType as PhoenixPoolType | undefined) ?? DEFAULT_POOL_TYPE;
  if (!PHOENIX_POOL_TYPES.includes(poolType)) throw new Error(`Invalid Phoenix pool type '${poolType}' — must be one of: ${PHOENIX_POOL_TYPES.join(', ')}.`);
  return poolType;
}

export function createPhoenixAdapter(options: PhoenixAdapterOptions): ProtocolAdapter {
  const maxSlippagePct = options.maxSlippagePct ?? DEFAULT_MAX_SLIPPAGE_PCT;
  const feeRatePct = options.feeRatePct ?? DEFAULT_FEE_RATE_PCT;

  const capabilities: ProtocolCapabilities = {
    protocol: 'phoenix',
    supportedActions: [...PHOENIX_ACTIONS],
    supportedAssets: [...options.supportedAssets],
    supportedNetworks: ['testnet', 'mainnet'],
    simulationSupport: true,
    batchingSupport: true, // multihop swap supports multi-hop operations
    rollbackSupport: false,
  };

  function validateShape(request: AdapterActionRequest): string[] {
    const errors: string[] = [];
    if (!PHOENIX_ACTIONS.includes(request.action as PhoenixAction)) {
      errors.push(`action '${request.action}' is not supported by 'phoenix' (supported: ${PHOENIX_ACTIONS.join(', ')})`);
      return errors;
    }
    if (request.network !== 'testnet' && request.network !== 'mainnet') {
      errors.push(`network '${request.network}' is not supported by 'phoenix' (supported: testnet, mainnet)`);
    }
    return errors;
  }

  function checkAssetSupported(asset: string, errors: string[], label = 'asset'): void {
    if (!options.supportedAssets.includes(asset)) errors.push(`${label} '${asset}' is not supported by 'phoenix'`);
  }

  /** `request.amount` was never validated — a non-numeric string ("abc"/""), "NaN", "Infinity",
   *  or a negative value all passed `validate()` cleanly and then silently produced
   *  `estimatedFees: "NaN"` / `"Infinity"` / a negative fee in an otherwise `success: true`
   *  SimulationResult. Found via adversarial testing during the final production audit. */
  function checkAmount(request: AdapterActionRequest, errors: string[]): void {
    const value = Number(request.amount);
    if (request.amount === '' || !Number.isFinite(value) || value < 0) {
      errors.push(`amount '${request.amount}' must be a non-negative finite decimal string`);
      return;
    }
    // More decimal precision than Stellar assets actually support (7 places) is not a value that
    // could ever exist on-chain. Found during the Protocol Layer final production audit.
    const decimalPart = request.amount.split('.')[1];
    if (decimalPart && decimalPart.length > 7) {
      errors.push(`amount '${request.amount}' has more than 7 decimal places — not a valid Stellar asset amount`);
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
    // Circular route check: only adjacent-hop repeats were rejected above — a path like
    // ['XLM','USDC','XLM'] (revisiting an earlier asset via a non-adjacent hop) previously passed
    // validation entirely. Found during the Protocol Layer final production audit.
    if (new Set(typedPath).size !== typedPath.length) {
      errors.push(`params.path revisits the same asset more than once ('${typedPath.join(' -> ')}') — circular routes are not valid`);
    }
    return typedPath;
  }

  /** A swap with no deadline (or one already in the past) can be replayed/held and executed far
   *  later at a stale price — a real fund-loss vector for AMM swaps, not a cosmetic check. Every
   *  SWAP/SWAP_CHAINED request must carry a future-dated `params.deadline` (Unix seconds).
   *  `buildRouterArgs` was already threading `minOutput`/an implicit deadline expectation through
   *  to the built transaction without ever requiring the caller supply one — the same fund-loss
   *  bug class the Soroswap adapter's audit already fixed, found here during the Protocol Layer
   *  final production audit and fixed identically. */
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
   *  defeats slippage protection entirely regardless of `maxSlippagePct`. Same bug class/fix as
   *  Soroswap's `checkMinOutput`, found here during the Protocol Layer final production audit. */
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

  /** `options.onHealth` is caller-supplied and may perform a real health check (RPC call, etc.)
   *  that can itself fail — a throwing health check must be treated as UNAVAILABLE, not propagate
   *  as an uncaught rejection out of validate()/simulate()/quote()/buildTransaction() (all of
   *  which call this). Found via adversarial testing during the final production audit. */
  async function adapterHealth(): Promise<HealthStatus> {
    if (!options.onHealth) return 'READY';
    try {
      return await options.onHealth();
    } catch {
      return 'UNAVAILABLE';
    }
  }

  /** A factory-client failure here (unreachable, network error) must become a validation error,
   *  never a thrown exception — `validateRequest` (and everything that calls it: `simulate`,
   *  `quote`, `buildTransaction`) must always resolve, matching this adapter's fail-closed
   *  discipline everywhere else. Found during production audit: this was the second place
   *  (alongside `simulate()`'s own contractId resolution) where a factory failure propagated as
   *  an uncaught rejection instead of a graceful result. */
  async function checkLiquidity(assetA: string, assetB: string, network: PhoenixNetwork, errors: string[]): Promise<void> {
    try {
      const pool = await options.factoryClient.findPoolByPair(assetA, assetB, network);
      if (!pool) errors.push(`no Phoenix pool exists for asset pair '${assetA}'/'${assetB}' — no liquidity route available`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`factory client failure while checking liquidity for '${assetA}'/'${assetB}': ${message}`);
    }
  }

  async function validateRequest(request: AdapterActionRequest): Promise<ValidationResult> {
    const errors = validateShape(request);
    if (errors.length > 0) return { ok: false, errors };

    const health = await adapterHealth();
    if (health === 'UNAVAILABLE' || health === 'UNKNOWN') errors.push(`Phoenix router (multihop) is not available (health: ${health})`);

    checkAmount(request, errors);

    try {
      requestedPoolType(request);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }

    const network = request.network === 'testnet' || request.network === 'mainnet' ? request.network : 'testnet';
    const action = request.action as PhoenixAction;
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
          await checkLiquidity(request.asset, outputAsset, network, errors);
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
              await checkLiquidity(path[i - 1], path[i], network, errors);
            }
          }
        }
        break;
      }
      case 'DEPOSIT': {
        checkAssetSupported(request.asset, errors, 'asset');
        const assetB = request.params?.assetB;
        if (typeof assetB !== 'string' || assetB.length === 0) errors.push('params.assetB is required for DEPOSIT');
        else checkAssetSupported(assetB, errors, 'assetB');
        checkTrustline(request.asset, request, errors);
        if (typeof assetB === 'string') checkTrustline(assetB, request, errors);
        if (typeof assetB === 'string' && options.supportedAssets.includes(request.asset) && options.supportedAssets.includes(assetB)) {
          await checkLiquidity(request.asset, assetB, network, errors);
        }
        break;
      }
      case 'WITHDRAW': {
        const poolId = request.params?.poolId;
        if (typeof poolId !== 'string' || poolId.length === 0) errors.push('params.poolId is required for WITHDRAW');
        break;
      }
      case 'POOL_DISCOVERY':
        break;
    }

    return { ok: errors.length === 0, errors };
  }

  /** A malformed response from a caller-supplied client (wrong shape — e.g. a missing/non-string
   *  `outputAmount`) must never propagate silently into a Quote/SimulationResult as if it were a
   *  real, successful value. This adapter doesn't control what a real client returns, so it
   *  re-validates every external response shape at the boundary, fail-closed — same discipline
   *  as the Aquarius adapter's `assertValidRouteResult`. Found via adversarial testing during the
   *  final production audit: a multihop client returning `{ outputAmount: undefined, ... }`
   *  previously produced a `success: true` quote/simulation with the output silently missing. */
  function assertValidMultihopResult(result: { outputAmount: unknown; spreadAmount: unknown; totalCommission: unknown }, source: string): void {
    for (const [field, value] of Object.entries(result)) {
      if (typeof value !== 'string' || value.length === 0 || !Number.isFinite(Number(value))) {
        throw new Error(`Malformed response from ${source}: '${field}' must be a non-empty numeric string, got ${JSON.stringify(value)}.`);
      }
    }
  }

  async function buildQuote(request: AdapterActionRequest): Promise<Quote> {
    const network = requestedNetwork(request);
    const poolType = requestedPoolType(request);
    const action = request.action as PhoenixAction;

    const path: string[] = action === 'SWAP_CHAINED' ? (request.params?.path as string[]) : [request.asset, request.params?.outputAsset as string];
    const hops = [];
    for (let i = 1; i < path.length; i++) hops.push({ offerAsset: path[i - 1], askAsset: path[i], askAssetMinAmount: null });

    const result = await options.multihopClient.simulateSwap(hops, request.amount, poolType, network);
    assertValidMultihopResult(result, 'Phoenix multihop client');
    const fees = (Number(request.amount) * (feeRatePct / 100)).toFixed(6);

    const base: Omit<Quote, 'quoteHash'> = {
      protocol: 'phoenix',
      action,
      inputAsset: path[0],
      outputAsset: path[path.length - 1],
      inputAmount: request.amount,
      outputAmount: result.outputAmount,
      route: path,
      priceImpactPct: Number(result.spreadAmount) > 0 ? Number(((Number(result.spreadAmount) / Number(request.amount)) * 100).toFixed(2)) : 0,
      estimatedFees: fees,
      source: 'on-chain',
    };
    return { ...base, quoteHash: hashQuote(base) };
  }

  /** A factory response with a missing/non-string `poolId` must never be trusted as a valid
   *  contract address — found via adversarial testing: a factory client returning
   *  `{ poolId: undefined, ... }` previously produced a `success: true` DEPOSIT simulation and a
   *  `buildTransaction()` result whose `contractId` was silently absent (dropped by
   *  serialization, not caught by any check). */
  function assertValidPool(pool: { poolId: unknown }, source: string): void {
    if (typeof pool.poolId !== 'string' || pool.poolId.length === 0) {
      throw new Error(`Malformed response from ${source}: 'poolId' must be a non-empty string, got ${JSON.stringify(pool.poolId)}.`);
    }
  }

  function buildRouterArgs(action: PhoenixAction, request: AdapterActionRequest): Record<string, unknown> {
    switch (action) {
      case 'SWAP':
        return { path: [request.asset, request.params?.outputAsset], amount: request.amount, minOutput: request.params?.minOutput ?? null, poolType: request.params?.poolType ?? DEFAULT_POOL_TYPE };
      case 'SWAP_CHAINED':
        return { path: request.params?.path, amount: request.amount, minOutput: request.params?.minOutput ?? null, poolType: request.params?.poolType ?? DEFAULT_POOL_TYPE };
      case 'DEPOSIT':
        return { assetA: request.asset, assetB: request.params?.assetB, amount: request.amount };
      case 'WITHDRAW':
        return { poolId: request.params?.poolId, amount: request.amount };
      case 'POOL_DISCOVERY':
        return {};
    }
  }

  const adapter: ProtocolAdapter = {
    protocol: 'phoenix',
    version: PHOENIX_ADAPTER_VERSION,

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
      const action = request.action as PhoenixAction;
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
      const action = request.action as PhoenixAction;
      const method = ROUTER_METHOD_BY_ACTION[action];

      const warnings: string[] = [];
      let estimatedOutputs: Record<string, string> = {};
      let estimatedFees = '0.000000';
      let estimatedSlippagePct = 0;
      let contractId: string | undefined;

      // Every client call this branch makes (factory/pool/multihop) is inside this try — a
      // client failure (unreachable, malformed response, nonexistent pool) must degrade
      // simulate() to a failed SimulationResult, never a thrown rejection, matching how a Soroban
      // RPC-level failure is handled below. `contractId` resolution (which itself calls the
      // factory client for DEPOSIT/WITHDRAW) previously happened *before* this try block — a
      // factory failure there propagated as an uncaught rejection. Found during production audit
      // (same bug class as the Aquarius integration's simulate()-throws-instead-of-fails fix).
      try {
        if (action === 'POOL_DISCOVERY') {
          const pools = await options.factoryClient.listPools(network);
          estimatedOutputs = { poolCount: String(pools.length) };
        } else if (action === 'DEPOSIT') {
          const assetB = request.params?.assetB as string;
          const pool = await options.factoryClient.findPoolByPair(request.asset, assetB, network);
          if (!pool) throw new Error(`no Phoenix pool exists for asset pair '${request.asset}'/'${assetB}'`);
          assertValidPool(pool, 'Phoenix factory client');
          contractId = pool.poolId;
          const result = await options.poolClient.quoteProvideLiquidity(pool.poolId, request.asset, assetB, request.amount, network);
          estimatedOutputs = { lpTokens: result.estimatedLpTokens };
          estimatedSlippagePct = result.priceImpactPct;
          estimatedFees = (Number(request.amount) * (feeRatePct / 100)).toFixed(6);
        } else if (action === 'WITHDRAW') {
          contractId = request.params?.poolId as string;
          const result = await options.poolClient.quoteWithdrawLiquidity(contractId, request.amount, network);
          estimatedOutputs = { assetA: result.estimatedAssetA, assetB: result.estimatedAssetB };
        } else {
          contractId = getPhoenixMultihopContractId(network);
          const quote = await buildQuote(request);
          estimatedOutputs = { [quote.outputAsset]: quote.outputAmount };
          estimatedFees = quote.estimatedFees;
          estimatedSlippagePct = quote.priceImpactPct;
          if (quote.priceImpactPct > maxSlippagePct) warnings.push(`estimated price impact (${quote.priceImpactPct}%) is high`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const base = { success: false, estimatedFees: '0.000000', estimatedSlippagePct: 0, warnings: [], errors: [`client failure: ${message}`], estimatedOutputs: {} };
        return { ...base, simulationHash: hashSimulationResult(base) };
      }

      const rpcArgs = buildRouterArgs(action, request);
      let rpcResult: { success: boolean; cost: string; result: Record<string, unknown>; errors: string[] };
      try {
        rpcResult = method && contractId ? await options.sorobanRpcClient.simulateTransaction(contractId, method, rpcArgs, network) : { success: true, cost: '0', result: {}, errors: [] };
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
      const action = request.action as PhoenixAction;
      const method = ROUTER_METHOD_BY_ACTION[action];
      if (!method) throw new Error(`Action '${action}' is read-only and has no transaction to build.`);

      let contractId: string;
      if (action === 'DEPOSIT') {
        const pool = await options.factoryClient.findPoolByPair(request.asset, request.params?.assetB as string, network);
        if (!pool) throw new Error(`no Phoenix pool exists for asset pair '${request.asset}'/'${request.params?.assetB}'`);
        assertValidPool(pool, 'Phoenix factory client');
        contractId = pool.poolId;
      } else if (action === 'WITHDRAW') {
        contractId = request.params?.poolId as string;
      } else {
        contractId = getPhoenixMultihopContractId(network);
      }

      const args = buildRouterArgs(action, request);
      const base: Omit<TransactionBuilder, 'transactionHash'> = { protocol: 'phoenix', action, network, contractId, method, args };
      return { ...base, transactionHash: hashTransaction(base) };
    },

    async execute(): Promise<AdapterExecutionResult> {
      throw new PhoenixExecutionNotImplementedError();
    },
  };

  return adapter;
}
