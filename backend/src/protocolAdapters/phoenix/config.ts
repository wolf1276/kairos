// Phoenix network/contract configuration. Contract IDs are NEVER hardcoded — every address is
// read from environment config, same pattern as `aquarius/config.ts` and `backend/src/config.ts`
// (neither modified by this file). Phoenix has two on-chain integration points: the `multihop`
// contract (swaps/routing) and the `factory` contract (pool discovery) — real, distinct Soroban
// contracts per https://github.com/Phoenix-Protocol-Group/phoenix-contracts. Liquidity
// deposit/withdrawal happens on the individual pool contract itself (discovered via the factory),
// since Phoenix has no single router for liquidity — this mirrors the protocol's actual design,
// not a workaround.
export type PhoenixNetwork = 'testnet' | 'mainnet';

function readRequiredEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

export function getPhoenixMultihopContractId(network: PhoenixNetwork): string {
  const key = network === 'mainnet' ? 'PHOENIX_MULTIHOP_CONTRACT_ID_MAINNET' : 'PHOENIX_MULTIHOP_CONTRACT_ID_TESTNET';
  return readRequiredEnv(key);
}

export function getPhoenixFactoryContractId(network: PhoenixNetwork): string {
  const key = network === 'mainnet' ? 'PHOENIX_FACTORY_CONTRACT_ID_MAINNET' : 'PHOENIX_FACTORY_CONTRACT_ID_TESTNET';
  return readRequiredEnv(key);
}

export function getSorobanRpcUrl(network: PhoenixNetwork): string {
  const envUrl = process.env.PHOENIX_SOROBAN_RPC_URL;
  if (envUrl) return envUrl;
  return network === 'mainnet' ? 'https://mainnet.sorobanrpc.com' : 'https://soroban-testnet.stellar.org';
}
