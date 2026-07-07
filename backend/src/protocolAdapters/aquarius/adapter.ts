// AquariusAdapter: a ProtocolAdapter implementation for the Aquarius Router. Uses the Router
// contract as the single on-chain integration point (`swap_chained`, `deposit`, `withdraw`,
// `claim_rewards`) — never a pool contract directly, except where the Router itself requires a
// poolId for a concentrated-liquidity action (WITHDRAW/CLAIM_REWARDS/POOL_DISCOVERY). No Soroban
// SDK dependency: `AquariusRouterClient`/`SorobanRpcClient`/`AquariusBackendApiClient` are
// caller-supplied interfaces (see `testDoubles.ts` for a deterministic double) — this file never
// calls a protocol SDK itself, matching the framework's core rule. Transaction *execution*
// (signing/submission) is explicitly out of scope: `execute()` always throws.
import { hashQuote, hashTransaction } from './hashing.js';
import { getAquariusRouterContractId, type AquariusNetwork } from './config.js';
import { AQUARIUS_ACTIONS, type AquariusAction, type AquariusRouterClient, type AquariusBackendApiClient, type SorobanRpcClient } from './types.js';
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

export const AQUARIUS_ADAPTER_VERSION = '1.0.0';
export const NATIVE_ASSET = 'XLM';
export const DEFAULT_MAX_SLIPPAGE_PCT = 5;
export const DEFAULT_FEE_RATE_PCT = 0.3;

const ROUTER_METHOD_BY_ACTION: Record<AquariusAction, string | null> = {
  SWAP: 'swap_chained',
  SWAP_CHAINED: 'swap_chained',
  DEPOSIT: 'deposit',
  WITHDRAW: 'withdraw',
  CLAIM_REWARDS: 'claim_rewards',
  POOL_DISCOVERY: null, // read-only — no transaction to build
};

export class AquariusExecutionNotImplementedError extends Error {
  constructor() {
    super('AquariusAdapter.execute() is not implemented — protocol execution (signing/submission) is explicitly out of scope for this phase. Use simulate()/buildTransaction() instead.');
    this.name = 'AquariusExecutionNotImplementedError';
  }
}

export interface AquariusAdapterOptions {
  supportedAssets: string[];
  routerClient: AquariusRouterClient;
  sorobanRpcClient: SorobanRpcClient;
  backendApiClient?: AquariusBackendApiClient;
  maxSlippagePct?: number;
  feeRatePct?: number;
  onHealth?: () => Promise<HealthStatus> | HealthStatus;
}

function isNative(asset: string): boolean {
  return asset.toUpperCase() === NATIVE_ASSET;
}

function requestedNetwork(request: AdapterActionRequest): AquariusNetwork {
  if (request.network !== 'testnet' && request.network !== 'mainnet') {
    throw new Error(`Invalid Aquarius network '${request.network}' — must be 'testnet' or 'mainnet'.`);
  }
  return request.network;
}

