"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface Ticker {
  symbol: string;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
}

export type TickerMap = Record<string, Ticker>;

/**
 * Polls /api/prices for live 24h ticker data.
 * Returns a symbol→Ticker map plus loading/error state.
 */
export function usePrices(symbols: string[], intervalMs = 15000) {
  const [tickers, setTickers] = useState<TickerMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const key = useMemo(() => [...symbols].sort().join(","), [symbols]);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    if (!key) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }

    const fetchPrices = async () => {
      try {
        const res = await fetch(`/api/prices?symbols=${key}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arr: Ticker[] = await res.json();
        if (!aliveRef.current) return;
        const map: TickerMap = {};
        for (const t of arr) map[t.symbol] = t;
        setTickers(map);
        setError(null);
      } catch (e) {
        if (!aliveRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (aliveRef.current) setLoading(false);
      }
    };

    fetchPrices();
    const id = setInterval(fetchPrices, intervalMs);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
  }, [key, intervalMs]);

  // Convenience: plain symbol→price map for the paper-trading engine.
  const priceMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const [sym, t] of Object.entries(tickers)) m[sym] = t.price;
    return m;
  }, [tickers]);

  return { tickers, priceMap, loading, error };
}
