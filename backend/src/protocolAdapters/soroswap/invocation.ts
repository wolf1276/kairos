// Real Soroban invocation building/simulation for the Soroswap Router — production reference:
// `aquarius/invocation.ts` (same technique, same scope boundary: simulation only, never
// `sendTransaction`). Function signatures come from this codebase's own documented Soroswap
// router interface (`soroswap/types.ts` header: "swap_exact_tokens_for_tokens(amount_in,
// amount_out_min, path, to, deadline)"), which mirrors the publicly documented Soroswap
// Uniswap-V2-style router ABI (add_liquidity/remove_liquidity following the same
// token_a/token_b/amounts/to/deadline convention). Unlike Aquarius, this has NOT been verified
// against a live deployed router by a real transcript in this repo — treat as real XDR
// construction with a well-documented but *unverified* ABI, not verified-and-correct. Asset
// addresses are derived via `@stellar/stellar-sdk`'s `Asset.contractId()` (a real, deterministic,
// offline computation — the actual Stellar Asset Contract address for a classic asset — never a
// guess), which needs each non-native asset's issuer account supplied by the caller.
import { Address, Asset, Contract, Networks, TransactionBuilder, nativeToScVal, rpc, scValToNative } from '@stellar/stellar-sdk';
import type { SoroswapNetwork } from './config.js';

export function getNetworkPassphrase(network: SoroswapNetwork): string {
  return network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
}

export const STELLAR_ASSET_DECIMALS = 7;

export function toStroops(amount: string): bigint {
  const value = Number(amount);
  if (!Number.isFinite(value)) throw new Error(`Invalid amount '${amount}' — must be a finite decimal string.`);
  return BigInt(Math.round(value * 10 ** STELLAR_ASSET_DECIMALS));
}

export interface AssetResolver {
  /** Issuer account per non-native asset code — used to *derive* a real Stellar Asset Contract
   *  (SAC) address (`Asset.contractId()`) for a classic Stellar asset wrapped as a Soroban token.
   *  'XLM'/'native' never needs an entry (resolved via `Asset.native()`). */
  assetIssuers?: Record<string, string>;
  /** Direct contract address per asset code — takes priority over `assetIssuers` when both are
   *  present for the same code. Required for a real Soroban token that is *not* a classic-asset
   *  SAC (a plain SEP-41 token contract with no backing classic issuer) — confirmed to be common
   *  in practice during live verification: the real Soroswap testnet token list's USDC
   *  (`CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F`) is exactly this — its `name()`
   *  returns `"USDCoin"`, not the `"code:issuer"` format a SAC's `name()` returns, so
   *  `Asset.contractId()` cannot be used to reach it at all; only a direct address works. Without
   *  this, `AssetResolver` could only ever resolve classic-asset SACs, which excludes a large and
   *  common class of real Soroban tokens. */
  assetAddresses?: Record<string, string>;
}

function resolveAssetAddress(assetCode: string, network: SoroswapNetwork, resolver: AssetResolver): string {
  if (assetCode.toUpperCase() === 'XLM' || assetCode.toUpperCase() === 'NATIVE') {
    return Asset.native().contractId(getNetworkPassphrase(network));
  }
  const directAddress = resolver.assetAddresses?.[assetCode];
  if (directAddress) return directAddress;
  const issuer = resolver.assetIssuers?.[assetCode];
  if (!issuer) throw new Error(`No address or issuer configured for asset '${assetCode}' — cannot resolve its Soroban contract address. Supply it via assetResolver.assetAddresses (direct contract) or assetResolver.assetIssuers (classic-asset SAC derivation).`);
  return new Asset(assetCode, issuer).contractId(getNetworkPassphrase(network));
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

export async function buildRouterOperation(routerContractId: string, method: string, args: Record<string, unknown>, network: SoroswapNetwork, options: InvocationOptions) {
  const to = new Address(options.sourceAccountPublicKey).toScVal();
  const contract = new Contract(routerContractId);
  const resolve = (assetCode: string) => new Address(resolveAssetAddress(assetCode, network, options.assetResolver)).toScVal();
  const defaultDeadline = () => BigInt(Math.floor(Date.now() / 1000) + 1800);

  switch (method) {
    case 'swap_exact_tokens_for_tokens': {
      const path = args.path as string[];
      const amountIn = nativeToScVal(toStroops(args.amountIn as string), { type: 'i128' });
      const amountOutMin = nativeToScVal(toStroops((args.minOutput as string | null) ?? '0'), { type: 'i128' });
      const pathScVal = nativeToScVal(path.map(resolve), { type: 'vec' });
      const deadline = nativeToScVal(args.deadline ? BigInt(args.deadline as number) : defaultDeadline(), { type: 'u64' });
      return contract.call('swap_exact_tokens_for_tokens', amountIn, amountOutMin, pathScVal, to, deadline);
    }
    case 'add_liquidity': {
      const tokenA = resolve(args.assetA as string);
      const tokenB = resolve(args.assetB as string);
      const amountADesired = nativeToScVal(toStroops(args.amountA as string), { type: 'i128' });
      const amountBDesired = nativeToScVal(toStroops(args.amountB as string), { type: 'i128' });
      const amountAMin = nativeToScVal(0n, { type: 'i128' });
      const amountBMin = nativeToScVal(0n, { type: 'i128' });
      const deadline = nativeToScVal(defaultDeadline(), { type: 'u64' });
      return contract.call('add_liquidity', tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin, to, deadline);
    }
    case 'remove_liquidity': {
      const tokenA = resolve(args.assetA as string);
      const tokenB = resolve(args.assetB as string);
      const liquidity = nativeToScVal(toStroops(args.lpAmount as string), { type: 'i128' });
      const amountAMin = nativeToScVal(0n, { type: 'i128' });
      const amountBMin = nativeToScVal(0n, { type: 'i128' });
      const deadline = nativeToScVal(defaultDeadline(), { type: 'u64' });
      return contract.call('remove_liquidity', tokenA, tokenB, liquidity, amountAMin, amountBMin, to, deadline);
    }
    default:
      throw new Error(`Unknown Soroswap router method '${method}' — no real invocation builder exists for it.`);
  }
}

export async function simulateRouterCall(routerContractId: string, method: string, args: Record<string, unknown>, network: SoroswapNetwork, options: InvocationOptions): Promise<RouterInvocationResult> {
  const server = new rpc.Server(options.rpcUrl);
  const account = await server.getAccount(options.sourceAccountPublicKey);
  const operation = await buildRouterOperation(routerContractId, method, args, network, options);
  const tx = new TransactionBuilder(account, { fee: '10000000', networkPassphrase: getNetworkPassphrase(network) }).addOperation(operation).setTimeout(30).build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationSuccess(sim) && sim.result) {
    return { success: true, retval: scValToNative(sim.result.retval), costCpuInsns: String(sim.minResourceFee ?? '0'), errors: [] };
  }
  return { success: false, retval: null, costCpuInsns: '0', errors: [rpc.Api.isSimulationError(sim) ? sim.error : 'unknown simulation error'] };
}
