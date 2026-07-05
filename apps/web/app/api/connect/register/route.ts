import { NextResponse } from "next/server";
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
  return NextResponse.json({ success: true, status: "created", smartWallet });
});
