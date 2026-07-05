"use client";

import { useCallback, useRef, useState } from "react";
import type { WalletState } from "@/app/lib/stellar";
import { OnboardingStage, onboardingService, type PendingOnboardingRetry } from "@/app/services/onboarding";

export interface UseOnboardingResult {
  /** Drives the Connect Wallet loading overlay (see components/OnboardingOverlay.tsx). Null
   *  once settled. */
  onboardingStage: OnboardingStage | null;
  /** Set if the automatic first-time deploy (or its persistence step) failed — retry via
   *  `retryOnboarding`, which resumes rather than restarting from scratch. */
  onboardingError: string | null;
  /** Runs the automatic first-time deploy for `wallet` — resolves to the deployed smart wallet
   *  address, or null if it failed (`onboardingError` is set; call `retryOnboarding` to resume). */
  runOnboarding: (wallet: WalletState, token: string) => Promise<string | null>;
  retryOnboarding: () => Promise<string | null>;
  setStage: (stage: OnboardingStage | null) => void;
  reset: () => void;
}

/**
 * Owns onboarding UI state (stage/error) and delegates every actual step — prepare, sign,
 * submit, persist, and the "resume instead of redeploy" retry safety — to `OnboardingService`.
 * This hook renders state; it doesn't decide what the steps are.
 */
export function useOnboarding(): UseOnboardingResult {
  const [onboardingStage, setOnboardingStage] = useState<OnboardingStage | null>(null);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  // Stashed only when the automatic first-time deploy fails, so `retryOnboarding` can resume
  // (redeploy, or just re-persist if it got as far as an on-chain deploy) without a fresh connect.
  const pendingRetryRef = useRef<PendingOnboardingRetry | null>(null);

  const runOnboarding = useCallback(async (wallet: WalletState, token: string): Promise<string | null> => {
    setOnboardingError(null);
    try {
      const smartWallet = await onboardingService.start(wallet, token, setOnboardingStage);
      pendingRetryRef.current = null;
      return smartWallet;
    } catch (e) {
      const resumeSmartWallet = onboardingService.resumeAddressFromError(e);
      pendingRetryRef.current = { wallet, token, resumeSmartWallet };
      setOnboardingError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setOnboardingStage(null);
    }
  }, []);

  const retryOnboarding = useCallback(async (): Promise<string | null> => {
    const pending = pendingRetryRef.current;
    if (!pending) return null;
    setOnboardingError(null);
    try {
      const smartWallet = await onboardingService.retry(pending, setOnboardingStage);
      pendingRetryRef.current = null;
      return smartWallet;
    } catch (e) {
      const resumeSmartWallet = onboardingService.resumeAddressFromError(e) ?? pending.resumeSmartWallet;
      pendingRetryRef.current = { ...pending, resumeSmartWallet };
      setOnboardingError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setOnboardingStage(null);
    }
  }, []);

  const reset = useCallback(() => {
    setOnboardingStage(null);
    setOnboardingError(null);
    pendingRetryRef.current = null;
  }, []);

  return { onboardingStage, onboardingError, runOnboarding, retryOnboarding, setStage: setOnboardingStage, reset };
}
