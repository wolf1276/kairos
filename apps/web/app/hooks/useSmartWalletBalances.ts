"use client";

import { useCallback, useEffect, useState } from "react";
import { Asset } from "@stellar/stellar-sdk";
import { fetchSmartWalletTokenBalance, TESTNET_USDC_ISSUER } from "@/app/lib/stellar";

export interface SmartWalletBalances {
  xlmBalance: number;
  usdcBalance: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const POLL_MS = 10_000;

/**
 * Reads a smart wallet's (Soroban custom-account contract) token balances via each token's
 * SAC `balance` entrypoint — the only correct way to read a contract address's holdings.
 * Classic Horizon `loadAccount` (as used by `useStellarBalances`) does not work for
 * C-addresses, so this hook is the single source of truth for capital-wallet balances
 * across the app (Overview + Trade pages) instead of each page polling it separately.
 */
export function useSmartWalletBalances(
  address: string | null,
  networkPassphrase: string | null,
  sorobanRpcUrl?: string
): SmartWalletBalances {
  const [xlmBalance, setXlmBalance] = useState(0);
  const [usdcBalance, setUsdcBalance] = useState(0);
  const [loading, setLoading] = useState(address ? true : false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address || !networkPassphrase) return;
    setLoading(true);
    setError(null);
    try {
      const nativeSacId = Asset.native().contractId(networkPassphrase);
      const usdcSacId = new Asset("USDC", TESTNET_USDC_ISSUER).contractId(networkPassphrase);
      const [xlm, usdc] = await Promise.all([
        fetchSmartWalletTokenBalance(address, nativeSacId, networkPassphrase, sorobanRpcUrl),
        fetchSmartWalletTokenBalance(address, usdcSacId, networkPassphrase, sorobanRpcUrl),
      ]);
      setXlmBalance(parseFloat(xlm));
      setUsdcBalance(parseFloat(usdc));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [address, networkPassphrase, sorobanRpcUrl]);

  useEffect(() => {
    if (!address || !networkPassphrase) {
      setXlmBalance(0);
      setUsdcBalance(0);
      return;
    }
    let cancelled = false;
    const load = async () => {
      if (!cancelled) await refresh();
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [address, networkPassphrase, refresh]);

  return { xlmBalance, usdcBalance, loading, error, refresh };
}
