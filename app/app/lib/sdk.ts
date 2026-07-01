import KairosClient from "@wolf1276/kairos-sdk";
import type { Delegation, Caveat } from "@wolf1276/kairos-sdk";

function readContractId(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}. Set it in .env.local or Vercel env.`);
  return val;
}

export function getContractConfig() {
  return {
    delegationManager: readContractId("DELEGATION_MANAGER_CONTRACT_ID"),
    policyEngine: readContractId("POLICY_CONTRACT_ID"),
    customAccount: readContractId("CUSTOM_ACCOUNT_CONTRACT_ID"),
    customAccountWasmHash: readContractId("CUSTOM_ACCOUNT_WASM_HASH"),
  };
}

export interface AppWallet {
  address: string;
  smartWalletAddress?: string;
  network: string;
  networkPassphrase: string;
  balance: string;
  isTestnet: boolean;
}

export interface AppDelegation {
  hash: string;
  delegation: Delegation;
  caveats: Caveat[];
}

let sdkClient: KairosClient | null = null;

function getClient(): KairosClient {
  if (!sdkClient) {
    const config = getContractConfig();
    sdkClient = new KairosClient({
      network: "testnet",
      contracts: {
        delegationManager: config.delegationManager,
        policyEngine: config.policyEngine,
        smartWallet: config.customAccount,
      },
    });
  }
  return sdkClient;
}

export async function createPolicy(params: {
  type: "target-whitelist" | "time-restriction" | "spend-limit";
  target?: string;
  start?: bigint | number;
  expiry?: bigint | number;
  token?: string;
  spendLimit?: string | bigint;
  period?: bigint | number;
}): Promise<Caveat> {
  const client = getClient();
  return client.policy.create(params);
}

export function computeHash(delegation: Omit<Delegation, "signature">): string {
  const client = getClient();
  const hash = client.delegation.getHash(delegation as Delegation);
  return hash;
}

export type { Delegation, Caveat } from "@wolf1276/kairos-sdk";
