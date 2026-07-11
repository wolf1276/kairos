import { NextResponse } from "next/server";
import { submitSmartWalletDeploy } from "@/app/lib/sdk";
import { getContractConfig } from "@/app/lib/sdk";
import { lookupRegistry, registerOnChain } from "@/app/lib/sdk/registry";
import { OnboardingRequestError, registerSmartWallet, requireAuthHeader, requireOwner, withOnboardingErrors } from "../_shared";

/**
 * POST /api/connect/submit — new-user onboarding step 2: submits the signed deploy from
 * /api/connect/prepare, registers + verifies the on-chain registry entry (the durable source of
 * truth a later /api/connect/check falls back to), then persists the DB mapping.
 */
export const POST = withOnboardingErrors(async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  const owner = requireOwner(body.owner);
  const { saltHex, signedEntryXdr } = body;
  if (!saltHex || !signedEntryXdr) {
    throw new OnboardingRequestError("saltHex and signedEntryXdr are required", 400);
  }
  const authHeader = requireAuthHeader(request.headers.get("authorization"));

  const deployed = await submitSmartWalletDeploy(owner, saltHex, signedEntryXdr);

  // Registry write must be verified, not fire-and-forget — /api/connect/check's fallback
  // depends on this entry existing whenever the DB row is lost, so a silent failure here would
  // leave the wallet unrecoverable and indistinguishable from "never created". The smart wallet
  // is already live on-chain at this point (deploy can't be undone), so we surface its address
  // for a retry via /api/connect/register instead of reporting false success.
  // Not every environment has the registry contract deployed yet (see getContractConfig) —
  // in that case registerOnChain/lookupRegistry are permanent no-ops, and requiring verification
  // would fail onboarding everywhere the registry simply isn't configured. Only enforce the
  // verified-write invariant where the registry actually exists.
  const registryIsSourceOfTruth = !!getContractConfig().registry;
  if (registryIsSourceOfTruth) {
    try {
      await registerOnChain(owner, deployed.address);
    } catch (err) {
      console.error("Failed to register smart wallet on-chain registry:", err);
      return NextResponse.json(
        {
          error: "Smart wallet deployed on-chain but registry registration failed — retry to re-link it",
          smartWallet: deployed.address,
        },
        { status: 502 }
      );
    }
    const verified = await lookupRegistry(owner);
    if (verified !== deployed.address) {
      console.error("Registry verification mismatch after registration", { owner, expected: deployed.address, got: verified });
      return NextResponse.json(
        {
          error: "Smart wallet deployed on-chain but registry entry could not be verified — retry to re-link it",
          smartWallet: deployed.address,
        },
        { status: 502 }
      );
    }
  }

  const registerRes = await registerSmartWallet(authHeader, deployed.address);
  if (!registerRes.ok) {
    // When the registry is the source of truth, the verified on-chain entry above is what
    // /api/connect/check reads (and backfills the DB from) — so a DB persistence failure here is
    // just a cold cache, not lost data. Don't fail onboarding on it (e.g. DATABASE_URL unset in
    // prod). Without a registry, the DB is the only record, so its failure stays fatal: surface
    // the deployed address for a retry of *just* the persist step via /api/connect/register.
    if (!registryIsSourceOfTruth) {
      return NextResponse.json(
        {
          error: registerRes.data.error || "Smart wallet deployed on-chain but failed to save — retry to re-link it",
          smartWallet: deployed.address,
        },
        { status: registerRes.status }
      );
    }
    console.warn("Smart wallet registered on-chain but DB cache write failed (non-fatal):", registerRes.data.error);
  }

  return NextResponse.json({ success: true, status: "created", walletAddress: owner, smartWallet: deployed.address });
});
