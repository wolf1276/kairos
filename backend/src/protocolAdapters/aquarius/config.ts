// Aquarius network/contract configuration. Contract IDs are NEVER hardcoded — every address is
// read from environment config, following the same `readRequiredEnv` pattern as
// `backend/src/config.ts` (not modified by this file). Per-network, since testnet and mainnet
// router deployments are different contracts.
export type AquariusNetwork = 'testnet' | 'mainnet';

function readRequiredEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

/** The Aquarius Router contract address for a given network — the single on-chain integration
 *  point (see architecture doc: "Use Aquarius Router as the single integration point"). Never
 *  interacts with individual pool contracts unless the router itself requires it for
 *  concentrated-liquidity actions. */
export function getAquariusRouterContractId(network: AquariusNetwork): string {
  const key = network === 'mainnet' ? 'AQUARIUS_ROUTER_CONTRACT_ID_MAINNET' : 'AQUARIUS_ROUTER_CONTRACT_ID_TESTNET';
  return readRequiredEnv(key);
}

/** Aquarius Backend API base URL — used for pool discovery and asset/pool resolution (never for
 *  path *amounts*; see `realBackendApi.ts`). Defaults to the real, public, verified-live endpoint
 *  per network (https://docs.aqua.network/developers/code-examples/prerequisites-and-basics),
 *  overridable via env for a private/staging deployment. */
export function getAquariusBackendApiUrl(network: AquariusNetwork = 'testnet'): string {
  const envUrl = process.env.AQUARIUS_BACKEND_API_URL;
  if (envUrl) return envUrl;
  return network === 'mainnet' ? 'https://amm-api.aqua.network/api/external/v2' : 'https://amm-api-testnet.aqua.network/api/external/v2';
}

/** Soroban RPC endpoint per network — the standard public Stellar RPC, overridable via env. */
export function getSorobanRpcUrl(network: AquariusNetwork): string {
  const envUrl = process.env.AQUARIUS_SOROBAN_RPC_URL;
  if (envUrl) return envUrl;
  return network === 'mainnet' ? 'https://mainnet.sorobanrpc.com' : 'https://soroban-testnet.stellar.org';
}

/** The Stellar account (public key only) used as the transaction *source* for read-only
 *  simulation. Simulation never signs or submits, so no secret key is ever required here — only
 *  a real, existing account (to supply a valid sequence number for building the transaction
 *  envelope). Never hardcoded: read from env, so each deployment supplies its own. */
export function getAquariusSimulationSourceAccount(): string {
  return readRequiredEnv('AQUARIUS_SIMULATION_SOURCE_ACCOUNT');
}
