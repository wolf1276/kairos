import { getContractConfig, getKairosClient } from "../client";
import { getFunderKeypair } from "./accounts";

export interface PreparedSmartWalletDeploy {
  unsignedEntryXdr: string;
  smartWalletAddress: string;
  saltHex: string;
  validUntilLedgerSeq: number;
}

/**
 * Onboarding step 1 of 2: prepares a sponsored CustomAccount (smart wallet) deployment for
 * `ownerAddress` — the funder pays fees, but Soroban still requires the owner to separately
 * authorize the `CreateContract` call. Returns the unsigned authorization entry for the
 * browser to sign with Freighter (`signAuthEntryWithWallet`) and hand to
 * `submitSmartWalletDeploy`. Thin wrapper around the SDK's own `WalletModule` — see
 * packages/sdk/src/wallet/index.ts for the actual deploy/init logic.
 */
export async function prepareSmartWalletDeploy(ownerAddress: string): Promise<PreparedSmartWalletDeploy> {
  const client = getKairosClient();
  const funder = getFunderKeypair();
  // Fund (and wait for Soroban RPC to see) the funder account before deploying — a fresh
  // funder or one that hasn't propagated yet would otherwise fail deploy with an opaque
  // "account not found" error. The owner also needs a visible classic account ledger entry
  // before Soroban can validate their address-credentials auth entry on the CreateContract op.
  await client.ensureFundedTestnetAccount(funder.publicKey());
  await client.ensureFundedTestnetAccount(ownerAddress);
  return client.wallet.prepareSponsoredDeploy(funder.publicKey(), ownerAddress, getContractConfig().customAccountWasmHash);
}

/**
 * Onboarding step 2 of 2: submits the sponsored deployment using the owner's signed
 * authorization entry from `prepareSmartWalletDeploy`, then initializes the wallet. Returns
 * the deployed wallet's contract address.
 */
export async function submitSmartWalletDeploy(ownerAddress: string, saltHex: string, signedEntryXdr: string) {
  const client = getKairosClient();
  const funder = getFunderKeypair();
  return client.wallet.submitSponsoredDeploy(
    funder,
    ownerAddress,
    getContractConfig().customAccountWasmHash,
    saltHex,
    signedEntryXdr
  );
}
