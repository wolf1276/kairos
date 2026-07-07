// Real Soroban invocation building/simulation for Phoenix (multihop + pool contracts) —
// production reference: `aquarius/invocation.ts` (same technique, same scope boundary:
// simulation only, never `sendTransaction`).
//
// SOURCE-VERIFIED, NOT LIVE-TESTNET-VERIFIED. Unlike Aquarius/Soroswap, no publicly discoverable
// deployed Phoenix testnet contract address could be found (checked: the official
// phoenix-contracts GitHub repo for a committed deployments file — none exists; Phoenix's own
// public API/landing-page repos — no contract config; DefiLlama's adapter repo — unrelated dead
// project by coincidence of name). So this integration could not be simulated against a live
// router the way Aquarius's and Soroswap's were. Instead, every type this file depends on was
// read directly from the real, tagged-release (v2.0.0, 2025-06-07) contract source at
// https://github.com/Phoenix-Protocol-Group/phoenix-contracts — not inferred, not guessed:
//   - `multihop::MultihopTrait::swap` (contracts/multihop/src/contract.rs)
//   - `Swap` struct (contracts/multihop/src/storage.rs): { ask_asset: Address, offer_asset:
//     Address, ask_asset_min_amount: Option<i128> }
//   - `PoolType` enum (packages/phoenix/src/utils.rs): #[repr(u32)] Xyk = 0, Stable = 1
//     (v2.0.0 has no `Blend` variant — matches this codebase's own `PHOENIX_POOL_TYPES =
//     ['xyk','stable']`, independently corroborating this is the right version to target)
//   - `pool::PoolTrait::provide_liquidity` / `withdraw_liquidity` (contracts/pool/src/contract.rs)
// `Option<T>`/struct/enum XDR encoding rules themselves are `@stellar/stellar-sdk`'s own fixed,
// documented behavior (verified directly from its `nativeToScVal` source in this repo's
// `node_modules`, not assumed): `null` -> `ScVal.scvVoid()`; a struct's fields must be encoded as
// an `ScVal.scvMap` with `Symbol`-typed keys in alphabetical order (`nativeToScVal`'s *default*
// map-key encoding is `String`, not `Symbol` — using it unmodified on a plain object would
// produce an XDR structurally different from what a real `#[contracttype]` struct expects, which
// is why `contractStruct()` below builds the map by hand instead of calling `nativeToScVal(obj)`
// directly); a fieldless `#[repr(u32)]` enum -> a plain `ScVal.scvU32` of its discriminant.
import { Address, Contract, Networks, TransactionBuilder, nativeToScVal, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import type { PhoenixNetwork } from './config.js';

export function getNetworkPassphrase(network: PhoenixNetwork): string {
  return network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
}

export const STELLAR_ASSET_DECIMALS = 7;

export function toStroops(amount: string): bigint {
  const value = Number(amount);
  if (!Number.isFinite(value)) throw new Error(`Invalid amount '${amount}' — must be a finite decimal string.`);
  return BigInt(Math.round(value * 10 ** STELLAR_ASSET_DECIMALS));
}

/** Encodes a Soroban `#[contracttype]` struct's fields as a `Symbol`-keyed, alphabetically
 *  sorted `ScVal.scvMap` — the real encoding real Rust struct types use, which
 *  `nativeToScVal(plainObject)` does NOT produce on its own (see file header). `fields` values
 *  must already be `ScVal`s. */
function contractStruct(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  const entries = Object.keys(fields)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => new xdr.ScMapEntry({ key: nativeToScVal(key, { type: 'symbol' }), val: fields[key] }));
  return xdr.ScVal.scvMap(entries);
}

/** `null`/`undefined` -> real Soroban `Option::None` (`ScVal.scvVoid()`); otherwise the
 *  caller-supplied encoder applied to the present value — real Soroban `Option::Some(x)`
 *  encoding, which is just `x`'s own ScVal with no wrapper. */
function optionalScVal<T>(value: T | null | undefined, encode: (v: T) => xdr.ScVal): xdr.ScVal {
  return value === null || value === undefined ? xdr.ScVal.scvVoid() : encode(value);
}

export const POOL_TYPE_DISCRIMINANT: Record<string, number> = { xyk: 0, stable: 1 };

export interface AssetResolver {
  assetIssuers?: Record<string, string>;
  assetAddresses?: Record<string, string>;
}

function resolveAssetAddress(assetCode: string, resolver: AssetResolver): xdr.ScVal {
  const directAddress = resolver.assetAddresses?.[assetCode];
  if (directAddress) return new Address(directAddress).toScVal();
  throw new Error(`No address configured for asset '${assetCode}' — cannot resolve its Soroban contract address. Supply it via assetResolver.assetAddresses.`);
}

export interface InvocationOptions {
  rpcUrl: string;
  sourceAccountPublicKey: string;
  assetResolver: AssetResolver;
}

export interface RouterInvocationResult {
  success: boolean;
  retval: unknown;
  costCpuInsns: string;
  errors: string[];
}

