import { NextResponse } from "next/server";
import { lookupRegistry } from "@/app/lib/sdk/registry";
import { backendFetch, registerSmartWallet, requireAuthHeader, withOnboardingErrors } from "../_shared";

/**
 * POST /api/connect/check — determines whether the already-authenticated caller has a smart
 * wallet yet. Proxies to the existing smart-wallets store (backend/src/routes/smartWallets.ts)
 * as the fast path; if that DB has no record, OR the DB is unavailable (5xx/timeout — see
 * smartWallets.ts GET), falls back to an on-chain registry lookup (the canonical source of
 * truth) before reporting "new" and walking the caller through creating a brand new smart
 * wallet. A temporary DB outage must never, by itself, tell an existing owner to create a
 * second smart wallet — only an empty Registry result may do that.
 */
export const POST = withOnboardingErrors(async (request: Request) => {
  const authHeader = requireAuthHeader(request.headers.get("authorization"));

  const backendRes = await backendFetch("/api/smart-wallets", authHeader);

  const existing = backendRes.ok ? backendRes.data.wallets?.[0] : undefined;
  if (existing) {
    return NextResponse.json({
      success: true,
      status: "existing",
      walletAddress: existing.owner,
      smartWallet: existing.address,
    });
  }

  // `owner` is derived from the auth token by the backend and is returned on both success and
  // 503 responses (see smartWallets.ts) — so it's available even when the DB call failed.
  const owner = backendRes.data.owner;

  // lookupRegistry throws (RpcError/TransactionSimulationError) for anything that isn't a
  // confirmed "no wallet" — RPC failure, network timeout, simulation failure, etc (see
  // packages/sdk/src/registry/index.ts). That must surface as an explicit error, NEVER get
  // treated as "the wallet doesn't exist" — collapsing "we couldn't check" into "new" is exactly
  // the fail-open bug this route exists to avoid (it would offer an existing owner a second
  // "Create Smart Wallet" flow).
  let onChainWallet: string | null = null;
  if (owner) {
    try {
      onChainWallet = await lookupRegistry(owner);
    } catch (err) {
      return NextResponse.json(
        {
          success: false,
          status: "error",
          error: `Registry lookup failed: ${err instanceof Error ? err.message : String(err)}`,
        },
        { status: 502 }
      );
    }
  }

  if (owner && onChainWallet) {
    // Backfill the DB so subsequent checks hit the fast path instead of the registry again.
    // Best-effort only: if the DB is still down, don't let that failure hide the fact that we
    // already found (and are about to return) the caller's existing smart wallet.
    await registerSmartWallet(authHeader, onChainWallet).catch(() => undefined);
    return NextResponse.json({
      success: true,
      status: "existing",
      walletAddress: owner,
      smartWallet: onChainWallet,
    });
  }

  // Neither the DB nor the Registry has a wallet for this owner. If the DB call itself failed,
  // surface that alongside the verdict rather than hiding it — but the Registry miss is what
  // makes "new" the correct answer, DB outage or not.
  return NextResponse.json({
    success: true,
    status: "new",
    ...(backendRes.ok ? {} : { dbWarning: backendRes.data.error || "Onboarding backend unavailable" }),
  });
});
