import { NextResponse } from "next/server";
import { lookupRegistry } from "@/app/lib/sdk/registry";
import { backendFetch, registerSmartWallet, requireAuthHeader, withOnboardingErrors } from "../_shared";

/**
 * POST /api/connect/check — determines whether the already-authenticated caller has a smart
 * wallet yet. Proxies to the existing smart-wallets store (backend/src/routes/smartWallets.ts)
 * as the fast path; if that DB has no record, falls back to an on-chain registry lookup (the
 * DB row may have been lost, or written on a different backend instance) before reporting
 * "new" and walking the caller through creating a brand new smart wallet.
 */
export const POST = withOnboardingErrors(async (request: Request) => {
  const authHeader = requireAuthHeader(request.headers.get("authorization"));

  const backendRes = await backendFetch("/api/smart-wallets", authHeader);
  if (!backendRes.ok) {
    return NextResponse.json({ error: backendRes.data.error || "Failed to reach onboarding backend" }, { status: backendRes.status });
  }

  const existing = backendRes.data.wallets?.[0];
  if (existing) {
    return NextResponse.json({
      success: true,
      status: "existing",
      walletAddress: existing.owner,
      smartWallet: existing.address,
    });
  }

  const owner = backendRes.data.owner;
  const onChainWallet = owner ? await lookupRegistry(owner) : null;
  if (owner && onChainWallet) {
    // Backfill the DB so subsequent checks hit the fast path instead of the registry again.
    await registerSmartWallet(authHeader, onChainWallet);
    return NextResponse.json({
      success: true,
      status: "existing",
      walletAddress: owner,
      smartWallet: onChainWallet,
    });
  }

  return NextResponse.json({ success: true, status: "new" });
});
