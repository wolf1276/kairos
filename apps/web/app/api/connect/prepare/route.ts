import { NextResponse } from "next/server";
import { prepareSmartWalletDeploy } from "@/app/lib/sdk";
import { requireOwner, withOnboardingErrors } from "../_shared";

/**
 * POST /api/connect/prepare — new-user onboarding step 1: prepares a sponsored smart wallet
 * deploy for `owner`, returning the unsigned Freighter auth entry. See
 * app/lib/sdk/wallet/deployment.ts for the actual SDK call this wraps.
 */
export const POST = withOnboardingErrors(async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  const owner = requireOwner(body.owner);

  const prepared = await prepareSmartWalletDeploy(owner);
  return NextResponse.json({ success: true, ...prepared });
});
