"use client";

import { useCallback, useEffect, useState } from "react";
import {
  connectWallet,
  tryCheckConnection,
  fetchSmartWalletBalance,
  signAuthEntryWithFreighter,
  type WalletState,
} from "@/app/lib/stellar";
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
  connect: (interactive?: boolean) => Promise<{ success: boolean; wallet?: WalletState }>;
  /** Runs the wallet-sig auth handshake if this address has no cached session yet — call from
   *  pages that actually need agents-backend calls (Trade/Agents/History), not on cold app load. */
  ensureAgentAuth: () => Promise<void>;
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

    const signedEntryXdr = await signAuthEntryWithFreighter(
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

  const connect = useCallback(async (interactive = true) => {
    setConnecting(true);
    const result = await connectWallet();
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
      setSmartWalletAddress(null);
      setSmartWalletBalance(null);

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
      if (selected) {
        setSmartWalletAddress(selected);
        try {
          const balance = await fetchSmartWalletBalance(
            selected,
            result.wallet.networkPassphrase,
            result.wallet.sorobanRpcUrl,
          );
          setSmartWalletBalance(balance);
        } catch {}
      }
      // No capital wallet found — leave it undeployed until the user explicitly
      // clicks "Create Capital Wallet".
    }
    setConnecting(false);
    return result;
  }, []);

  const ensureAgentAuth = useCallback(async () => {
    if (!wallet) return;
    const cached = getStoredSessionToken(wallet.address);
    if (cached) {
      setAuthToken(cached);
      return;
    }
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
  }, []);

  // Auto-check connection on mount
  useEffect(() => {
    let cancelled = false;
    tryCheckConnection().then(async (ok) => {
      if (ok && !cancelled) await connect(false);
      if (!cancelled) setChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [connect]);

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
    ensureAgentAuth,
    disconnect,
    deploySmartWallet,
    checkBalance,
  };
}
