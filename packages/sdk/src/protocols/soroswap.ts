import { Address, nativeToScVal } from '@stellar/stellar-sdk';
import { Execution } from '../types';
import { RpcError } from '../errors';
import { AmmAdapter, ProtocolActionRequest, ProtocolActionResult, SoroswapActionRequest } from './types';

/** Positional arg index carrying the swap's input amount, kept alongside the adapter so a
 * protocol-spend-limit caveat (policy tag 5) can reference the same index the adapter encodes. */
export const SOROSWAP_SWAP_AMOUNT_IN_ARG_INDEX = 0;

/**
 * Adapter for Soroswap's router (Uniswap-V2-style AMM):
 * `swap_exact_tokens_for_tokens(amount_in, amount_out_min, path, to, deadline)`.
 */
export class SoroswapAdapter implements AmmAdapter {
  readonly id = 'soroswap' as const;

  constructor(public readonly contractId: string) {}

  swapExactIn(params: {
    path: string[];
    amountIn: bigint;
    minAmountOut: bigint;
    to: string;
    deadline: bigint;
  }): Execution {
    return {
      target: this.contractId,
      function: 'swap_exact_tokens_for_tokens',
      args: [
        nativeToScVal(params.amountIn, { type: 'i128' }),
        nativeToScVal(params.minAmountOut, { type: 'i128' }),
        nativeToScVal(
          params.path.map(addr => Address.fromString(addr)),
          { type: 'vec' }
        ),
        Address.fromString(params.to).toScVal(),
        nativeToScVal(params.deadline, { type: 'u64' }),
      ],
    };
  }

  buildAction(input: ProtocolActionRequest): ProtocolActionResult {
    if (input.protocolId !== 'soroswap') {
      throw new RpcError(`SoroswapAdapter cannot build an action for protocol '${input.protocolId}'`);
    }
    const swapInput = input as SoroswapActionRequest;
    if (swapInput.path.length < 2) {
      throw new RpcError(`Soroswap swap: path must have at least 2 assets, got ${swapInput.path.length}`);
    }
    if (swapInput.amountIn <= 0n) {
      throw new RpcError(`Soroswap swap: amountIn must be positive, got ${swapInput.amountIn}`);
    }
    if (swapInput.minAmountOut < 0n) {
      throw new RpcError(`Soroswap swap: minAmountOut must not be negative, got ${swapInput.minAmountOut}`);
    }
    if (swapInput.deadline <= 0n) {
      throw new RpcError(`Soroswap swap: deadline must be a positive unix timestamp, got ${swapInput.deadline}`);
    }
    try {
      swapInput.path.forEach(addr => Address.fromString(addr));
      Address.fromString(swapInput.owner);
    } catch {
      throw new RpcError('Soroswap swap: invalid path asset or owner address');
    }
    const execution = this.swapExactIn({
      path: swapInput.path,
      amountIn: swapInput.amountIn,
      minAmountOut: swapInput.minAmountOut,
      to: swapInput.owner,
      deadline: swapInput.deadline,
    });
    const outputAsset = swapInput.path[swapInput.path.length - 1];

    return {
      execution,
      positionDelta: { asset: outputAsset, kind: 'lp', delta: swapInput.minAmountOut },
      describe: (txHash: string) => `Soroswap swap: ${swapInput.amountIn} in via ${swapInput.path.join(' -> ')}. Tx: ${txHash}`,
    };
  }
}
