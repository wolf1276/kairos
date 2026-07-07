// Blend network/contract configuration. Contract IDs are NEVER hardcoded — every address is
// read from environment config, following the same `readRequiredEnv` pattern as
// `aquarius/config.ts` / `phoenix/config.ts` (neither modified by this file). Per-network, since
// testnet and mainnet pool deployments are different contracts.
export type BlendNetwork = 'testnet' | 'mainnet';

function readRequiredEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

/** The Blend lending pool contract address for a given network — the single on-chain
 *  integration point (Blend's `submit(from, spender, to, requests)` call). */
export function getBlendPoolContractId(network: BlendNetwork): string {
  const key = network === 'mainnet' ? 'BLEND_POOL_CONTRACT_ID_MAINNET' : 'BLEND_POOL_CONTRACT_ID_TESTNET';
  return readRequiredEnv(key);
}

/** Soroban RPC endpoint per network — the standard public Stellar RPC, overridable via env. */
export function getSorobanRpcUrl(network: BlendNetwork): string {
  const envUrl = process.env.BLEND_SOROBAN_RPC_URL;
  if (envUrl) return envUrl;
  return network === 'mainnet' ? 'https://mainnet.sorobanrpc.com' : 'https://soroban-testnet.stellar.org';
}

/** Minimum health factor this adapter will allow a BORROW/WITHDRAW to leave a position at.
 *  Overridable via env for a deployment that wants a stricter safety margin than Blend's own
 *  1.0 liquidation threshold; defaults to a conservative 1.2 buffer above liquidation. */
export function getMinHealthFactor(): number {
  const envVal = process.env.BLEND_MIN_HEALTH_FACTOR;
  if (envVal === undefined) return 1.2;
  const parsed = Number(envVal);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid BLEND_MIN_HEALTH_FACTOR: '${envVal}' must be a positive finite number.`);
  return parsed;
}
