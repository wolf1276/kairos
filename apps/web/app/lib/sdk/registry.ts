import { getKairosClient } from "./client";
import { getFunderKeypair } from "./wallet/accounts";

/**
 * Funder-attested registration of an already-deployed smart wallet in the on-chain registry
 * contract — no owner signature needed, since the funder already sponsored and observed the
 * deploy. Thin wrapper around the SDK's RegistryModule — see packages/sdk/src/registry/index.ts.
 */
export async function registerOnChain(ownerAddress: string, smartWalletAddress: string): Promise<void> {
  const client = getKairosClient();
  const funder = getFunderKeypair();
  await client.ensureFundedTestnetAccount(funder.publicKey());
  return client.registry.register(funder, ownerAddress, smartWalletAddress);
}

/**
 * Read-only on-chain lookup used as a fallback when the DB has no smart-wallet record for
 * `ownerAddress` (e.g. the DB row was lost or never written).
 */
export async function lookupRegistry(ownerAddress: string): Promise<string | null> {
  return getKairosClient().registry.getSmartWallet(ownerAddress);
}
