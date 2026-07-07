// Shared Soroban invocation building/simulation for the real Aquarius Router integration.
// Verified during development against the live Aquarius testnet router
// (CBCFTQSPDBAIZ6R6PJQKSQWKNKWH2QIV3I4J72SHWBIK3ADRRAM5A6GD, function signatures from
// https://docs.aqua.network/developers/aquarius-soroban-functions, cross-checked live) — see
// architecture doc for the exact verification transcript (real `get_pools`, `swap_chained`,
// `claim`, `withdraw`, `deposit` calls against testnet). This module never submits a
// transaction — `rpc.Server.simulateTransaction` only.
import { Address, Contract, Networks, TransactionBuilder, nativeToScVal, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import type { AssetPoolRegistry } from './realBackendApi.js';
import type { AquariusNetwork } from './config.js';

export const STELLAR_ASSET_DECIMALS = 7;

export function toStroops(amount: string): bigint {
  const value = Number(amount);
  if (!Number.isFinite(value)) throw new Error(`Invalid amount '${amount}' — must be a finite decimal string.`);
  return BigInt(Math.round(value * 10 ** STELLAR_ASSET_DECIMALS));
}

export function fromStroops(value: bigint): string {
  return (Number(value) / 10 ** STELLAR_ASSET_DECIMALS).toFixed(6);
}

export function getNetworkPassphrase(network: AquariusNetwork): string {
  return network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
}

export interface RouterInvocationResult {
  success: boolean;
  retval: unknown;
  costCpuInsns: string;
  errors: string[];
}

export interface InvocationOptions {
  rpcUrl: string;
  sourceAccountPublicKey: string;
  registry: AssetPoolRegistry;
}

async function resolvePoolIndex(registry: AssetPoolRegistry, assetA: string, assetB: string): Promise<string> {
  const pool = await registry.findPool(assetA, assetB);
  if (!pool) throw new Error(`No Aquarius pool found for asset pair '${assetA}'/'${assetB}'.`);
  return pool.poolId;
}

async function resolvePoolAssets(registry: AssetPoolRegistry, poolId: string): Promise<{ assetA: string; assetB: string }> {
  const pool = await registry.findPoolByIndex(poolId);
  if (!pool) throw new Error(`No Aquarius pool found for poolId '${poolId}'.`);
  return pool;
}

function poolIndexScVal(poolIdHex: string): ReturnType<typeof xdr.ScVal.scvBytes> {
  return xdr.ScVal.scvBytes(Buffer.from(poolIdHex, 'hex'));
}

async function addressScVal(registry: AssetPoolRegistry, assetCode: string): Promise<ReturnType<Address['toScVal']>> {
  const address = await registry.resolveAddress(assetCode);
  return new Address(address).toScVal();
}

export async function simulateRouterCall(
  routerContractId: string,
  method: string,
  args: Record<string, unknown>,
  network: AquariusNetwork,
  options: InvocationOptions,
): Promise<RouterInvocationResult> {
  const server = new rpc.Server(options.rpcUrl);
  const account = await server.getAccount(options.sourceAccountPublicKey);

  const operation = await buildRouterOperation(routerContractId, method, args, options.registry, options.sourceAccountPublicKey);
  const tx = new TransactionBuilder(account, { fee: '10000000', networkPassphrase: getNetworkPassphrase(network) })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationSuccess(sim) && sim.result) {
    return { success: true, retval: scValToNative(sim.result.retval), costCpuInsns: String(sim.minResourceFee ?? '0'), errors: [] };
  }
  return { success: false, retval: null, costCpuInsns: '0', errors: [rpc.Api.isSimulationError(sim) ? sim.error : 'unknown simulation error'] };
}

/** Builds the real router call's operation for one of the 4 mutating actions this adapter
 *  supports, resolving every asset code / pool index from `registry` (never hardcoded). Args are
 *  in exactly the shape `aquarius/adapter.ts::buildRouterArgs()` already produces — this function
 *  is the only place that knows how those generic args map onto the router's real Soroban
 *  function signatures. The router contract itself (`routerContractId`) is the call target for
 *  every method — `swap_chained`/`deposit`/`withdraw`/`claim` are all router entry points, never
 *  a pool contract directly, per "Use Aquarius Router as the single integration point". */
export async function buildRouterOperation(routerContractId: string, method: string, args: Record<string, unknown>, registry: AssetPoolRegistry, userPublicKey: string) {
  const user = new Address(userPublicKey).toScVal();
  const contract = new Contract(routerContractId);

  switch (method) {
    case 'swap_chained': {
      const path = args.path as string[];
      const amount = args.amount as string;
      const minOutput = (args.minOutput as string | null) ?? '0';
      const hops = [];
      for (let i = 1; i < path.length; i++) {
        const tokens = nativeToScVal([await addressScVal(registry, path[i - 1]), await addressScVal(registry, path[i])], { type: 'vec' });
        const poolId = await resolvePoolIndex(registry, path[i - 1], path[i]);
        const tokenOut = await addressScVal(registry, path[i]);
        hops.push(xdr.ScVal.scvVec([tokens, poolIndexScVal(poolId), tokenOut]));
      }
      const swapsChain = xdr.ScVal.scvVec(hops);
      const tokenIn = await addressScVal(registry, path[0]);
      const inAmount = nativeToScVal(toStroops(amount), { type: 'u128' });
      const outMin = nativeToScVal(toStroops(minOutput), { type: 'u128' });
      return contract.call('swap_chained', user, swapsChain, tokenIn, inAmount, outMin);
    }
    case 'deposit': {
      const assetA = args.assetA as string;
      const assetB = args.assetB as string;
      const amount = args.amount as string;
      const poolId = await resolvePoolIndex(registry, assetA, assetB);
      const tokens = nativeToScVal([await addressScVal(registry, assetA), await addressScVal(registry, assetB)], { type: 'vec' });
      const scaled = toStroops(amount);
      const desired = nativeToScVal([nativeToScVal(scaled, { type: 'u128' }), nativeToScVal(scaled, { type: 'u128' })], { type: 'vec' });
      const minShares = nativeToScVal(0n, { type: 'u128' });
      return contract.call('deposit', user, tokens, poolIndexScVal(poolId), desired, minShares);
    }
    case 'withdraw': {
      const poolId = args.poolId as string;
      const amount = args.amount as string;
      const { assetA, assetB } = await resolvePoolAssets(registry, poolId);
      const tokens = nativeToScVal([await addressScVal(registry, assetA), await addressScVal(registry, assetB)], { type: 'vec' });
      const shareAmount = nativeToScVal(toStroops(amount), { type: 'u128' });
      const minAmounts = nativeToScVal([nativeToScVal(0n, { type: 'u128' }), nativeToScVal(0n, { type: 'u128' })], { type: 'vec' });
      return contract.call('withdraw', user, tokens, poolIndexScVal(poolId), shareAmount, minAmounts);
    }
    case 'claim_rewards': {
      const poolId = args.poolId as string;
      const { assetA, assetB } = await resolvePoolAssets(registry, poolId);
      const tokens = nativeToScVal([await addressScVal(registry, assetA), await addressScVal(registry, assetB)], { type: 'vec' });
      return contract.call('claim', user, tokens, poolIndexScVal(poolId));
    }
    default:
      throw new Error(`Unknown router method '${method}' — no real invocation builder exists for it.`);
  }
}
