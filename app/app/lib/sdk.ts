import KairosClient from "@wolf1276/kairos-sdk";
import type { Delegation, Caveat } from "@wolf1276/kairos-sdk";
import contractsConfig from "../../../config/contracts.testnet.json";

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
    sdkClient = new KairosClient({
      network: "testnet",
      contracts: {
        delegationManager: contractsConfig.delegationManager,
        policyEngine: contractsConfig.policyEngine,
        smartWallet: contractsConfig.customAccount,
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

export { contractsConfig };
export type { Delegation, Caveat } from "@wolf1276/kairos-sdk";
