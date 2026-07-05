"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { connectWallet, disconnectWallet, tryCheckConnection, type WalletState } from "@/app/lib/stellar";
import { kitConnectWallet, kitGetAddress } from "@/app/lib/walletKit";

export type ConnectResult = Awaited<ReturnType<typeof connectWallet>>;

export interface UseWalletResult {
  wallet: WalletState | null;
  setWallet: (wallet: WalletState | null) => void;
  walletOwner: string | null;
  connected: boolean;
  connecting: boolean;
  checked: boolean;
  walletModalOpen: boolean;
  walletPickError: string | null;
  /** Opens the connect-wallet picker modal (see components/ConnectWalletModal.tsx). */
  connect: (interactive?: boolean) => void;
  closeWalletModal: () => void;
  /** Called by the picker modal once the user has picked a wallet id — resolves the kit
   *  connection, then hands the result to `onResolved`. Everything that happens *after* a
   *  wallet resolves (login, smart-wallet lookup, automatic onboarding, redirect) is
   *  sequencing the caller owns — see useSmartWallet.ts, which composes this hook with
   *  useAuthentication/useSmartWallets/useOnboarding. */
  pickWallet: (walletId: string) => Promise<void>;
  disconnect: () => void;
}

/**
 * Owns Freighter/kit connection mechanics only: opening the picker, resolving a picked wallet
 * id, silently restoring a persisted kit session on mount, and following account switches. Has
 * no opinion on login, smart wallets, or onboarding — `onResolved` is how the composer plugs
 * that sequencing in without this hook needing to know it exists.
 */
export function useWallet(onResolved: (result: ConnectResult, interactive: boolean) => void | Promise<void>): UseWalletResult {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [checked, setChecked] = useState(false);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [walletPickError, setWalletPickError] = useState<string | null>(null);
  // `connect(interactive)` just opens the modal; the actual pick happens later (async, after the
  // user clicks a wallet row), so the interactive flag has to be stashed for `pickWallet` to read.
  const interactiveRef = useRef(true);
  // `onResolved` is a fresh closure every render (it's the composer's orchestration function,
  // which depends on several sibling hooks' state) — read it via a ref so pickWallet/the mount
  // and poll effects below never need it in a dependency array.
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;

  const connect = useCallback((interactive = true) => {
    interactiveRef.current = interactive;
    setWalletPickError(null);
    setWalletModalOpen(true);
  }, []);

  const closeWalletModal = useCallback(() => {
    setWalletModalOpen(false);
  }, []);

  const pickWallet = useCallback(async (walletId: string) => {
    const interactive = interactiveRef.current;
    setConnecting(true);
    setWalletPickError(null);
    let result: ConnectResult;
    try {
      const address = await kitConnectWallet(walletId);
      result = await connectWallet(address);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const rejected = /cancel|deny|reject|closed|declined/i.test(msg);
      setWalletPickError(rejected ? "Access denied by wallet" : msg || "Failed to connect");
      setConnecting(false);
      return;
    }
    if (!result.success) {
      setWalletPickError(result.error?.message ?? "Failed to connect");
    } else {
      setWalletModalOpen(false);
    }
    await onResolvedRef.current(result, interactive);
    setConnecting(false);
  }, []);

  // Silently restore whatever wallet the kit already has a persisted session for (from a
  // previous connect, in the kit's own localStorage) — without this, every fresh page load
  // starts fully disconnected and every balance display shows "Connect Wallet" until the user
  // clicks Connect again, even though the extension itself still has an active session.
  // Never pops a signature prompt (interactive=false); if the kit has nothing to restore this
  // is a fast no-op and the user just sees the normal disconnected state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const hasSession = await tryCheckConnection();
      if (cancelled || !hasSession) return;
      try {
        const address = await kitGetAddress();
        const result = await connectWallet(address);
        if (!cancelled) await onResolvedRef.current(result, false);
      } catch {
        // No persisted session, or the kit failed to resolve it — leave disconnected.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Wallet extensions don't push an event when the user switches accounts — poll the kit's
  // in-memory address every few seconds and silently re-resolve the whole wallet state (no new
  // signature popup; `ensureAgentAuth` on the next agents-backend call will re-auth as needed) so
  // the Navbar and every balance display follow the account the extension is actually on.
  useEffect(() => {
    if (!wallet) return;
    const interval = setInterval(async () => {
      let currentAddress: string;
      try {
        currentAddress = await kitGetAddress();
      } catch {
        return;
      }
      if (currentAddress === wallet.address) return;
      const result = await connectWallet(currentAddress).catch(() => null);
      if (result) await onResolvedRef.current(result, false);
    }, 4000);
    return () => clearInterval(interval);
  }, [wallet]);

  const disconnect = useCallback(() => {
    setWallet(null);
    disconnectWallet().catch(() => {});
  }, []);

  useEffect(() => {
    setChecked(true);
  }, []);

  return {
    wallet,
    setWallet,
    walletOwner: wallet?.address ?? null,
    connected: !!wallet,
    connecting,
    checked,
    walletModalOpen,
    walletPickError,
    connect,
    closeWalletModal,
    pickWallet,
    disconnect,
  };
}
