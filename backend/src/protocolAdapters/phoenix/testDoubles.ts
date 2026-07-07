// Deterministic in-memory test doubles for PhoenixMultihopClient / PhoenixFactoryClient /
// PhoenixPoolClient / SorobanRpcClient. NOT a real Soroban/Phoenix integration — these exist so
// the adapter (and its own tests) can be exercised without a live network, with fully
// predictable outputs.
import type { PhoenixMultihopClient, PhoenixFactoryClient, PhoenixPoolClient, SorobanRpcClient, PoolInfo, SwapHop, MultihopSwapResult } from './types.js';

export interface DeterministicMultihopOptions {
  rates?: Record<string, number>;
  spreadFraction?: number; // fraction of output amount reported as spread
  commissionFraction?: number;
}

function rateFor(rates: Record<string, number>, from: string, to: string): number {
  return rates[`${from}->${to}`] ?? 1;
}

export function createDeterministicMultihopClient(options: DeterministicMultihopOptions = {}): PhoenixMultihopClient {
  const rates = options.rates ?? {};
  const spreadFraction = options.spreadFraction ?? 0.001;
  const commissionFraction = options.commissionFraction ?? 0.003;
  return {
    async simulateSwap(operations: SwapHop[], amount: string, _poolType, _network): Promise<MultihopSwapResult> {
      let output = Number(amount);
      for (const hop of operations) output *= rateFor(rates, hop.offerAsset, hop.askAsset);
      return {
        outputAmount: output.toFixed(6),
        spreadAmount: (output * spreadFraction).toFixed(6),
        totalCommission: (output * commissionFraction).toFixed(6),
      };
    },
  };
}

export interface DeterministicFactoryOptions {
  pools?: PoolInfo[];
  failListPools?: boolean;
}

export function createDeterministicFactoryClient(options: DeterministicFactoryOptions = {}): PhoenixFactoryClient {
  const pools = options.pools ?? [
    { poolId: 'CPOOL-XLM-USDC', assetA: 'XLM', assetB: 'USDC', poolType: 'xyk' as const },
    { poolId: 'CPOOL-USDC-PHO', assetA: 'USDC', assetB: 'PHO', poolType: 'xyk' as const },
  ];
  return {
    async listPools() {
      if (options.failListPools) throw new Error('factory unavailable: query_all_pools_details failed');
      return pools;
    },
    async findPoolByPair(assetA: string, assetB: string) {
      return pools.find((p) => (p.assetA === assetA && p.assetB === assetB) || (p.assetA === assetB && p.assetB === assetA)) ?? null;
    },
  };
}

export interface DeterministicPoolClientOptions {
  lpRatio?: number;
  priceImpactPct?: number;
}

export function createDeterministicPoolClient(options: DeterministicPoolClientOptions = {}): PhoenixPoolClient {
  const lpRatio = options.lpRatio ?? 0.98;
  const priceImpactPct = options.priceImpactPct ?? 0.1;
  return {
    async quoteProvideLiquidity(_poolId, _assetA, _assetB, amount) {
      return { estimatedLpTokens: (Number(amount) * lpRatio).toFixed(6), priceImpactPct };
    },
    async quoteWithdrawLiquidity(_poolId, shareAmount) {
      const half = (Number(shareAmount) / 2).toFixed(6);
      return { estimatedAssetA: half, estimatedAssetB: half };
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
