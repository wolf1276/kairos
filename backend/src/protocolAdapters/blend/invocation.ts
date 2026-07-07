// Real Soroban invocation building/simulation for Blend (lending pool `submit`) — same technique
// as `phoenix/invocation.ts` (simulation only, never `sendTransaction`).
//
// SOURCE-VERIFIED AND LIVE-DEPLOYMENT-VERIFIED. Unlike Phoenix, Blend has a real, official,
// publicly-committed testnet deployment: `blend-capital/blend-utils/testnet.contracts.json`
// (fetched live via GitHub API during the readiness audit — not inferred). Every type this file
// depends on was read directly from the real, tagged-release contract source at
// https://github.com/blend-capital/blend-contracts-v2 (tag `v2.0.0_pool_cli22.0.1`,
// 2025-04-14) — not inferred, not guessed:
//   - `PoolTrait::submit` (pool/src/contract.rs): fn submit(e, from: Address, spender: Address,
//     to: Address, requests: Vec<Request>) -> Positions
//   - `Request` struct (pool/src/pool/actions.rs): { request_type: u32, address: Address,
//     amount: i128 }
//   - `RequestType` enum (pool/src/pool/actions.rs), #[repr(u32)]: Supply=0, Withdraw=1,
//     SupplyCollateral=2, WithdrawCollateral=3, Borrow=4, Repay=5, FillUserLiquidationAuction=6,
//     FillBadDebtAuction=7, FillInterestAuction=8, DeleteLiquidationAuction=9
// `Option<T>`/struct/enum XDR encoding rules are the same fixed, documented `@stellar/stellar-sdk`
// behavior used by `phoenix/invocation.ts` (see that file's header for the verification of
// `nativeToScVal`'s map-key behavior): a struct's fields must be encoded as an `ScVal.scvMap`
// with `Symbol`-typed keys in alphabetical order; a fieldless `#[repr(u32)]` enum discriminant
// (here, embedded as a plain `u32` field, not a wrapped enum ScVal) -> a plain `ScVal.scvU32`.
import { Address, Contract, Networks, TransactionBuilder, nativeToScVal, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import type { BlendNetwork } from './config.js';
import type { BlendAction } from './types.js';

export function getNetworkPassphrase(network: BlendNetwork): string {
  return network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
}

export const STELLAR_ASSET_DECIMALS = 7;

export function toStroops(amount: string): bigint {
  const value = Number(amount);
  if (!Number.isFinite(value)) throw new Error(`Invalid amount '${amount}' — must be a finite decimal string.`);
  return BigInt(Math.round(value * 10 ** STELLAR_ASSET_DECIMALS));
}

/** Encodes a Soroban `#[contracttype]` struct's fields as a `Symbol`-keyed, alphabetically
 *  sorted `ScVal.scvMap` — same technique as `phoenix/invocation.ts::contractStruct`. `fields`
 *  values must already be `ScVal`s. */
function contractStruct(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  const entries = Object.keys(fields)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => new xdr.ScMapEntry({ key: nativeToScVal(key, { type: 'symbol' }), val: fields[key] }));
  return xdr.ScVal.scvMap(entries);
}

/** Real `RequestType` discriminants (pool/src/pool/actions.rs, `#[repr(u32)]`) — this codebase
 *  only ever emits Supply/Withdraw/SupplyCollateral/WithdrawCollateral/Borrow/Repay because its
 *  `BlendAction` vocabulary (DEPOSIT/WITHDRAW/BORROW/REPAY) has no auction/liquidation concept;
 *  the discriminants for the auction-only variants are still listed here (never emitted) so this
 *  map cannot silently drift from the real enum if it's ever extended. */
export const REQUEST_TYPE_DISCRIMINANT: Record<string, number> = {
  Supply: 0,
  Withdraw: 1,
  SupplyCollateral: 2,
  WithdrawCollateral: 3,
  Borrow: 4,
  Repay: 5,
  FillUserLiquidationAuction: 6,
  FillBadDebtAuction: 7,
  FillInterestAuction: 8,
  DeleteLiquidationAuction: 9,
};

