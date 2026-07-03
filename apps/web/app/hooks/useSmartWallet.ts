"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  connectWallet,
  tryCheckConnection,
  fetchSmartWalletBalance,
  signAuthEntryWithFreighter,
  type WalletState,
} from "@/app/lib/stellar";

const LIST_KEY_PREFIX = "kairos:smart-wallets:";
const LEGACY_KEY_PREFIX = "kairos:smart-wallet:"; // pre-multi-wallet single-address format

function loadWallets(owner: string): string[] {
  try {
    const raw = localStorage.getItem(LIST_KEY_PREFIX + owner);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
    // Migrate from the old single-wallet format so existing users don't lose their wallet.
    const legacy = localStorage.getItem(LEGACY_KEY_PREFIX + owner);
    if (legacy) {
      saveWallets(owner, [legacy]);
      return [legacy];
    }
  } catch {
    // fall through
  }
  return [];
}

function saveWallets(owner: string, wallets: string[]) {
  try {
    localStorage.setItem(LIST_KEY_PREFIX + owner, JSON.stringify(wallets));
  } catch {}
}

export interface SmartWalletState {
  wallet: WalletState | null;
  walletOwner: string | null;
  connected: boolean;
  connecting: boolean;
  checked: boolean;
  /** All smart wallets deployed by this owner (delegator candidates). */
  smartWallets: string[];
  /** The first/primary smart wallet — kept for callers that only ever dealt with one. */
  smartWalletAddress: string | null;
  smartWalletBalance: string | null;
  deploying: boolean;
  deployError: string | null;
  connect: () => Promise<{ success: boolean; wallet?: WalletState }>;
  disconnect: () => void;
  /** Deploys a wallet only if this owner doesn't already have one. */
  deploySmartWallet: () => Promise<void>;
  /** Always deploys a brand-new smart wallet and adds it to the list. */
  deployAnotherSmartWallet: () => Promise<string | null>;
  checkBalance: (address: string) => Promise<void>;
}

export function useSmartWallet(): SmartWalletState {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [checked, setChecked] = useState(false);
  const [smartWallets, setSmartWallets] = useState<string[]>([]);
  const [smartWalletBalance, setSmartWalletBalance] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const autoDeployingRef = useRef(false);

  const walletOwner = wallet?.address ?? null;
  const smartWalletAddress = smartWallets[0] ?? null;

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
      const next = [address, ...smartWallets];
      setSmartWallets(next);
      saveWallets(walletOwner, next);
      await checkBalance(address);
    } catch (e) {
      setDeployError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeploying(false);
    }
  }, [walletOwner, wallet, smartWallets, deployWallet, checkBalance]);

  const deployAnotherSmartWallet = useCallback(async (): Promise<string | null> => {
    if (!walletOwner || !wallet) {
      setDeployError("Connect Freighter wallet first");
      return null;
    }
    setDeploying(true);
    setDeployError(null);
    try {
      const address = await deployWallet(walletOwner, wallet);
      const next = [...smartWallets, address];
      setSmartWallets(next);
      saveWallets(walletOwner, next);
      return address;
    } catch (e) {
      setDeployError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setDeploying(false);
    }
  }, [walletOwner, wallet, smartWallets, deployWallet]);

  const connect = useCallback(async () => {
    setConnecting(true);
    const result = await connectWallet();
    if (result.success && result.wallet) {
      setWallet(result.wallet);
      setSmartWallets([]);
      setSmartWalletBalance(null);
      const saved = loadWallets(result.wallet.address);
      if (saved.length > 0) {
        setSmartWallets(saved);
        try {
          const balance = await fetchSmartWalletBalance(
            saved[0],
            result.wallet.networkPassphrase,
            result.wallet.sorobanRpcUrl,
          );
          setSmartWalletBalance(balance);
        } catch {}
      } else {
        // Auto-deploy if no smart wallet found
        autoDeployingRef.current = true;
      }
    }
    setConnecting(false);
    return result;
  }, []);

  const disconnect = useCallback(() => {
    setWallet(null);
    setSmartWallets([]);
    setSmartWalletBalance(null);
    setDeployError(null);
  }, []);

  // Auto-deploy when connect completes and no smart wallet exists
  useEffect(() => {
    if (autoDeployingRef.current && walletOwner && wallet && smartWallets.length === 0 && !deploying) {
      autoDeployingRef.current = false;
      deploySmartWallet();
    }
  }, [walletOwner, wallet, smartWallets, deploying, deploySmartWallet]);

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
    smartWallets,
    smartWalletAddress,
    smartWalletBalance,
    deploying,
    deployError,
    connect,
    disconnect,
    deploySmartWallet,
    deployAnotherSmartWallet,
    checkBalance,
  };
}
