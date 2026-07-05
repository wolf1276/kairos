"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  connectWallet,
  disconnectWallet,
  fetchSmartWalletBalance,
  signAuthEntryWithWallet,
  type WalletState,
} from "@/app/lib/stellar";
import { kitConnectWallet, kitGetAddress } from "@/app/lib/walletKit";
import { challengeAndVerify, getStoredSessionToken } from "@/app/lib/agentsAuth";
import { setAuthToken, listCapitalWallets, registerCapitalWallet } from "@/app/lib/agentsBackend";

export interface CapitalWalletInfo {
  address: string;
  label: string | null;
}

const SELECTED_KEY_PREFIX = "kairos:smart-wallet:"; // pointer to the currently-selected wallet
const LIST_KEY_PREFIX = "kairos:smart-wallets:"; // this owner's full set of capital wallets

function loadWalletList(owner: string): CapitalWalletInfo[] {
  try {
    const raw = localStorage.getItem(LIST_KEY_PREFIX + owner);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
    // Pre-multi-wallet installs only ever stored a single scalar address under the selected key —
    // fold that into a one-item list instead of losing it.
    const legacyScalar = localStorage.getItem(SELECTED_KEY_PREFIX + owner);
    if (legacyScalar) return [{ address: legacyScalar, label: null }];
  } catch {
    // fall through
  }
  return [];
}

function saveWalletList(owner: string, wallets: CapitalWalletInfo[]) {
  try {
    localStorage.setItem(LIST_KEY_PREFIX + owner, JSON.stringify(wallets));
  } catch {}
}

function loadSelected(owner: string): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY_PREFIX + owner);
  } catch {
    return null;
  }
}

function saveSelected(owner: string, address: string) {
  try {
    localStorage.setItem(SELECTED_KEY_PREFIX + owner, address);
  } catch {}
}

export interface SmartWalletState {
  wallet: WalletState | null;
  walletOwner: string | null;
  connected: boolean;
  connecting: boolean;
  checked: boolean;
  /** The currently-selected capital wallet (smart account) agents delegate from by default. */
  smartWalletAddress: string | null;
  smartWalletBalance: string | null;
  /** Every capital wallet this owner has deployed — lets callers offer a picker instead of
   *  always using the single selected one. */
  capitalWallets: CapitalWalletInfo[];
  /** Switches which capital wallet is "selected" (the default for new agent launches). */
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
  /** Deploys a new capital wallet (in addition to any existing ones) and selects it. */
  deploySmartWallet: (label?: string) => Promise<void>;
  checkBalance: (address: string) => Promise<void>;
}

