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
import { setAuthToken } from "@/app/lib/agentsBackend";

const KEY_PREFIX = "kairos:smart-wallet:";
const LEGACY_LIST_KEY_PREFIX = "kairos:smart-wallets:"; // pre-single-capital-wallet array format

function loadWallet(owner: string): string | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + owner);
    if (raw) return raw;
    // Migrate from the old multi-wallet array format — keep only the first (primary) one.
    const legacy = localStorage.getItem(LEGACY_LIST_KEY_PREFIX + owner);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (Array.isArray(parsed) && parsed[0]) {
        saveWallet(owner, parsed[0]);
        return parsed[0];
      }
    }
  } catch {
    // fall through
  }
  return null;
}

function saveWallet(owner: string, address: string) {
  try {
    localStorage.setItem(KEY_PREFIX + owner, address);
  } catch {}
}

export interface SmartWalletState {
  wallet: WalletState | null;
  walletOwner: string | null;
  connected: boolean;
  connecting: boolean;
  checked: boolean;
  /** The single capital wallet (smart account) agents delegate from. */
  smartWalletAddress: string | null;
  smartWalletBalance: string | null;
  deploying: boolean;
  deployError: string | null;
  connect: (interactive?: boolean) => Promise<{ success: boolean; wallet?: WalletState }>;
  /** Runs the wallet-sig auth handshake if this address has no cached session yet — call from
   *  pages that actually need agents-backend calls (Trade/Agents/History), not on cold app load. */
  ensureAgentAuth: () => Promise<void>;
  disconnect: () => void;
  /** Deploys the capital wallet only if this owner doesn't already have one. */
  deploySmartWallet: () => Promise<void>;
  checkBalance: (address: string) => Promise<void>;
}

export function useSmartWallet(): SmartWalletState {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [checked, setChecked] = useState(false);
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

  const deploySmartWallet = useCallback(async () => {
    if (!walletOwner || !wallet) {
      setDeployError("Connect Freighter wallet first");
      return;
    }
    setDeploying(true);
    setDeployError(null);
    try {
      const address = await deployWallet(walletOwner, wallet);
      setSmartWalletAddress(address);
      saveWallet(walletOwner, address);
      await checkBalance(address);
    } catch (e) {
      setDeployError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeploying(false);
    }
  }, [walletOwner, wallet, deployWallet, checkBalance]);

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
      const cached = getStoredSessionToken(result.wallet.address);
      if (cached) {
        setAuthToken(cached);
      } else if (interactive) {
        try {
          const token = await challengeAndVerify(result.wallet.address, result.wallet.networkPassphrase);
          setAuthToken(token);
        } catch (e) {
          // Agent-backend login is best-effort at connect time — strategy/agent features will
          // surface their own 401 if a call is attempted without a valid session.
          console.error("Agent backend login failed:", e);
        }
      }
      setWallet(result.wallet);
      setSmartWalletAddress(null);
      setSmartWalletBalance(null);
      const saved = loadWallet(result.wallet.address);
      if (saved) {
        setSmartWalletAddress(saved);
        try {
          const balance = await fetchSmartWalletBalance(
            saved,
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
    deploying,
    deployError,
    connect,
    ensureAgentAuth,
    disconnect,
    deploySmartWallet,
    checkBalance,
  };
}
