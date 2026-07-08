import { NextResponse } from "next/server";
import { getContractConfig } from "@/app/lib/sdk";
import { lookupRegistry, registerOnChain } from "@/app/lib/sdk/registry";
import { registerSmartWallet, requireAuthHeader, requireSmartWalletAddress, withOnboardingErrors } from "../_shared";

/**
 * POST /api/connect/register — retry-only: persists a mapping for a smart wallet that already
 * deployed on-chain (a prior /api/connect/submit whose persistence step failed). Never
 * re-deploys, so a retry can't leave the owner with two smart wallets.
 */
export const POST = withOnboardingErrors(async (request: Request) => {
  const authHeader = requireAuthHeader(request.headers.get("authorization"));
  const body = await request.json().catch(() => ({}));
  const smartWallet = requireSmartWalletAddress(body.smartWallet);

  const registerRes = await registerSmartWallet(authHeader, smartWallet);
  if (!registerRes.ok) {
    return NextResponse.json({ error: registerRes.data.error || "Failed to save wallet mapping" }, { status: registerRes.status });
  }

  const owner = registerRes.data.owner;
  // Registry write must be verified, not fire-and-forget — same invariant as /api/connect/submit.
  // A silent failure here would leave /api/connect/check's registry fallback pointing nowhere for
  // this owner while the DB row already reports success, so a mismatch must fail the request.
  if (owner && getContractConfig().registry) {
    try {
      await registerOnChain(owner, smartWallet);
    } catch (err) {
      console.error("Failed to register smart wallet on-chain registry:", err);
      return NextResponse.json(
        { error: "Wallet mapping saved but registry registration failed — retry to re-link it", smartWallet },
        { status: 502 }
      );
    }
    const verified = await lookupRegistry(owner);
    if (verified !== smartWallet) {
      console.error("Registry verification mismatch after registration", { owner, expected: smartWallet, got: verified });
      return NextResponse.json(
        { error: "Wallet mapping saved but registry entry could not be verified — retry to re-link it", smartWallet },
        { status: 502 }
      );
    }
  }

  return NextResponse.json({ success: true, status: "created", smartWallet });
});
