import type { WalletState } from "@/app/lib/stellar";

/** Every step the automatic Connect Wallet flow can be in — strongly typed so no stage
 *  comparison anywhere in the business logic is a magic string. `null`/absent means idle
 *  (nothing running, overlay hidden) — there's no separate "Completed" member because the
 *  overlay's contract has always been "no stage set = done", not a terminal enum value. */
export enum OnboardingStage {
  /** SEP-53 login handshake (Freighter signMessage popup). */
  Authenticating = "authenticating",
  /** Sponsored-deploy PREPARE call, plus the Freighter signAuthEntry popup that follows it. */
  PreparingDeployment = "preparing_deployment",
  /** Sponsored-deploy SUBMIT call (on-chain CreateContract + init). */
  Deploying = "deploying",
  /** Retry-only: re-persisting a wallet that already deployed on-chain. */
  RegisteringWallet = "registering_wallet",
  /** Client-side navigation to /dashboard once everything above has settled. */
  Redirecting = "redirecting",
}

/** Display copy for each stage — deliberately free of blockchain terminology (Soroban,
 *  contract, XDR, sponsored deploy); the smart wallet is infrastructure, not something the
 *  user manages directly. This is product-facing copy, kept 1:1 with the original strings so
 *  the refactor changes zero user-visible behavior. */
export const ONBOARDING_STAGE_LABEL: Record<OnboardingStage, string> = {
  [OnboardingStage.Authenticating]: "Connecting Wallet...",
  [OnboardingStage.PreparingDeployment]: "Preparing Kairos Account...",
  [OnboardingStage.Deploying]: "Deploying Smart Wallet...",
  [OnboardingStage.RegisteringWallet]: "Finalizing Setup...",
  [OnboardingStage.Redirecting]: "Redirecting...",
};

/** Stashed only when the automatic first-time deploy (or its persistence step) fails, so
 *  `OnboardingService.retry` can resume instead of restarting from scratch. */
export interface PendingOnboardingRetry {
  wallet: WalletState;
  token: string;
  /** Set when a prior attempt got the smart wallet live on-chain but failed to persist it —
   *  `retry` skips straight to re-registering this address instead of redeploying. */
  resumeSmartWallet?: string;
}
