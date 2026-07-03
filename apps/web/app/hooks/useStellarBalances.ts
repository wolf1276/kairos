"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchAccountBalances,
  TESTNET_USDC_ISSUER,
} from "@/app/lib/stellar";

export interface StellarBalances {
  xlmBalance: number;
  usdcBalance: number;
  hasUsdcTrustline: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const POLL_MS = 10_000;

export function useStellarBalances(
  address: string | null,
  networkPassphrase: string | null,
): StellarBalances {
  const [xlmBalance, setXlmBalance] = useState(0);
  const [usdcBalance, setUsdcBalance] = useState(0);
  const [hasUsdcTrustline, setHasUsdcTrustline] = useState(false);
  const [loading, setLoading] = useState(address ? true : false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address || !networkPassphrase) return;
    setError(null);
    try {
      const balances = await fetchAccountBalances(address, networkPassphrase);
      const xlm = balances.find((b) => b.code === "XLM");
      const usdc = balances.find(
        (b) => b.code === "USDC" && b.issuer === TESTNET_USDC_ISSUER,
      );
      setXlmBalance(xlm ? parseFloat(xlm.balance) : 0);
      setUsdcBalance(usdc ? parseFloat(usdc.balance) : 0);
      setHasUsdcTrustline(!!usdc);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [address, networkPassphrase]);

  useEffect(() => {
    if (!address || !networkPassphrase) return;
    const load = async () => {
      await refresh();
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [address, networkPassphrase, refresh]);

  return { xlmBalance, usdcBalance, hasUsdcTrustline, loading, error, refresh };
}
