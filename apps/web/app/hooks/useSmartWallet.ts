"use client";

import { useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import type { WalletState } from "@/app/lib/stellar";
import { getStoredSessionToken } from "@/app/lib/agentsAuth";
import { OnboardingStage } from "@/app/services/onboarding";
import { useWallet, type ConnectResult } from "./useWallet";
import { useAuthentication } from "./useAuthentication";
import { useSmartWallets, type SmartWalletInfo } from "./useSmartWallets";
import { useOnboarding } from "./useOnboarding";

export type { SmartWalletInfo } from "./useSmartWallets";
export { OnboardingStage } from "@/app/services/onboarding";

export interface SmartWalletState {
  wallet: WalletState | null;
  walletOwner: string | null;
  connected: boolean;
  connecting: boolean;
  checked: boolean;
  /** The currently-selected smart wallet (smart account) agents delegate from by default. */
  smartWalletAddress: string | null;
  smartWalletBalance: string | null;
  /** Every smart wallet this owner has deployed — lets callers offer a picker instead of
   *  always using the single selected one. */
  smartWallets: SmartWalletInfo[];
  /** Switches which smart wallet is "selected" (the default for new agent launches). */
  selectWallet: (address: string) => void;
  deploying: boolean;
  deployError: string | null;
  /** Opens the connect-wallet picker modal (see components/ConnectWalletModal.tsx). */
  connect: (interactive?: boolean) => void;
  /** Whether the connect-wallet picker modal should be shown. */
  walletModalOpen: boolean;
  closeWalletModal: () => void;
  /** Called by the picker modal once the user has picked and authorized a specific wallet id. */
  pickWallet: (walletId: string) => Promise<void>;
  walletPickError: string | null;
  /** Runs the wallet-sig auth handshake if this address has no cached session yet — call from
   *  pages that actually need agents-backend calls (Trade/Agents/History), not on cold app load.
   *  Pass `interactive: false` for background polling so a cleared token doesn't repeatedly
   *  pop a Freighter signature prompt unattended. */
  ensureAgentAuth: (interactive?: boolean) => Promise<void>;
  disconnect: () => void;
  /** Deploys a new smart wallet (in addition to any existing ones) and selects it. */
  deploySmartWallet: (label?: string) => Promise<void>;
  checkBalance: (address: string) => Promise<void>;
  /** Drives the Connect Wallet loading overlay — set only during an interactive connect that's
   *  auto-provisioning a first-time owner's smart wallet (or logging an existing one in). Null
   *  once settled. */
  onboardingStage: OnboardingStage | null;
  /** Set if the automatic first-time deploy (or its persistence step) failed — retry via
   *  `retryOnboarding()`, which resumes rather than restarting from scratch. */
  onboardingError: string | null;
  retryOnboarding: () => Promise<void>;
}

/**
 * Composes the focused wallet/auth/smart-wallet/onboarding hooks into the one shape every
 * page in the app already depends on (via useWalletContext). This hook owns exactly one thing:
 * the *sequencing* between those pieces on a resolved wallet connection — everything else
 * (state, validation, retry-safety, the actual SDK/API calls) lives in the hook or service that
 * owns it. See:
 *   - useWallet          — Freighter/kit connection mechanics
 *   - useAuthentication  — SEP-53 login + bearer token
 *   - useSmartWallets    — smart wallet list/selection/balance
 *   - useOnboarding      — automatic first-time deploy, via services/onboarding/OnboardingService
 *
 * The sequencing itself is a hard invariant carried over unchanged from before this file was
 * split (see handleResolvedWallet below): auth must settle before the wallet is exposed, smart
 * wallets must be looked up before deciding whether to onboard, and a retry must never re-deploy
 * if a prior attempt already got the wallet live on-chain.
 */
export function useSmartWallet(): SmartWalletState {
  const router = useRouter();
  const pathname = usePathname();

  const auth = useAuthentication();
  const onboarding = useOnboarding();

  // handleResolvedWallet needs useWallet's `setWallet` and useSmartWallets' merge/apply
  // functions, but those hooks only exist once called below — and useWallet itself must be
  // constructed *with* handleResolvedWallet (it invokes it from inside its own effects/
  // pickWallet). Refs break that cycle: setState setters and useCallback-memoized functions
  // from sibling hooks have stable identity across renders, so by the time handleResolvedWallet
  // actually runs (later, from a user action or effect — never during this render), the refs
  // already hold the current ones.
  const setWalletRef = useRef<(w: WalletState | null) => void>(() => {});
  const smartWalletsRef = useRef<ReturnType<typeof useSmartWallets> | null>(null);

  const handleResolvedWallet = useCallback(
    async (result: ConnectResult, interactive: boolean) => {
      if (!(result.success && result.wallet)) return;
      const w = result.wallet;
      const smartWallets = smartWalletsRef.current!;

      // Must finish (or fail) the auth handshake *before* exposing the wallet via setWallet —
      // walletOwner flips truthy the instant that state update lands, and pages key their
      // agents-backend fetches off it. Setting wallet first raced setAuthToken and sent
      // requests with no bearer token yet (401 "Missing or malformed Authorization header").
      //
      // Only prompt Freighter's sign-message popup on an explicit, user-initiated connect
      // (interactive=true). The silent auto-reconnect on page mount must never surprise the
      // user with a signature request they didn't ask for this tab session — it reuses a
      // cached token if one exists, and otherwise just leaves agent-backend calls unauthenticated
      // until the user actually clicks Connect (or an agent-feature page prompts for it).
      if (interactive && !getStoredSessionToken(w.address)) {
        onboarding.setStage(OnboardingStage.Authenticating);
      }
      const { authed, token } = await auth.login(w, interactive);

      setWalletRef.current(w);
      // Don't clear smartWalletAddress/smartWalletBalance here — applySmartWallets resolves
      // the real (usually identical) address below, and blanking it first forces every balance
      // display keyed off it (useSmartWalletBalances) to flash to a confident "0" for the
      // duration of the merge/fetch below, which on a slow RPC round-trip reads as "balance
      // became 0 on relogin" even though it's just a stale render, not a real balance.

      let merged = await smartWallets.mergeSmartWallets(w.address, authed);

      // First-time onboarding: this owner authenticated successfully but has no smart wallet
      // anywhere (local or remote) — deploy one automatically instead of leaving them stuck with
      // no way to create one. Only for an interactive, freshly-authenticated connect — a silent
      // background restore/poll must never surprise the user with a Freighter signAuthEntry
      // prompt (on top of the login signature) out of nowhere.
      if (merged.length === 0 && authed && interactive && token) {
        const smartWallet = await onboarding.runOnboarding(w, token);
        if (smartWallet) merged = [{ address: smartWallet, label: null }];
      }

      await smartWallets.applySmartWallets(w, merged);

      // Navigate to the dashboard once onboarding has settled — a no-op today since the Connect
      // Wallet button only ever renders while already under /dashboard (see components/Navbar.tsx),
      // but keeps this correct if a connect entry point is ever added elsewhere (e.g. the
      // marketing homepage).
      if (interactive && pathname !== null && !pathname.startsWith("/dashboard")) {
        onboarding.setStage(OnboardingStage.Redirecting);
        router.push("/dashboard");
      }
      onboarding.setStage(null);
    },
    [auth, onboarding, router, pathname]
  );

  const walletHook = useWallet(handleResolvedWallet);
  setWalletRef.current = walletHook.setWallet;

  const smartWallets = useSmartWallets(walletHook.wallet);
  smartWalletsRef.current = smartWallets;

  /** Resumes a failed automatic first-time deploy — redeploys from scratch, or if the prior
   *  attempt already got as far as an on-chain deploy, just retries persisting that address
   *  (see OnboardingService.retry's resume behavior). No-op if there's nothing pending. */
  const retryOnboarding = useCallback(async () => {
    const smartWallet = await onboarding.retryOnboarding();
    if (smartWallet && walletHook.wallet) {
      await smartWallets.applySmartWallets(walletHook.wallet, [{ address: smartWallet, label: null }]);
    }
  }, [onboarding, smartWallets, walletHook.wallet]);

  const ensureAgentAuth = useCallback(
    (interactive = true) => auth.ensureAgentAuth(walletHook.wallet, interactive),
    [auth, walletHook.wallet]
  );

  const disconnect = useCallback(() => {
    walletHook.disconnect();
    smartWallets.reset();
    onboarding.reset();
    auth.logout();
  }, [walletHook, smartWallets, onboarding, auth]);

  return {
    wallet: walletHook.wallet,
    walletOwner: walletHook.walletOwner,
    connected: walletHook.connected,
    connecting: walletHook.connecting,
    checked: walletHook.checked,
    smartWalletAddress: smartWallets.smartWalletAddress,
    smartWalletBalance: smartWallets.smartWalletBalance,
    smartWallets: smartWallets.smartWallets,
    selectWallet: smartWallets.selectWallet,
    deploying: smartWallets.deploying,
    deployError: smartWallets.deployError,
    connect: walletHook.connect,
    walletModalOpen: walletHook.walletModalOpen,
    closeWalletModal: walletHook.closeWalletModal,
    pickWallet: walletHook.pickWallet,
    walletPickError: walletHook.walletPickError,
    ensureAgentAuth,
    disconnect,
    deploySmartWallet: smartWallets.deploySmartWallet,
    checkBalance: smartWallets.checkBalance,
    onboardingStage: onboarding.onboardingStage,
    onboardingError: onboarding.onboardingError,
    retryOnboarding,
  };
}
