"use client";

import { useCallback, useEffect, useState } from "react";
import {
  connectWallet,
  tryCheckConnection,
  fetchSmartWalletBalance,
  signAuthEntryWithFreighter,
  type WalletState,
} from "@/app/lib/stellar";

const smartWalletStorageKey = (owner: string) => `kairos:smart-wallet:${owner}`;

function loadSmartWallet(owner: string): string | null {
  try {
    return localStorage.getItem(smartWalletStorageKey(owner));
  } catch {
    return null;
  }
}

function saveSmartWallet(owner: string, address: string) {
  try {
    localStorage.setItem(smartWalletStorageKey(owner), address);
  } catch {}
}

export function useWallet() {
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

  const connect = useCallback(async () => {
    setConnecting(true);
    setSmartWalletAddress(null);
    setSmartWalletBalance(null);
    const result = await connectWallet();
    if (result.success && result.wallet) {
      setWallet(result.wallet);
      const saved = loadSmartWallet(result.wallet.address);
      if (saved) {
        setSmartWalletAddress(saved);
        try {
          const balance = await fetchSmartWalletBalance(saved, result.wallet.networkPassphrase, result.wallet.sorobanRpcUrl);
          setSmartWalletBalance(balance);
        } catch {}
      }
    }
    setConnecting(false);
    return result;
  }, []);

  const disconnect = useCallback(() => {
    setWallet(null);
    setSmartWalletAddress(null);
    setSmartWalletBalance(null);
  }, []);

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
        walletOwner
      );

      const submitRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SUBMIT_WALLET_DEPLOY", owner: walletOwner, saltHex: prepared.saltHex, signedEntryXdr }),
      });
      const data = await submitRes.json();
      if (!submitRes.ok) throw new Error(data.error);

      setSmartWalletAddress(data.smartWalletAddress);
      saveSmartWallet(walletOwner, data.smartWalletAddress);
      await checkBalance(data.smartWalletAddress);
    } catch (e) {
      setDeployError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeploying(false);
    }
  }, [walletOwner, wallet, checkBalance]);

  // Auto-check connection on mount
  useEffect(() => {
    let cancelled = false;
    tryCheckConnection().then(async (ok) => {
      if (ok && !cancelled) await connect();
      if (!cancelled) setChecked(true);
    });
    return () => { cancelled = true; };
  }, [connect]);

  return {
    wallet,
    connecting,
    checked,
    walletOwner,
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
