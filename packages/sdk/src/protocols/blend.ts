import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { Execution } from '../types';
import { RpcError } from '../errors';
import { BlendActionRequest, LendingAdapter, ProtocolActionRequest, ProtocolActionResult } from './types';

/**
 * Blend's `Request.request_type` discriminants (from Blend's public pool contract interface).
 * Only the plain (non-collateralized) supply/withdraw actions are used here — Phase 1 scope
 * is deposit/withdraw only, not borrow/collateral, which carry materially different risk.
 */
const BLEND_REQUEST_TYPE_SUPPLY = 0;
const BLEND_REQUEST_TYPE_WITHDRAW = 1;

/**
 * `submit`'s `requests: Vec<Request>` arg index, for use with a `pooled-protocol-spend-limit`
 * policy's `protocolActions` entry (paired with `valueMode: PooledSpendValueMode.RequestVecAmountSum`,
 * since the amount lives inside each `Request` map, not as a flat positional arg).
 */
export const BLEND_SUBMIT_REQUESTS_ARG_INDEX = 3;

/**
 * Builds a Blend `Request { address, amount, request_type }` struct as an ScVal map, matching
 * the field order/names Blend's contract expects for its `#[contracttype]` struct XDR encoding.
 */
function buildRequestScVal(asset: string, amount: bigint, requestType: number): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('address'),
      val: Address.fromString(asset).toScVal(),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('amount'),
      val: nativeToScVal(amount, { type: 'i128' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('request_type'),
      val: nativeToScVal(requestType, { type: 'u32' }),
    }),
  ]);
}

/**
 * Adapter for Blend's lending pool. Blend's real interface is request-based: a single
 * `submit(from, spender, to, requests: Vec<Request>)` call carries one or more actions. The
 * spend amount lives inside the `requests` vec (not a flat positional arg) — to pool-limit a
 * Blend call, use `BLEND_SUBMIT_REQUESTS_ARG_INDEX` as `argIndex` with
 * `valueMode: PooledSpendValueMode.RequestVecAmountSum` in the caveat's `protocolActions` entry,
 * which sums every request's "amount" field on-chain.
 */
export class BlendAdapter implements LendingAdapter {
  readonly id = 'blend' as const;

  constructor(public readonly contractId: string) {}

  deposit(params: { asset: string; amount: bigint; onBehalfOf: string }): Execution {
    const owner = Address.fromString(params.onBehalfOf).toScVal();
    return {
      target: this.contractId,
      function: 'submit',
      args: [
        owner,
        owner,
        owner,
        nativeToScVal([buildRequestScVal(params.asset, params.amount, BLEND_REQUEST_TYPE_SUPPLY)], { type: 'vec' }),
      ],
    };
  }

  withdraw(params: { asset: string; amount: bigint; to: string }): Execution {
    const owner = Address.fromString(params.to).toScVal();
    return {
      target: this.contractId,
      function: 'submit',
      args: [
        owner,
        owner,
        owner,
        nativeToScVal([buildRequestScVal(params.asset, params.amount, BLEND_REQUEST_TYPE_WITHDRAW)], { type: 'vec' }),
      ],
    };
  }

  buildAction(input: ProtocolActionRequest): ProtocolActionResult {
    if (input.protocolId !== 'blend') {
      throw new RpcError(`BlendAdapter cannot build an action for protocol '${input.protocolId}'`);
    }
    const blendInput = input as BlendActionRequest;
    if (blendInput.amount <= 0n) {
      throw new RpcError(`Blend ${blendInput.action}: amount must be positive, got ${blendInput.amount}`);
    }
    // Address.fromString throws on a malformed strkey — validated eagerly here rather than
    // deep inside ScVal construction, so a bad asset/owner address fails with a clear message
    // before any XDR is built.
    try {
      Address.fromString(blendInput.asset);
      Address.fromString(blendInput.owner);
    } catch {
      throw new RpcError(`Blend ${blendInput.action}: invalid asset or owner address`);
    }
    const execution =
      blendInput.action === 'deposit'
        ? this.deposit({ asset: blendInput.asset, amount: blendInput.amount, onBehalfOf: blendInput.owner })
        : this.withdraw({ asset: blendInput.asset, amount: blendInput.amount, to: blendInput.owner });

    return {
      execution,
      positionDelta: {
        asset: blendInput.asset,
        kind: 'lend',
        delta: blendInput.action === 'deposit' ? blendInput.amount : -blendInput.amount,
      },
      describe: (txHash: string) => `Blend ${blendInput.action}: ${blendInput.amount} of ${blendInput.asset}. Tx: ${txHash}`,
    };
  }
}
