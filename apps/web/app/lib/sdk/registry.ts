import { getContractConfig, getKairosClient } from "./client";
import { getFunderKeypair } from "./wallet/accounts";

/**
 * Funder-attested registration of an already-deployed smart wallet in the on-chain registry
 * contract — no owner signature needed, since the funder already sponsored and observed the
 * deploy. Thin wrapper around the SDK's RegistryModule — see packages/sdk/src/registry/index.ts.
 * No-ops if REGISTRY_CONTRACT_ID isn't configured (not deployed in every environment yet) — this
 * write is always best-effort, never a dependency of the core wallet-deploy path.
 */
export async function registerOnChain(ownerAddress: string, smartWalletAddress: string): Promise<void> {
  if (!getContractConfig().registry) return;
  const client = getKairosClient();
  const funder = getFunderKeypair();
  await client.ensureFundedTestnetAccount(funder.publicKey());
  return client.registry.register(funder, ownerAddress, smartWalletAddress);
}

/**
 * Read-only on-chain lookup used as a fallback when the DB has no smart-wallet record for
 * `ownerAddress` (e.g. the DB row was lost or never written). Returns null (fall through to
 * "new user") if REGISTRY_CONTRACT_ID isn't configured.
 */
export async function lookupRegistry(ownerAddress: string): Promise<string | null> {
  if (!getContractConfig().registry) return null;
  return getKairosClient().registry.getSmartWallet(ownerAddress);
}
