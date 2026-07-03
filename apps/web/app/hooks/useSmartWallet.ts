"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  connectWallet,
  tryCheckConnection,
  fetchSmartWalletBalance,
  signAuthEntryWithFreighter,
  type WalletState,
} from "@/app/lib/stellar";

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
  connect: () => Promise<{ success: boolean; wallet?: WalletState }>;
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
    const prepared = await prepareRes.json();
    if (!prepareRes.ok) throw new Error(prepared.error);

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
    const data = await submitRes.json();
    if (!submitRes.ok) throw new Error(data.error);
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

  const connect = useCallback(async () => {
    setConnecting(true);
    const result = await connectWallet();
    if (result.success && result.wallet) {
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

  const disconnect = useCallback(() => {
    setWallet(null);
    setSmartWalletAddress(null);
    setSmartWalletBalance(null);
    setDeployError(null);
  }, []);

  // Auto-check connection on mount
  useEffect(() => {
    let cancelled = false;
    tryCheckConnection().then(async (ok) => {
      if (ok && !cancelled) await connect();
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
    disconnect,
    deploySmartWallet,
    checkBalance,
  };
}
