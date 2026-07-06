import { Execution } from '../types';

export type ProtocolId = 'blend' | 'soroswap';

export interface ProtocolConfig {
  contractId: string;
  kind: 'lending' | 'amm';
}

/** How a protocol action affects a locally-tracked position — see `ProtocolPositionDelta`.
 *  Canonical definition lives here (not in a consuming app's DB layer) since it's part of what
 *  a protocol adapter's action vocabulary means, not app-specific storage detail. */
export type ProtocolPositionKind = 'lend' | 'lp';

/** Signed change to apply to a locally-tracked (agent, protocol, asset) position after an
 *  action lands on-chain — positive for deposit/swap-in, negative for withdraw. */
export interface ProtocolPositionDelta {
  asset: string;
  kind: ProtocolPositionKind;
  delta: bigint;
}

/** Everything a caller needs to submit a protocol action and record its local effect, built
 *  entirely by the adapter — callers never branch on protocol id or hand-construct either the
 *  on-chain `Execution` or the position bookkeeping themselves. */
export interface ProtocolActionResult {
  execution: Execution;
  positionDelta: ProtocolPositionDelta;
  /** Human-readable audit-log line for this action, given its confirmed on-chain tx hash. */
  describe(txHash: string): string;
}

/** Per-protocol request shapes a `buildAction` implementation accepts. Adding a protocol means
 *  adding a member here plus a new adapter — no orchestration code branches on these. */
export interface BlendActionRequest {
  protocolId: 'blend';
  action: 'deposit' | 'withdraw';
  asset: string;
  amount: bigint;
  /** Owner address protocol funds move to/from (Blend's `submit` treats from/spender/to as the
   *  same delegator-owned address for a simple, non-collateralized supply/withdraw). */
  owner: string;
}

export interface SoroswapActionRequest {
  protocolId: 'soroswap';
  action: 'swap';
  path: string[];
  amountIn: bigint;
  minAmountOut: bigint;
  deadline: bigint;
  /** Address the swap's output is credited to. */
  owner: string;
}

export type ProtocolActionRequest = BlendActionRequest | SoroswapActionRequest;

export interface ProtocolAdapter {
  readonly id: ProtocolId;
  readonly contractId: string;
  /** Builds the on-chain `Execution` plus the local position delta and audit description for a
   *  generic action request. The only protocol-specific branch a caller needs. */
  buildAction(input: ProtocolActionRequest): ProtocolActionResult;
}

export interface LendingAdapter extends ProtocolAdapter {
  deposit(params: { asset: string; amount: bigint; onBehalfOf: string }): Execution;
  withdraw(params: { asset: string; amount: bigint; to: string }): Execution;
}

export interface AmmAdapter extends ProtocolAdapter {
  swapExactIn(params: {
    path: string[];
    amountIn: bigint;
    minAmountOut: bigint;
    to: string;
    deadline: bigint;
  }): Execution;
}
