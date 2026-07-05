import { Keypair } from "@stellar/stellar-sdk";

/** The account that pays fees for every sponsored flow (wallet deploy, delegation register,
 *  etc.) — never the connected user's own key, which is why these flows need a separately
 *  signed authorization entry from the owner instead of a plain transaction signature. */
export function getFunderKeypair(): Keypair {
  const secret = process.env.FUNDER_SECRET_KEY;
  if (!secret) throw new Error("FUNDER_SECRET_KEY not configured");
  return Keypair.fromSecret(secret);
}
