import { getContractConfig, getKairosClient } from "./client";
import { getFunderKeypair } from "./wallet/accounts";

/** Thrown when the caller asks to register a smart wallet whose on-chain Owner isn't the claimed
 *  owner. A permanent client error (400), not a transient registry failure (502) — retrying with
 *  the same inputs can never succeed. */
export class OwnershipMismatchError extends Error {}

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

  // The Registry contract now enforces owner<->wallet consistency on-chain (it cross-calls
  // smart_wallet.owner() and rejects a mismatch — M1 fix), so this off-chain check is no longer
  // the sole guard. We keep it because one caller (/api/connect/register) passes a client-supplied
  // smartWallet, and catching the mismatch here yields a clean 400 (OwnershipMismatchError) instead
  // of a raw contract trap surfaced as a 502. Reads DataKey::Owner from the deployed CustomAccount.
  const walletOwner = await client.wallet.owner(smartWalletAddress);
  if (walletOwner !== ownerAddress) {
    throw new OwnershipMismatchError(
      `Ownership mismatch: smart wallet ${smartWalletAddress} is owned by ${walletOwner}, not ${ownerAddress}`
    );
  }

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
