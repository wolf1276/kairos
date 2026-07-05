import { NextResponse } from "next/server";
import { registerOnChain } from "@/app/lib/sdk/registry";
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
  if (owner) {
    // Best-effort — same non-blocking treatment as /api/connect/submit's registry write.
    registerOnChain(owner, smartWallet).catch((err) => {
      console.error("Failed to register smart wallet on-chain registry:", err);
    });
  }

  return NextResponse.json({ success: true, status: "created", smartWallet });
});