/** Maps this codebase's `BlendAction` to the real on-chain `RequestType`. DEPOSIT/WITHDRAW use
 *  the `*Collateral` variants — Blend's own docs (docs.blend.capital/tech-docs/integrations/
 *  integrate-pool) state "SupplyCollateral/WithdrawCollateral is generally recommended for most
 *  users over Supply/Withdraw", and this adapter's health-factor gating (`checkHealthFactor` in
 *  `adapter.ts`) only makes sense for collateralized positions. */
const REQUEST_TYPE_BY_ACTION: Record<BlendAction, keyof typeof REQUEST_TYPE_DISCRIMINANT> = {
  DEPOSIT: 'SupplyCollateral',
  WITHDRAW: 'WithdrawCollateral',
  BORROW: 'Borrow',
  REPAY: 'Repay',
};

export interface AssetResolver {
  assetAddresses?: Record<string, string>;
}

function resolveAssetAddress(assetCode: string, resolver: AssetResolver): string {
  const directAddress = resolver.assetAddresses?.[assetCode];
  if (directAddress) return directAddress;
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

/** Builds one real `Request` struct — `{ request_type: u32, address: Address, amount: i128 }`
 *  (pool/src/pool/actions.rs:14-18) — encoded exactly as the real `#[contracttype]` struct. */
function buildRequest(action: BlendAction, asset: string, amount: string, options: InvocationOptions): xdr.ScVal {
  const requestTypeName = REQUEST_TYPE_BY_ACTION[action];
  const requestType = REQUEST_TYPE_DISCRIMINANT[requestTypeName];
  const assetAddress = resolveAssetAddress(asset, options.assetResolver);
  return contractStruct({
    request_type: xdr.ScVal.scvU32(requestType),
    address: new Address(assetAddress).toScVal(),
    amount: nativeToScVal(toStroops(amount), { type: 'i128' }),
  });
}

/** Builds one real invocation operation for Blend's `submit(from, spender, to, requests)`
 *  (pool/src/contract.rs:116-122) — `from`/`spender`/`to` are all the acting account itself
 *  (`options.sourceAccountPublicKey`): this codebase has no delegated-spender/flash-loan concept,
 *  so `submit` (not `submit_with_allowance`) is the correct entrypoint, matching the real
 *  contract's requirement that `from == spender` skips the extra `from.require_auth()` branch. */
export function buildBlendOperation(contractId: string, action: BlendAction, args: Record<string, unknown>, options: InvocationOptions) {
  const asset = args.asset as string;
  const amount = args.amount as string;
  if (typeof asset !== 'string' || asset.length === 0) throw new Error('Blend submit requires args.asset.');
  if (typeof amount !== 'string' || amount.length === 0) throw new Error('Blend submit requires args.amount.');

  const owner = new Address(options.sourceAccountPublicKey).toScVal();
  const contract = new Contract(contractId);
  const request = buildRequest(action, asset, amount, options);
  const requests = nativeToScVal([request], { type: 'vec' });
  return contract.call('submit', owner, owner, owner, requests);
}

export async function simulateCall(contractId: string, action: BlendAction, args: Record<string, unknown>, network: BlendNetwork, options: InvocationOptions): Promise<RouterInvocationResult> {
  const server = new rpc.Server(options.rpcUrl);
  const account = await server.getAccount(options.sourceAccountPublicKey);
  const operation = buildBlendOperation(contractId, action, args, options);
  const tx = new TransactionBuilder(account, { fee: '10000000', networkPassphrase: getNetworkPassphrase(network) }).addOperation(operation).setTimeout(30).build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationSuccess(sim) && sim.result) {
    return { success: true, retval: scValToNative(sim.result.retval), costCpuInsns: String(sim.minResourceFee ?? '0'), errors: [] };
  }
  return { success: false, retval: null, costCpuInsns: '0', errors: [rpc.Api.isSimulationError(sim) ? sim.error : 'unknown simulation error'] };
}
