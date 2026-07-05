import { signAuthEntryWithWallet, type WalletState } from "@/app/lib/stellar";
import {
  checkOnboarding,
  prepareOnboarding,
  submitOnboarding,
  registerOnboarding,
  ConnectApiError,
  type ConnectCheckResult,
  type ConnectSubmitResult,
} from "@/app/lib/connectApi";
import { OnboardingStage, type PendingOnboardingRetry } from "./types";

export type OnboardingStageListener = (stage: OnboardingStage) => void;

/**
 * Owns the "does this owner have a smart wallet yet, and if not, deploy + persist one"
 * business logic — every step lives here instead of inside a React hook. Hooks (useOnboarding)
 * only call these methods and mirror the stage/error into render state; components only render
 * whatever the hook gives them. See app/lib/connectApi.ts for the actual HTTP calls this wraps,
 * and app/lib/sdk/wallet/deployment.ts for the SDK calls those routes make server-side.
 */
export class OnboardingService {
  /** Read-only existence check via the dedicated onboarding endpoint (/api/connect/check).
   *  Not on the hot path today — useSmartWallets' local+remote smart-wallet merge already
   *  answers "is this a new user" without an extra round trip (and handles multi-wallet
   *  reconciliation this endpoint doesn't need to know about) — but kept as the service's own
   *  authoritative check for any future caller that doesn't already have that merged list. */
  async checkExistingWallet(token: string): Promise<ConnectCheckResult> {
    return checkOnboarding(token);
  }

  async prepareDeployment(owner: string, token: string) {
    return prepareOnboarding(owner, token);
  }

  async submitDeployment(owner: string, saltHex: string, signedEntryXdr: string, token: string): Promise<ConnectSubmitResult> {
    return submitOnboarding(owner, saltHex, signedEntryXdr, token);
  }

  async registerWallet(smartWallet: string, token: string): Promise<ConnectSubmitResult> {
    return registerOnboarding(smartWallet, token);
  }

  /** Fresh first-time deploy: prepare -> Freighter signAuthEntry -> submit -> persist. */
  async start(wallet: WalletState, token: string, onStageChange: OnboardingStageListener): Promise<string> {
    return this.runDeploy(wallet, token, onStageChange);
  }

  /** Resumes a previously-failed attempt. If that attempt already got the smart wallet live
   *  on-chain (`resumeSmartWallet` set), this skips straight to re-registering it instead of
   *  preparing/signing/submitting a brand new — and redundant — deployment. This is the one
   *  invariant that must never regress: a retry can never leave an owner with two wallets. */
  async retry(pending: PendingOnboardingRetry, onStageChange: OnboardingStageListener): Promise<string> {
    return this.runDeploy(pending.wallet, pending.token, onStageChange, pending.resumeSmartWallet);
  }

  /** Reads the "deployed on-chain but not yet persisted" address off a failed attempt, if any —
   *  lets callers build a `PendingOnboardingRetry` without reaching into `ConnectApiError`. */
  resumeAddressFromError(error: unknown): string | undefined {
    return error instanceof ConnectApiError ? error.smartWallet : undefined;
  }

  private async runDeploy(
    wallet: WalletState,
    token: string,
    onStageChange: OnboardingStageListener,
    resumeSmartWallet?: string
  ): Promise<string> {
    if (resumeSmartWallet) {
      onStageChange(OnboardingStage.RegisteringWallet);
      const registered = await this.registerWallet(resumeSmartWallet, token);
      return registered.smartWallet;
    }

    onStageChange(OnboardingStage.PreparingDeployment);
    const prepared = await this.prepareDeployment(wallet.address, token);
    const signedEntryXdr = await signAuthEntryWithWallet(
      prepared.unsignedEntryXdr,
      prepared.validUntilLedgerSeq,
      wallet.networkPassphrase,
      wallet.address
    );

    onStageChange(OnboardingStage.Deploying);
    const submitted = await this.submitDeployment(wallet.address, prepared.saltHex, signedEntryXdr, token);
    return submitted.smartWallet;
  }
}

/** Stateless — safe to share a single instance across the app. */
export const onboardingService = new OnboardingService();
