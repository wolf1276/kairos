import KairosClient from "@wolf1276/kairos-sdk";

function readContractId(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}. Set it in .env.local or Vercel env.`);
  return val;
}

function getNetwork(): "testnet" | "mainnet" {
  const network = process.env.STELLAR_NETWORK || "testnet";
  if (network !== "testnet" && network !== "mainnet") {
    throw new Error(`Invalid STELLAR_NETWORK: ${network}`);
  }
  return network;
}

export function getContractConfig() {
  return {
    delegationManager: readContractId("DELEGATION_MANAGER_CONTRACT_ID"),
    policyEngine: readContractId("POLICY_CONTRACT_ID"),
    customAccount: readContractId("CUSTOM_ACCOUNT_CONTRACT_ID"),
    customAccountWasmHash: readContractId("CUSTOM_ACCOUNT_WASM_HASH"),
    // Optional: the registry contract is a best-effort fallback/write, not deployed in every
    // environment yet. Missing it must never break the core wallet-deploy path.
    registry: process.env.REGISTRY_CONTRACT_ID || undefined,
  };
}

let sdkClient: KairosClient | null = null;

/** Shared singleton client — every route that needs the SDK (delegate-sdk, connect/*) goes
 *  through this instead of each re-deriving a KairosClient from env vars. */
export function getKairosClient(): KairosClient {
  if (!sdkClient) {
    const config = getContractConfig();
    sdkClient = new KairosClient({
      network: getNetwork(),
      contracts: {
        delegationManager: config.delegationManager,
        policyEngine: config.policyEngine,
        smartWallet: config.customAccount,
        registry: config.registry,
      },
    });
  }
  return sdkClient;
}
