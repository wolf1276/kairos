// Deterministic in-memory test double for SoroswapRouterClient / SorobanRpcClient. NOT a real
// Soroban/Soroswap integration — exists so the adapter (and its own tests) can be exercised
// without a live network, with fully predictable outputs.
import type { SoroswapRouterClient, SorobanRpcClient, RouteResult } from './types.js';

export interface DeterministicRouterOptions {
  rates?: Record<string, number>;
  priceImpactFraction?: number; // fraction of output amount reported as price impact
  pairs?: Set<string>; // 'A|B' pair keys that exist; if undefined, all pairs exist
}

function rateFor(rates: Record<string, number>, from: string, to: string): number {
  return rates[`${from}->${to}`] ?? 1;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

export function createDeterministicRouterClient(options: DeterministicRouterOptions = {}): SoroswapRouterClient {
  const rates = options.rates ?? {};
  const priceImpactFraction = options.priceImpactFraction ?? 0.002;

  return {
    async quoteSwap(path: string[], amountIn: string): Promise<RouteResult> {
      let output = Number(amountIn);
      for (let i = 1; i < path.length; i++) output *= rateFor(rates, path[i - 1], path[i]);
      return {
        path,
        outputAmount: output.toFixed(6),
        priceImpactPct: Number((priceImpactFraction * 100).toFixed(4)),
      };
    },
    async quoteAddLiquidity(_assetA, _assetB, amountA, amountB) {
      const lp = ((Number(amountA) + Number(amountB)) / 2) * 0.999;
      return { lpTokensMinted: lp.toFixed(6), priceImpactPct: 0.05 };
    },
    async quoteRemoveLiquidity(_assetA, _assetB, lpAmount) {
      const half = (Number(lpAmount) / 2).toFixed(6);
      return { assetAReturned: half, assetBReturned: half };
    },
    async pairExists(assetA: string, assetB: string) {
      if (!options.pairs) return true;
      return options.pairs.has(pairKey(assetA, assetB));
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
