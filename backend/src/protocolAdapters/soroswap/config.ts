// Soroswap network/contract configuration. Contract IDs are NEVER hardcoded — every address is
// read from environment config, following the same `readRequiredEnv` pattern as
// `aquarius/config.ts` / `phoenix/config.ts` / `blend/config.ts` (none modified by this file).
// Per-network, since testnet and mainnet router deployments are different contracts.
export type SoroswapNetwork = 'testnet' | 'mainnet';

function readRequiredEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

/** The Soroswap router contract address for a given network — the single on-chain integration
 *  point (`swap_exact_tokens_for_tokens` / `add_liquidity` / `remove_liquidity`). */
export function getSoroswapRouterContractId(network: SoroswapNetwork): string {
  const key = network === 'mainnet' ? 'SOROSWAP_ROUTER_CONTRACT_ID_MAINNET' : 'SOROSWAP_ROUTER_CONTRACT_ID_TESTNET';
  return readRequiredEnv(key);
}

/** Soroban RPC endpoint per network — the standard public Stellar RPC, overridable via env. */
export function getSorobanRpcUrl(network: SoroswapNetwork): string {
  const envUrl = process.env.SOROSWAP_SOROBAN_RPC_URL;
  if (envUrl) return envUrl;
  return network === 'mainnet' ? 'https://mainnet.sorobanrpc.com' : 'https://soroban-testnet.stellar.org';
}
