"use client";

import { useCallback } from "react";
import type { WalletState } from "@/app/lib/stellar";
import { challengeAndVerify, getStoredSessionToken } from "@/app/lib/agentsAuth";
import { setAuthToken } from "@/app/lib/agentsBackend";

export interface LoginResult {
  authed: boolean;
  token: string | null;
}

export interface UseAuthenticationResult {
  /** Runs (or reuses a cached) SEP-53 login for `wallet` (see app/lib/agentsAuth.ts). Only
   *  prompts Freighter's sign-message popup when `interactive` is true — a silent background
   *  restore/poll must never surprise the user with a signature request it didn't ask for this
   *  tab session. Best-effort: a failed login just resolves `authed: false` rather than
   *  throwing — agents-backend calls surface their own 401 later if attempted without a
   *  session. */
  login: (wallet: WalletState, interactive: boolean) => Promise<LoginResult>;
  /** Runs the same handshake only if `wallet` has no cached session yet — call from pages that
   *  actually need agents-backend calls (Trade/Agents/History), not on cold app load. Pass
   *  `interactive: false` for background polling so a cleared token doesn't repeatedly pop a
   *  Freighter signature prompt unattended. */
  ensureAgentAuth: (wallet: WalletState | null, interactive?: boolean) => Promise<void>;
  /** Drops the current bearer token — called on disconnect. */
  logout: () => void;
}

/**
 * Owns the SEP-53 login handshake and the resulting agents-backend bearer token. Every other
 * hook that needs an authenticated call goes through this instead of re-running challenge/verify
 * itself — see useSmartWallet.ts's composition and useSmartWallets.ts's remote list fetch.
 */
export function useAuthentication(): UseAuthenticationResult {
  const login = useCallback(async (wallet: WalletState, interactive: boolean): Promise<LoginResult> => {
    const cached = getStoredSessionToken(wallet.address);
    if (cached) {
      setAuthToken(cached);
      return { authed: true, token: cached };
    }
    if (!interactive) {
      return { authed: false, token: null };
    }
    try {
      const token = await challengeAndVerify(wallet.address, wallet.networkPassphrase);
      setAuthToken(token);
      return { authed: true, token };
    } catch (e) {
      console.error("Agent backend login failed:", e);
      return { authed: false, token: null };
    }
  }, []);

  const ensureAgentAuth = useCallback(async (wallet: WalletState | null, interactive = true) => {
    if (!wallet) return;
    const cached = getStoredSessionToken(wallet.address);
    if (cached) {
      setAuthToken(cached);
      return;
    }
    if (!interactive) return;
    try {
      const token = await challengeAndVerify(wallet.address, wallet.networkPassphrase);
      setAuthToken(token);
    } catch (e) {
      console.error("Agent backend login failed:", e);
    }
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
  }, []);

  return { login, ensureAgentAuth, logout };
}
