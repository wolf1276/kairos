import { NextResponse } from "next/server";
import { backendFetch, requireAuthHeader, withOnboardingErrors } from "../_shared";

/**
 * POST /api/connect/check — determines whether the already-authenticated caller has a smart
 * wallet yet. Read-only, proxies to the existing smart-wallets store
 * (backend/src/routes/smartWallets.ts) rather than tracking its own copy of "who's onboarded".
 */
export const POST = withOnboardingErrors(async (request: Request) => {
  const authHeader = requireAuthHeader(request.headers.get("authorization"));

  const backendRes = await backendFetch("/api/smart-wallets", authHeader);
  if (!backendRes.ok) {
    return NextResponse.json({ error: backendRes.data.error || "Failed to reach onboarding backend" }, { status: backendRes.status });
  }

  const existing = backendRes.data.wallets?.[0];
  if (!existing) {
    return NextResponse.json({ success: true, status: "new" });
  }
  return NextResponse.json({
    success: true,
    status: "existing",
    walletAddress: existing.owner,
    smartWallet: existing.address,
  });
});
