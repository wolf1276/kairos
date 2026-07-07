// Deterministic in-memory test doubles for AquariusRouterClient / SorobanRpcClient /
// AquariusBackendApiClient. NOT a real Soroban/Aquarius integration — implementing that is
// explicitly out of scope. These exist so the adapter (and its own tests) can be exercised
// without a live network, with fully predictable outputs.
import type { AquariusRouterClient, AquariusBackendApiClient, SorobanRpcClient, PoolInfo, RouteResult } from './types.js';

export interface DeterministicRouterOptions {
  pools?: PoolInfo[];
  /** Deterministic exchange rate per asset pair, e.g. `{ 'XLM->USDC': 0.12 }`. Missing pairs
   *  default to a 1:1 rate so tests don't need to enumerate every pair. */
  rates?: Record<string, number>;
  priceImpactPct?: number;
  failListPools?: boolean;
}

function rateFor(rates: Record<string, number>, from: string, to: string): number {
  return rates[`${from}->${to}`] ?? 1;
}

export function createDeterministicRouterClient(options: DeterministicRouterOptions = {}): AquariusRouterClient {
  const pools = options.pools ?? [{ poolId: 'pool-xlm-usdc', assetA: 'XLM', assetB: 'USDC', concentratedLiquidity: false }];
  const rates = options.rates ?? {};
  const priceImpactPct = options.priceImpactPct ?? 0.1;

  return {
    async listPools() {
      if (options.failListPools) throw new Error('router unavailable: listPools failed');
      return pools;
    },
    async quoteSwapChained(path, amount): Promise<RouteResult> {
      let output = Number(amount);
      for (let i = 1; i < path.length; i++) output *= rateFor(rates, path[i - 1], path[i]);
      return { path, estimatedOutput: output.toFixed(6), priceImpactPct };
    },
    async quoteDeposit(assetA, assetB, amount) {
      return { estimatedLpTokens: (Number(amount) * 0.98).toFixed(6), priceImpactPct };
    },
    async quoteWithdraw(_poolId, amount) {
      const half = (Number(amount) / 2).toFixed(6);
      return { estimatedAssetA: half, estimatedAssetB: half };
    },
    async quoteClaimRewards(_poolId) {
      return { estimatedRewards: '1.000000', rewardAsset: 'AQUA' };
    },
  };
}

export interface DeterministicSorobanRpcOptions {
  success?: boolean;
  cost?: string;
  errors?: string[];
}

export function createDeterministicSorobanRpcClient(options: DeterministicSorobanRpcOptions = {}): SorobanRpcClient {
  return {
    async simulateTransaction() {
      return { success: options.success ?? true, cost: options.cost ?? '0.000100', result: {}, errors: options.errors ?? [] };
    },
  };
}

export interface DeterministicBackendApiOptions {
  route?: RouteResult | null;
  unavailable?: boolean;
}

export function createDeterministicBackendApiClient(options: DeterministicBackendApiOptions = {}): AquariusBackendApiClient {
  return {
    async findRoute() {
      if (options.unavailable) throw new Error('backend API unavailable');
      return options.route ?? null;
    },
  };
}
