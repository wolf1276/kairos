"use client";

import { ONBOARDING_STAGE_LABEL, type OnboardingStage } from "@/app/services/onboarding";

interface OnboardingOverlayProps {
  stage: OnboardingStage | null;
  error: string | null;
  onRetry: () => void;
}

/** Full-screen loading state shown while a first-time Connect Wallet click is auto-provisioning
 *  a smart wallet (or logging an existing one back in) — see useSmartWallet.ts's onboardingStage.
 *  Deliberately never mentions Soroban/contracts/XDR by name, per the product's "Preparing Kairos
 *  Account" copy — the smart wallet is infrastructure, not something the user manages directly. */
export function OnboardingOverlay({ stage, error, onRetry }: OnboardingOverlayProps) {
  if (!stage && !error) return null;

  return (
    <div className="fixed inset-0 z-[998] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-white/10 bg-[#0b0b0f] px-8 py-10 text-center shadow-2xl">
        {error ? (
          <>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10 text-red-400">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Couldn&apos;t finish setting up your account</p>
              <p className="mt-1.5 text-xs leading-relaxed text-white/50">{error}</p>
            </div>
            <button
              onClick={onRetry}
              className="mt-1 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black transition-colors hover:bg-white/90"
            >
              Retry
            </button>
          </>
        ) : (
          <>
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
            <p className="text-sm font-medium text-white">{stage ? ONBOARDING_STAGE_LABEL[stage] : ""}</p>
          </>
        )}
      </div>
    </div>
  );
}
