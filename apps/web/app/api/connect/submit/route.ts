import { NextResponse } from "next/server";
import { submitSmartWalletDeploy } from "@/app/lib/sdk";
import { OnboardingRequestError, registerSmartWallet, requireAuthHeader, requireOwner, withOnboardingErrors } from "../_shared";

/**
 * POST /api/connect/submit — new-user onboarding step 2: submits the signed deploy from
 * /api/connect/prepare, then persists the wallet mapping via the existing smart-wallets route.
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

  const registerRes = await registerSmartWallet(authHeader, deployed.address);
  if (!registerRes.ok) {
    // The smart wallet is already live on-chain at this point — surface the deployed address so
    // the caller can retry *just* the persistence step via /api/connect/register instead of
    // preparing/signing/submitting a brand new (and redundant) deployment.
    return NextResponse.json(
      {
        error: registerRes.data.error || "Smart wallet deployed on-chain but failed to save — retry to re-link it",
        smartWallet: deployed.address,
      },
      { status: registerRes.status }
    );
  }

  return NextResponse.json({ success: true, status: "created", walletAddress: owner, smartWallet: deployed.address });
});