export function createAquariusAdapter(options: AquariusAdapterOptions): ProtocolAdapter {
  const maxSlippagePct = options.maxSlippagePct ?? DEFAULT_MAX_SLIPPAGE_PCT;
  const feeRatePct = options.feeRatePct ?? DEFAULT_FEE_RATE_PCT;

  const capabilities: ProtocolCapabilities = {
    protocol: 'aquarius',
    supportedActions: [...AQUARIUS_ACTIONS],
    supportedAssets: [...options.supportedAssets],
    supportedNetworks: ['testnet', 'mainnet'],
    simulationSupport: true,
    batchingSupport: true, // swap_chained supports multi-hop
    rollbackSupport: false, // router swaps/deposits are not compensable by this adapter
  };

  function validateShape(request: AdapterActionRequest): string[] {
    const errors: string[] = [];
    if (!AQUARIUS_ACTIONS.includes(request.action as AquariusAction)) {
      errors.push(`action '${request.action}' is not supported by 'aquarius' (supported: ${AQUARIUS_ACTIONS.join(', ')})`);
      return errors;
    }
    if (request.network !== 'testnet' && request.network !== 'mainnet') {
      errors.push(`network '${request.network}' is not supported by 'aquarius' (supported: testnet, mainnet)`);
    }
    return errors;
  }

  function checkAssetSupported(asset: string, errors: string[], label = 'asset'): void {
    if (!options.supportedAssets.includes(asset)) errors.push(`${label} '${asset}' is not supported by 'aquarius'`);
  }

  /** `request.amount` was never validated — a non-numeric string ("abc"/""), "NaN", "Infinity",
   *  or a negative value all passed `validate()` cleanly and then silently produced
   *  `estimatedFees: "NaN"` / `"Infinity"` / a negative fee in an otherwise `success: true`
   *  SimulationResult. Also rejects more decimal precision than Stellar assets actually support
   *  (7 decimal places) — a higher-precision amount is not a value that could ever exist
   *  on-chain. Found during the Protocol Layer final production audit (same bug class
   *  independently found and fixed in the Phoenix adapter). */
  function checkAmount(request: AdapterActionRequest, errors: string[]): void {
    const value = Number(request.amount);
    if (request.amount === '' || !Number.isFinite(value) || value < 0) {
      errors.push(`amount '${request.amount}' must be a non-negative finite decimal string`);
      return;
    }
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
   *  `buildRouterArgs` already threads `minOutput` through to the built transaction without ever
   *  requiring the caller supply one or a deadline — the same fund-loss bug class the Soroswap
   *  adapter's audit already fixed. Found here during the Protocol Layer final production audit
   *  and fixed identically. */
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

  async function validateRequest(request: AdapterActionRequest): Promise<ValidationResult> {
    const errors = validateShape(request);
    if (errors.length > 0) return { ok: false, errors };

    const health = await adapterHealth();
    if (health === 'UNAVAILABLE' || health === 'UNKNOWN') errors.push(`Aquarius router is not available (health: ${health})`);

    checkAmount(request, errors);

    const action = request.action as AquariusAction;
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
        break;
      }
      case 'SWAP_CHAINED': {
        const path = checkPath(request.params?.path, request, errors);
        if (path) for (const hop of path) checkTrustline(hop, request, errors);
        checkSlippage(request, errors);
        checkDeadline(request, errors);
        checkMinOutput(request, errors);
        break;
      }
      case 'DEPOSIT': {
        checkAssetSupported(request.asset, errors, 'asset');
        const assetB = request.params?.assetB;
        if (typeof assetB !== 'string' || assetB.length === 0) errors.push('params.assetB is required for DEPOSIT');
        else checkAssetSupported(assetB, errors, 'assetB');
        checkTrustline(request.asset, request, errors);
        if (typeof assetB === 'string') checkTrustline(assetB, request, errors);
        break;
      }
      case 'WITHDRAW':
      case 'CLAIM_REWARDS': {
        const poolId = request.params?.poolId;
        if (typeof poolId !== 'string' || poolId.length === 0) errors.push(`params.poolId is required for ${action}`);
        break;
      }
      case 'POOL_DISCOVERY':
        break;
    }

    return { ok: errors.length === 0, errors };
  }

  /** `options.onHealth` is caller-supplied and may perform a real health check (RPC call, etc.)
   *  that can itself fail — a throwing health check must be treated as UNAVAILABLE, not propagate
   *  as an uncaught rejection out of validate()/simulate()/quote()/buildTransaction() (all of
   *  which call this). Found during the Protocol Layer final production audit (same bug class
   *  independently found and fixed in the Phoenix adapter). */
  async function adapterHealth(): Promise<HealthStatus> {
    if (!options.onHealth) return 'READY';
    try {
      return await options.onHealth();
    } catch {
      return 'UNAVAILABLE';
    }
  }

  /** A malformed response from a caller-supplied router/backend client (wrong shape — e.g. a
   *  non-array `path`, a non-string `estimatedOutput`) must never propagate into a Quote or
   *  TransactionBuilder silently; this adapter does not control what a real client returns, so it
   *  re-validates every external response shape at the boundary, fail-closed. */
  function assertValidRouteResult(route: { path: unknown; estimatedOutput: unknown; priceImpactPct: unknown }, source: string): asserts route is { path: string[]; estimatedOutput: string; priceImpactPct: number } {
    if (!Array.isArray(route.path) || route.path.some((p) => typeof p !== 'string') || route.path.length < 2) {
      throw new Error(`Malformed route from ${source}: 'path' must be an array of at least 2 asset codes.`);
    }
    if (typeof route.estimatedOutput !== 'string' || route.estimatedOutput.length === 0) {
      throw new Error(`Malformed route from ${source}: 'estimatedOutput' must be a non-empty string.`);
    }
    if (typeof route.priceImpactPct !== 'number' || !Number.isFinite(route.priceImpactPct)) {
      throw new Error(`Malformed route from ${source}: 'priceImpactPct' must be a finite number.`);
    }
  }

  /** Resolves a route for a SWAP: tries the optional backend API first (path finding), and
   *  falls back to on-chain routing (a direct hop through the router) whenever the backend is
   *  unset, throws, or returns null — per the requirement "if the backend API is unavailable,
   *  continue using on-chain routing where supported." */
  async function resolveSwapRoute(inputAsset: string, outputAsset: string, amount: string, network: AquariusNetwork): Promise<{ path: string[]; estimatedOutput: string; priceImpactPct: number; source: 'on-chain' | 'backend-api' }> {
    if (options.backendApiClient) {
      try {
        const backendRoute = await options.backendApiClient.findRoute(inputAsset, outputAsset, amount, network);
        if (backendRoute) {
          assertValidRouteResult(backendRoute, 'Aquarius backend API');
          return { ...backendRoute, source: 'backend-api' };
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('Malformed route')) throw err;
        // Any other backend API failure (unreachable, timeout, etc.) — fall through to on-chain
        // routing, per spec. A malformed *response* (above) is a different failure mode than
        // "unavailable" and is never silently swallowed.
      }
    }
    const onChain = await options.routerClient.quoteSwapChained([inputAsset, outputAsset], amount, network);
    assertValidRouteResult(onChain, 'Aquarius Router (on-chain)');
    return { ...onChain, source: 'on-chain' };
  }

  async function buildQuote(request: AdapterActionRequest): Promise<Quote> {
    const network = requestedNetwork(request);
    const action = request.action as AquariusAction;
    let route: { path: string[]; estimatedOutput: string; priceImpactPct: number; source: 'on-chain' | 'backend-api' };
    let outputAsset: string;

    if (action === 'SWAP_CHAINED') {
      const path = request.params?.path as string[];
      const result = await options.routerClient.quoteSwapChained(path, request.amount, network);
      assertValidRouteResult(result, 'Aquarius Router (on-chain)');
      route = { ...result, source: 'on-chain' };
      outputAsset = path[path.length - 1];
    } else {
      outputAsset = request.params?.outputAsset as string;
      route = await resolveSwapRoute(request.asset, outputAsset, request.amount, network);
    }

    const fees = (Number(request.amount) * (feeRatePct / 100)).toFixed(6);
    const base: Omit<Quote, 'quoteHash'> = {
      protocol: 'aquarius',
      action,
      inputAsset: request.asset,
      outputAsset,
      inputAmount: request.amount,
      outputAmount: route.estimatedOutput,
      route: route.path,
      priceImpactPct: route.priceImpactPct,
      estimatedFees: fees,
      source: route.source,
    };
    return { ...base, quoteHash: hashQuote(base) };
  }

  const adapter: ProtocolAdapter = {
    protocol: 'aquarius',
    version: AQUARIUS_ADAPTER_VERSION,

    async initialize() {
      // No-op: nothing to warm up without a real Soroban connection. Present for interface
      // conformance and so a future real integration has a defined hook.
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
      const action = request.action as AquariusAction;
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
      const action = request.action as AquariusAction;
      const contractId = getAquariusRouterContractId(network);
      const method = ROUTER_METHOD_BY_ACTION[action];

      const warnings: string[] = [];
      let estimatedOutputs: Record<string, string> = {};
      let estimatedFees = '0.000000';
      let estimatedSlippagePct = 0;

      // A router/backend client failure (unreachable router, nonexistent contract, network
      // error) must degrade `simulate()` to a failed SimulationResult, never a thrown rejection —
      // matches how a Soroban RPC failure below is already handled gracefully, and is what a
      // caller iterating over multiple protocols expects from every adapter's simulate(). Found
      // via a real integration test against a syntactically valid but undeployed contract id,
      // where the client-level exception was previously left to propagate uncaught.
      try {
        if (action === 'POOL_DISCOVERY') {
          const pools = await options.routerClient.listPools(network);
          estimatedOutputs = { poolCount: String(pools.length) };
        } else if (action === 'DEPOSIT') {
          const assetB = request.params?.assetB as string;
          const result = await options.routerClient.quoteDeposit(request.asset, assetB, request.amount, network);
          estimatedOutputs = { lpTokens: result.estimatedLpTokens };
          estimatedSlippagePct = result.priceImpactPct;
          estimatedFees = (Number(request.amount) * (feeRatePct / 100)).toFixed(6);
        } else if (action === 'WITHDRAW') {
          const poolId = request.params?.poolId as string;
          const result = await options.routerClient.quoteWithdraw(poolId, request.amount, network);
          estimatedOutputs = { assetA: result.estimatedAssetA, assetB: result.estimatedAssetB };
        } else if (action === 'CLAIM_REWARDS') {
          const poolId = request.params?.poolId as string;
          const result = await options.routerClient.quoteClaimRewards(poolId, network);
          estimatedOutputs = { rewards: result.estimatedRewards, rewardAsset: result.rewardAsset };
        } else {
          const quote = await buildQuote(request);
          estimatedOutputs = { [quote.outputAsset]: quote.outputAmount };
          estimatedFees = quote.estimatedFees;
          estimatedSlippagePct = quote.priceImpactPct;
          if (quote.priceImpactPct > maxSlippagePct) warnings.push(`estimated price impact (${quote.priceImpactPct}%) is high`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const base = { success: false, estimatedFees: '0.000000', estimatedSlippagePct: 0, warnings: [], errors: [`router client failure: ${message}`], estimatedOutputs: {} };
        return { ...base, simulationHash: hashSimulationResult(base) };
      }

      const rpcArgs = buildRouterArgs(action, request);
      let rpcResult: { success: boolean; cost: string; result: Record<string, unknown>; errors: string[] };
      try {
        rpcResult = method ? await options.sorobanRpcClient.simulateTransaction(contractId, method, rpcArgs, network) : { success: true, cost: '0', result: {}, errors: [] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        rpcResult = { success: false, cost: '0', result: {}, errors: [`Soroban RPC failure: ${message}`] };
      }

      const base = {
        success: rpcResult.success,
        estimatedFees,
        estimatedSlippagePct,
        warnings,
        errors: rpcResult.errors,
        estimatedOutputs,
      };
      return { ...base, simulationHash: hashSimulationResult(base) };
    },

    async buildTransaction(request): Promise<TransactionBuilder> {
      const validation = await validateRequest(request);
      if (!validation.ok) throw new Error(`Cannot build a transaction for an invalid request: ${validation.errors.join('; ')}`);

      const network = requestedNetwork(request);
      const action = request.action as AquariusAction;
      const method = ROUTER_METHOD_BY_ACTION[action];
      if (!method) throw new Error(`Action '${action}' is read-only and has no transaction to build.`);

      const contractId = getAquariusRouterContractId(network);
      const args = buildRouterArgs(action, request);
      const base: Omit<TransactionBuilder, 'transactionHash'> = { protocol: 'aquarius', action, network, contractId, method, args };
      return { ...base, transactionHash: hashTransaction(base) };
    },

    async execute(): Promise<AdapterExecutionResult> {
      throw new AquariusExecutionNotImplementedError();
    },
  };

  return adapter;
}

function buildRouterArgs(action: AquariusAction, request: AdapterActionRequest): Record<string, unknown> {
  switch (action) {
    case 'SWAP':
      return { path: [request.asset, request.params?.outputAsset], amount: request.amount, minOutput: request.params?.minOutput ?? null };
    case 'SWAP_CHAINED':
      return { path: request.params?.path, amount: request.amount, minOutput: request.params?.minOutput ?? null };
    case 'DEPOSIT':
      return { assetA: request.asset, assetB: request.params?.assetB, amount: request.amount };
    case 'WITHDRAW':
      return { poolId: request.params?.poolId, amount: request.amount };
    case 'CLAIM_REWARDS':
      return { poolId: request.params?.poolId };
    case 'POOL_DISCOVERY':
      return {};
  }
}
