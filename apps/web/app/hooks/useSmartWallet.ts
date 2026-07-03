"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  connectWallet,
  tryCheckConnection,
  fetchSmartWalletBalance,
  signAuthEntryWithFreighter,
  type WalletState,
} from "@/app/lib/stellar";

const STORAGE_KEY_PREFIX = "kairos:smart-wallet:";

function loadAddress(owner: string): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_PREFIX + owner);
  } catch {
    return null;
  }
}

function saveAddress(owner: string, address: string) {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + owner, address);
  } catch {}
}

export interface SmartWalletState {
  wallet: WalletState | null;
  walletOwner: string | null;
  connected: boolean;
  connecting: boolean;
  checked: boolean;
  smartWalletAddress: string | null;
  smartWalletBalance: string | null;
  deploying: boolean;
  deployError: string | null;
  connect: () => Promise<{ success: boolean; wallet?: WalletState }>;
  disconnect: () => void;
  deploySmartWallet: () => Promise<void>;
}

export function useSmartWallet(): SmartWalletState {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [checked, setChecked] = useState(false);
  const [smartWalletAddress, setSmartWalletAddress] = useState<string | null>(null);
  const [smartWalletBalance, setSmartWalletBalance] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const autoDeployingRef = useRef(false);

  const walletOwner = wallet?.address ?? null;

  const checkBalance = useCallback(async (address: string) => {
    if (!wallet) return;
    try {
      const balance = await fetchSmartWalletBalance(
        address,
        wallet.networkPassphrase,
        wallet.sorobanRpcUrl,
      );
      setSmartWalletBalance(balance);
    } catch {}
  }, [wallet]);

  const deploySmartWallet = useCallback(async () => {
    if (!walletOwner || !wallet) {
      setDeployError("Connect Freighter wallet first");
      return;
    }
    setDeploying(true);
    setDeployError(null);
    try {
      const prepareRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "PREPARE_WALLET_DEPLOY", owner: walletOwner }),
      });
      const prepared = await prepareRes.json();
      if (!prepareRes.ok) throw new Error(prepared.error);

      const signedEntryXdr = await signAuthEntryWithFreighter(
        prepared.unsignedEntryXdr,
        prepared.validUntilLedgerSeq,
        wallet.networkPassphrase,
        walletOwner,
      );

      const submitRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SUBMIT_WALLET_DEPLOY",
          owner: walletOwner,
          saltHex: prepared.saltHex,
          signedEntryXdr,
        }),
      });
      const data = await submitRes.json();
      if (!submitRes.ok) throw new Error(data.error);

      setSmartWalletAddress(data.smartWalletAddress);
      saveAddress(walletOwner, data.smartWalletAddress);
      await checkBalance(data.smartWalletAddress);
    } catch (e) {
      setDeployError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeploying(false);
    }
  }, [walletOwner, wallet, checkBalance]);

  const connect = useCallback(async () => {
    setConnecting(true);
    const result = await connectWallet();
    if (result.success && result.wallet) {
      setWallet(result.wallet);
      setSmartWalletAddress(null);
      setSmartWalletBalance(null);
      const saved = loadAddress(result.wallet.address);
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
    setSmartWalletAddress(null);
    setSmartWalletBalance(null);
    setDeployError(null);
  }, []);

  // Auto-deploy when connect completes and no smart wallet exists
  useEffect(() => {
    if (autoDeployingRef.current && walletOwner && wallet && !smartWalletAddress && !deploying) {
      autoDeployingRef.current = false;
      deploySmartWallet();
    }
  }, [walletOwner, wallet, smartWalletAddress, deploying, deploySmartWallet]);

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
  };
}