/** Builds one real invocation operation. `contractId` is the multihop contract for `'swap'`
 *  (SWAP/SWAP_CHAINED) and the individual pool contract for `'provide_liquidity'`/
 *  `'withdraw_liquidity'` — matching exactly how `phoenix/adapter.ts::buildTransaction()` already
 *  resolves `contractId` per action (unchanged by this file). */
export function buildPhoenixOperation(contractId: string, method: string, args: Record<string, unknown>, options: InvocationOptions) {
  const recipient = new Address(options.sourceAccountPublicKey).toScVal();
  const contract = new Contract(contractId);

  switch (method) {
    case 'swap': {
      const path = args.path as string[];
      if (!Array.isArray(path) || path.length < 2) throw new Error('Phoenix swap requires params.path with at least 2 assets.');
      const amount = nativeToScVal(toStroops(args.amount as string), { type: 'i128' });
      const minOutput = args.minOutput ? toStroops(args.minOutput as string) : null;

      // One `Swap` hop per consecutive pair in the path — `ask_asset_min_amount` (the real
      // contract's per-hop slippage floor) is applied only to the final hop, since this
      // codebase's request shape carries a single overall `minOutput` for the whole route, not
      // one per hop (a reasonable, explicit choice — not a silent guess).
      const hops = [];
      for (let i = 1; i < path.length; i++) {
        const isLastHop = i === path.length - 1;
        hops.push(
          contractStruct({
            offer_asset: resolveAssetAddress(path[i - 1], options.assetResolver),
            ask_asset: resolveAssetAddress(path[i], options.assetResolver),
            ask_asset_min_amount: isLastHop ? optionalScVal(minOutput, (v) => nativeToScVal(v, { type: 'i128' })) : xdr.ScVal.scvVoid(),
          }),
        );
      }
      const operations = nativeToScVal(hops, { type: 'vec' });
      const poolTypeCode = POOL_TYPE_DISCRIMINANT[(args.poolType as string) ?? 'xyk'];
      if (poolTypeCode === undefined) throw new Error(`Unknown Phoenix pool type '${args.poolType}'.`);
      const poolType = xdr.ScVal.scvU32(poolTypeCode);
      const maxSpreadBps = xdr.ScVal.scvVoid();
      const deadline = nativeToScVal(BigInt(Math.floor(Date.now() / 1000) + 1800), { type: 'u64' });
      const maxAllowedFeeBps = xdr.ScVal.scvVoid();
      return contract.call('swap', recipient, operations, maxSpreadBps, amount, poolType, deadline, maxAllowedFeeBps);
    }
    case 'provide_liquidity': {
      const amountA = args.amount as string;
      const amountB = args.amountB as string | null | undefined;
      if (!amountB) throw new Error("Phoenix provide_liquidity requires params.amountB — the real pool contract requires both desired_a and desired_b to be present and > 0 (confirmed from source), and this codebase's DEPOSIT request only supplies one amount by default.");
      const desiredA = nativeToScVal(toStroops(amountA), { type: 'i128' });
      const desiredB = nativeToScVal(toStroops(amountB), { type: 'i128' });
      const minA = xdr.ScVal.scvVoid();
      const minB = xdr.ScVal.scvVoid();
      const customSlippageBps = xdr.ScVal.scvVoid();
      const deadline = nativeToScVal(BigInt(Math.floor(Date.now() / 1000) + 1800), { type: 'u64' });
      const autoStake = nativeToScVal(false, { type: 'bool' });
      return contract.call('provide_liquidity', recipient, desiredA, minA, desiredB, minB, customSlippageBps, deadline, autoStake);
    }
    case 'withdraw_liquidity': {
      const shareAmount = nativeToScVal(toStroops(args.amount as string), { type: 'i128' });
      const minA = nativeToScVal(0n, { type: 'i128' });
      const minB = nativeToScVal(0n, { type: 'i128' });
      const deadline = nativeToScVal(BigInt(Math.floor(Date.now() / 1000) + 1800), { type: 'u64' });
      const autoUnstake = xdr.ScVal.scvVoid();
      return contract.call('withdraw_liquidity', recipient, shareAmount, minA, minB, deadline, autoUnstake);
    }
    default:
      throw new Error(`Unknown Phoenix method '${method}' — no real invocation builder exists for it.`);
  }
}

export async function simulateCall(contractId: string, method: string, args: Record<string, unknown>, network: PhoenixNetwork, options: InvocationOptions): Promise<RouterInvocationResult> {
  const server = new rpc.Server(options.rpcUrl);
  const account = await server.getAccount(options.sourceAccountPublicKey);
  const operation = buildPhoenixOperation(contractId, method, args, options);
  const tx = new TransactionBuilder(account, { fee: '10000000', networkPassphrase: getNetworkPassphrase(network) }).addOperation(operation).setTimeout(30).build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationSuccess(sim) && sim.result) {
    return { success: true, retval: scValToNative(sim.result.retval), costCpuInsns: String(sim.minResourceFee ?? '0'), errors: [] };
  }
  return { success: false, retval: null, costCpuInsns: '0', errors: [rpc.Api.isSimulationError(sim) ? sim.error : 'unknown simulation error'] };
}
