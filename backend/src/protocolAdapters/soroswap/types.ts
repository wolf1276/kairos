// Soroswap-specific types. Soroswap is a Uniswap-V2-style AMM router
// (`swap_exact_tokens_for_tokens(amount_in, amount_out_min, path, to, deadline)`), single-router
// architecture like Aquarius (see `aquarius/types.ts`) — no separate factory contract needed for
// pair discovery, since the router itself resolves pairs. The adapter itself only depends on
// these + the generic ProtocolAdapter/Quote/TransactionBuilder shapes from
// `protocolAdapters/types.ts` — no Soroban SDK type ever appears here, since none is wired into
// this framework (out of scope: protocol execution).
export const SOROSWAP_ACTIONS = ['SWAP', 'SWAP_CHAINED', 'ADD_LIQUIDITY', 'REMOVE_LIQUIDITY'] as const;
export type SoroswapAction = (typeof SOROSWAP_ACTIONS)[number];

export interface RouteResult {
  path: string[];
  outputAmount: string;
  priceImpactPct: number;
}

export interface AddLiquidityResult {
  lpTokensMinted: string;
  priceImpactPct: number;
}

export interface RemoveLiquidityResult {
  assetAReturned: string;
  assetBReturned: string;
}

/** The Soroswap router's on-chain read surface, as it would be exposed by the real Soroswap
 *  router contract — a caller-supplied implementation. This framework ships no real Soroban
 *  integration; only the interface plus a deterministic in-memory double for tests
 *  (`soroswap/testDoubles.ts`). Every method here produces read-only estimates for
 *  quoting/simulation — nothing here submits a transaction. */
export interface SoroswapRouterClient {
  quoteSwap(path: string[], amountIn: string, network: string): Promise<RouteResult>;
  quoteAddLiquidity(assetA: string, assetB: string, amountA: string, amountB: string, network: string): Promise<AddLiquidityResult>;
  quoteRemoveLiquidity(assetA: string, assetB: string, lpAmount: string, network: string): Promise<RemoveLiquidityResult>;
  pairExists(assetA: string, assetB: string, network: string): Promise<boolean>;
}

/** Soroban RPC's simulation surface — the only chain interaction this framework performs before
 *  execution (which itself is out of scope: no submission is ever implemented here). */
export interface SorobanRpcClient {
  simulateTransaction(contractId: string, method: string, args: Record<string, unknown>, network: string): Promise<{ success: boolean; cost: string; result: Record<string, unknown>; errors: string[] }>;
}
