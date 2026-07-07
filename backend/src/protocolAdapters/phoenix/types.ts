// Phoenix-specific types. Function shapes mirror the real Phoenix contracts (verified against
// https://github.com/Phoenix-Protocol-Group/phoenix-contracts):
//   multihop.swap(recipient, operations: Vec<Swap>, max_spread_bps, amount, pool_type, deadline, max_allowed_fee_bps)
//   multihop.simulate_swap(operations, amount, pool_type) -> SimulateSwapResponse
//   factory.query_all_pools_details() -> Vec<LiquidityPoolInfo>
//   factory.query_for_pool_by_token_pair(token_a, token_b) -> Address
//   pool.provide_liquidity(depositor, desired_a, min_a, desired_b, min_b, custom_slippage_bps, deadline, auto_stake)
//   pool.withdraw_liquidity(recipient, share_amount, min_a, min_b, deadline, auto_unstake) -> (i128, i128)
// No Soroban SDK dependency in this file — only the caller-supplied client interfaces below.
export const PHOENIX_ACTIONS = ['SWAP', 'SWAP_CHAINED', 'DEPOSIT', 'WITHDRAW', 'POOL_DISCOVERY'] as const;
export type PhoenixAction = (typeof PHOENIX_ACTIONS)[number];

export const PHOENIX_POOL_TYPES = ['xyk', 'stable'] as const;
export type PhoenixPoolType = (typeof PHOENIX_POOL_TYPES)[number];

export interface PoolInfo {
  poolId: string;
  assetA: string;
  assetB: string;
  poolType: PhoenixPoolType;
}

export interface SwapHop {
  offerAsset: string;
  askAsset: string;
  askAssetMinAmount: string | null;
}

export interface MultihopSwapResult {
  outputAmount: string;
  spreadAmount: string;
  totalCommission: string;
}

/** The multihop (router) contract's read surface — matches `simulate_swap`. Every method
 *  produces a read-only estimate; nothing here submits a transaction. */
export interface PhoenixMultihopClient {
  simulateSwap(operations: SwapHop[], amount: string, poolType: PhoenixPoolType, network: string): Promise<MultihopSwapResult>;
}

/** The factory contract's pool-discovery surface — matches `query_all_pools_details` /
 *  `query_for_pool_by_token_pair`. */
export interface PhoenixFactoryClient {
  listPools(network: string): Promise<PoolInfo[]>;
  findPoolByPair(assetA: string, assetB: string, network: string): Promise<PoolInfo | null>;
}

export interface ProvideLiquidityQuote {
  estimatedLpTokens: string;
  priceImpactPct: number;
}

export interface WithdrawLiquidityQuote {
  estimatedAssetA: string;
  estimatedAssetB: string;
}

/** The individual pool contract's read surface for liquidity actions — matches
 *  `provide_liquidity` / `withdraw_liquidity`. Phoenix has no single router for liquidity, so
 *  this talks to the specific pool contract discovered via `PhoenixFactoryClient` — a real
 *  architectural difference from Aquarius, not an inconsistency. */
export interface PhoenixPoolClient {
  quoteProvideLiquidity(poolId: string, assetA: string, assetB: string, amount: string, network: string): Promise<ProvideLiquidityQuote>;
  quoteWithdrawLiquidity(poolId: string, shareAmount: string, network: string): Promise<WithdrawLiquidityQuote>;
}

/** Soroban RPC's simulation surface — the only chain interaction this adapter performs.
 *  Simulation only; no `sendTransaction` capability exists anywhere in this integration. */
export interface SorobanRpcClient {
  simulateTransaction(contractId: string, method: string, args: Record<string, unknown>, network: string): Promise<{ success: boolean; cost: string; result: Record<string, unknown>; errors: string[] }>;
}
