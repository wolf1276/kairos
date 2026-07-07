// Blend-specific types. Blend is a lending/borrowing protocol (not swap-shaped) — its request
// vocabulary is DEPOSIT/WITHDRAW/BORROW/REPAY, and it deliberately does NOT implement the
// framework's optional `quote()` (see `../types.ts`: "not every protocol has a meaningful
// quote (e.g. a pure lending pool)"). The adapter itself only depends on these + the generic
// ProtocolAdapter/TransactionBuilder shapes from `protocolAdapters/types.ts` — no Soroban SDK
// type ever appears here, since none is wired into this framework (out of scope: protocol
// execution).
export const BLEND_ACTIONS = ['DEPOSIT', 'WITHDRAW', 'BORROW', 'REPAY'] as const;
export type BlendAction = (typeof BLEND_ACTIONS)[number];

export interface ReserveData {
  asset: string;
  supplyAprPct: number;
  borrowAprPct: number;
  collateralFactorPct: number;
  liabilityFactorPct: number;
}

export interface DepositResult {
  bTokensMinted: string;
}

export interface WithdrawResult {
  underlyingReturned: string;
}

export interface BorrowResult {
  debtTokensMinted: string;
}

export interface RepayResult {
  debtRemaining: string;
}

/** A user's position snapshot, used to enforce collateral/health-factor safety checks before
 *  BORROW/WITHDRAW is allowed to proceed. `healthFactor` follows Blend's own convention: below
 *  1.0 means the position is eligible for liquidation; this adapter treats anything below the
 *  configured minimum as unsafe and rejects the action outright (fail-closed), not merely a
 *  warning — a wrong lending health check is a fund-loss bug, not a UX nit. */
export interface UserPosition {
  healthFactor: number;
  totalCollateralUsd: string;
  totalLiabilitiesUsd: string;
}

/** The Blend pool's read surface (`submit` request simulation) — a caller-supplied
 *  implementation. This framework ships no real Soroban integration; only the interface plus a
 *  deterministic in-memory double for tests (`blend/testDoubles.ts`). Every method here produces
 *  read-only estimates for quoting/simulation — nothing here submits a transaction. */
export interface BlendPoolClient {
  getReserveData(asset: string, network: string): Promise<ReserveData>;
  getUserPosition(owner: string, network: string): Promise<UserPosition>;
  simulateDeposit(asset: string, amount: string, network: string): Promise<DepositResult>;
  simulateWithdraw(asset: string, amount: string, network: string): Promise<WithdrawResult>;
  simulateBorrow(asset: string, amount: string, network: string): Promise<BorrowResult>;
  simulateRepay(asset: string, amount: string, network: string): Promise<RepayResult>;
  /** Projects the health factor a user's position would have *after* a given action, so BORROW
   *  and WITHDRAW can be rejected before submission rather than discovered as a failed
   *  transaction (or worse, a liquidation) on-chain. */
  projectHealthFactor(owner: string, action: BlendAction, asset: string, amount: string, network: string): Promise<number>;
}

/** Soroban RPC's simulation surface — the only chain interaction this framework performs before
 *  execution (which itself is out of scope: no submission is ever implemented here). */
export interface SorobanRpcClient {
  simulateTransaction(contractId: string, method: string, args: Record<string, unknown>, network: string): Promise<{ success: boolean; cost: string; result: Record<string, unknown>; errors: string[] }>;
}
