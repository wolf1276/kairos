// Aquarius-specific types. The adapter itself only depends on these + the generic
// ProtocolAdapter/Quote/TransactionBuilder shapes from `protocolAdapters/types.ts` — no Soroban
// SDK type ever appears here, since none is wired into this framework (out of scope: protocol
// execution).
export const AQUARIUS_ACTIONS = ['SWAP', 'SWAP_CHAINED', 'DEPOSIT', 'WITHDRAW', 'CLAIM_REWARDS', 'POOL_DISCOVERY'] as const;
export type AquariusAction = (typeof AQUARIUS_ACTIONS)[number];

export interface PoolInfo {
  poolId: string;
  assetA: string;
  assetB: string;
  concentratedLiquidity: boolean;
}

export interface RouteResult {
  path: string[];
  estimatedOutput: string;
  priceImpactPct: number;
}

/** The router's on-chain read surface, as it would be exposed by the real Aquarius Router
 *  contract (`swap_chained`, `deposit`, `withdraw`, `claim_rewards`) — a caller-supplied
 *  implementation. This framework ships no real Soroban integration; only the interface plus a
 *  deterministic in-memory double for tests (`aquarius/testDoubles.ts`). Every method here
 *  produces read-only estimates for quoting/simulation — nothing here submits a transaction. */
export interface AquariusRouterClient {
  listPools(network: string): Promise<PoolInfo[]>;
  quoteSwapChained(path: string[], amount: string, network: string): Promise<RouteResult>;
  quoteDeposit(assetA: string, assetB: string, amount: string, network: string): Promise<{ estimatedLpTokens: string; priceImpactPct: number }>;
  quoteWithdraw(poolId: string, amount: string, network: string): Promise<{ estimatedAssetA: string; estimatedAssetB: string }>;
  quoteClaimRewards(poolId: string, network: string): Promise<{ estimatedRewards: string; rewardAsset: string }>;
}

/** Off-chain path-finding service. Optional — the adapter falls back to on-chain routing (a
 *  direct single-hop path) whenever this is unset or `findRoute` rejects/returns null. */
export interface AquariusBackendApiClient {
  findRoute(inputAsset: string, outputAsset: string, amount: string, network: string): Promise<RouteResult | null>;
}

/** Soroban RPC's simulation surface — the only chain interaction this framework performs before
 *  execution (which itself is out of scope: no submission is ever implemented here). */
export interface SorobanRpcClient {
  simulateTransaction(contractId: string, method: string, args: Record<string, unknown>, network: string): Promise<{ success: boolean; cost: string; result: Record<string, unknown>; errors: string[] }>;
}