export function useSmartWallet(): SmartWalletState {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [checked, setChecked] = useState(false);
  const [capitalWallets, setCapitalWallets] = useState<CapitalWalletInfo[]>([]);
  const [smartWalletAddress, setSmartWalletAddress] = useState<string | null>(null);
  const [smartWalletBalance, setSmartWalletBalance] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [walletPickError, setWalletPickError] = useState<string | null>(null);
  // `connect(interactive)` just opens the modal; the actual pick happens later (async, after the
  // user clicks a wallet row), so the interactive flag has to be stashed for `pickWallet` to read.
  const interactiveRef = useRef(true);

  const walletOwner = wallet?.address ?? null;

  const checkBalance = useCallback(async (address: string) => {
    if (!wallet) return;
    try {
      const balance = await fetchSmartWalletBalance(address, wallet.networkPassphrase, wallet.sorobanRpcUrl);
      setSmartWalletBalance(balance);
    } catch {}
  }, [wallet]);

  const selectWallet = useCallback((address: string) => {
    if (!walletOwner) return;
    setSmartWalletAddress(address);
    saveSelected(walletOwner, address);
    checkBalance(address);
  }, [walletOwner, checkBalance]);

  const deployWallet = useCallback(async (owner: string, w: WalletState): Promise<string> => {
    const prepareRes = await fetch("/api/delegate-sdk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "PREPARE_WALLET_DEPLOY", owner }),
    });
    if (!prepareRes.ok) {
      const text = await prepareRes.text();
      throw new Error(`PREPARE_WALLET_DEPLOY failed (${prepareRes.status}): ${text.slice(0, 200)}`);
    }
    const prepared = await prepareRes.json();

    const signedEntryXdr = await signAuthEntryWithWallet(
      prepared.unsignedEntryXdr,
      prepared.validUntilLedgerSeq,
      w.networkPassphrase,
      owner,
    );

    const submitRes = await fetch("/api/delegate-sdk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "SUBMIT_WALLET_DEPLOY",
        owner,
        saltHex: prepared.saltHex,
        signedEntryXdr,
      }),
    });
    if (!submitRes.ok) {
      const text = await submitRes.text();
      throw new Error(`SUBMIT_WALLET_DEPLOY failed (${submitRes.status}): ${text.slice(0, 200)}`);
    }
    const data = await submitRes.json();
    return data.smartWalletAddress as string;
  }, []);

  const deploySmartWallet = useCallback(async (label?: string) => {
    if (!walletOwner || !wallet) {
      setDeployError("Connect Freighter wallet first");
      return;
    }
    setDeploying(true);
    setDeployError(null);
    try {
      const address = await deployWallet(walletOwner, wallet);
      const next = [...capitalWallets, { address, label: label ?? null }];
      setCapitalWallets(next);
      saveWalletList(walletOwner, next);
      selectWallet(address);
      // Best-effort — the wallet is already usable locally even if this registration fails
      // (e.g. auth token not ready yet); it'll just be missing from other devices until retried.
      registerCapitalWallet(address, label).catch(() => {});
    } catch (e) {
      setDeployError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeploying(false);
    }
  }, [walletOwner, wallet, deployWallet, capitalWallets, selectWallet]);

  const connect = useCallback((interactive = true) => {
    interactiveRef.current = interactive;
    setWalletPickError(null);
    setWalletModalOpen(true);
  }, []);

  const closeWalletModal = useCallback(() => {
    setWalletModalOpen(false);
  }, []);

  // Applies a resolved wallet (fresh connect, or the same session on a different address after
  // the user switched accounts in their extension) — auth handshake, capital-wallet list, and
  // smart-wallet balance all key off whichever address lands here.
  const applyResolvedWallet = useCallback(async (result: Awaited<ReturnType<typeof connectWallet>>, interactive: boolean) => {
    if (result.success && result.wallet) {
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
      let authed = false;
      const cached = getStoredSessionToken(result.wallet.address);
      if (cached) {
        setAuthToken(cached);
        authed = true;
      } else if (interactive) {
        try {
          const token = await challengeAndVerify(result.wallet.address, result.wallet.networkPassphrase);
          setAuthToken(token);
          authed = true;
        } catch (e) {
          // Agent-backend login is best-effort at connect time — strategy/agent features will
          // surface their own 401 if a call is attempted without a valid session.
          console.error("Agent backend login failed:", e);
        }
      }
      setWallet(result.wallet);
      // Don't clear smartWalletAddress/smartWalletBalance here — the real (usually identical)
      // address is resolved a few lines below, and blanking it first forces every balance
      // display keyed off it (useSmartWalletBalances) to flash to a confident "0" for the
      // duration of the merge/fetch below, which on a slow RPC round-trip reads as "balance
      // became 0 on relogin" even though it's just a stale render, not a real balance.

      const localList = loadWalletList(result.wallet.address);
      // Merge in any wallets registered server-side (e.g. deployed from another browser/device) —
      // best-effort, skipped entirely if we have no session token to call the backend with yet.
      let merged = localList;
      if (authed) {
        try {
          const remote = await listCapitalWallets();
          const byAddress = new Map(localList.map((w) => [w.address, w]));
          for (const r of remote) {
            if (!byAddress.has(r.address)) byAddress.set(r.address, { address: r.address, label: r.label });
          }
          merged = Array.from(byAddress.values());
        } catch {
          // fall back to the local list only
        }
      }
      setCapitalWallets(merged);
      saveWalletList(result.wallet.address, merged);

      const selected = loadSelected(result.wallet.address) ?? merged[0]?.address ?? null;
      setSmartWalletAddress(selected);
      if (selected) {
        try {
          const balance = await fetchSmartWalletBalance(
            selected,
            result.wallet.networkPassphrase,
            result.wallet.sorobanRpcUrl,
          );
          setSmartWalletBalance(balance);
        } catch {}
      } else {
        // No capital wallet found for this owner — leave it undeployed until the user
        // explicitly clicks "Create Capital Wallet".
        setSmartWalletBalance(null);
      }
    }
    setConnecting(false);
  }, []);

  const pickWallet = useCallback(async (walletId: string) => {
    const interactive = interactiveRef.current;
    setConnecting(true);
    setWalletPickError(null);
    let result: Awaited<ReturnType<typeof connectWallet>>;
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
    await applyResolvedWallet(result, interactive);
  }, [applyResolvedWallet]);

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
      if (result) await applyResolvedWallet(result, false);
    }, 4000);
    return () => clearInterval(interval);
  }, [wallet, applyResolvedWallet]);

  // `interactive` (default true) gates the Freighter signature prompt — pass false for
  // background polling. Without this, a poller whose cached token got cleared by a 401
  // (agentsBackend.ts's request() wipes it on any 401) would re-prompt Freighter every single
  // tick forever, including while the tab is backgrounded or the user already dismissed it once.
  const ensureAgentAuth = useCallback(async (interactive = true) => {
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
  }, [wallet]);

  const disconnect = useCallback(() => {
    setWallet(null);
    setSmartWalletAddress(null);
    setSmartWalletBalance(null);
    setCapitalWallets([]);
    setDeployError(null);
    setAuthToken(null);
    disconnectWallet().catch(() => {});
  }, []);

  useEffect(() => {
    setChecked(true);
  }, []);

  return {
    wallet,
    walletOwner,
    connected: !!wallet,
    connecting,
    checked,
    smartWalletAddress,
    smartWalletBalance,
    capitalWallets,
    selectWallet,
    deploying,
    deployError,
    connect,
    walletModalOpen,
    closeWalletModal,
    pickWallet,
    walletPickError,
    ensureAgentAuth,
    disconnect,
    deploySmartWallet,
    checkBalance,
  };
}
