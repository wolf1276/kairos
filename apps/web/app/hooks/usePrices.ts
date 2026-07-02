"use client";

import { useEffect, useMemo, useRef, useState, startTransition } from "react";
import { useBinanceWebSocket, type WSTicker, type WSTickerMap, type WSStatus } from "./useBinanceWebSocket";

export type { WSTicker as Ticker, WSTickerMap as TickerMap, WSStatus };

export function usePrices(symbols: string[], fallbackIntervalMs = 15000) {
  const key = useMemo(() => [...symbols].sort().join(","), [symbols]);
  const { tickers: wsTickers, tickersRef, status: wsStatus } = useBinanceWebSocket(symbols);

  const [tickers, setTickers] = useState<WSTickerMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);
  const initRef = useRef(false);

  const wsConnected = wsStatus === "connected";
  const hasWsData = Object.keys(wsTickers).length > 0;

  // WS data → state (zero delay when connected)
  useEffect(() => {
    if (wsConnected && hasWsData) {
      initRef.current = true;
      startTransition(() => {
        setTickers(wsTickers);
        setError(null);
        setLoading(false);
      });
    }
  }, [wsTickers, wsConnected, hasWsData]);

  // HTTP polling — only when WS is NOT connected
  const shouldHttpPoll = !wsConnected;
  useEffect(() => {
    aliveRef.current = true;
    if (!key) {
      startTransition(() => setLoading(false));
      return;
    }

    const fetchPrices = async () => {
      try {
        const res = await fetch(`/api/prices?symbols=${key}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arr: WSTicker[] = await res.json();
        if (!aliveRef.current) return;
        const map: WSTickerMap = {};
        for (const t of arr) map[t.symbol] = t;
        setTickers(map);
        setError(null);
      } catch (e) {
        if (!aliveRef.current) return;
        if (!initRef.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (aliveRef.current) setLoading(false);
      }
    };

    fetchPrices();
    const id = setInterval(fetchPrices, fallbackIntervalMs);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
  }, [key, fallbackIntervalMs, shouldHttpPoll]);

  const priceMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const [sym, t] of Object.entries(tickers)) m[sym] = t.price;
    return m;
  }, [tickers]);

  const getLatestPrice = (symbol: string): number =>
    tickersRef.current[symbol]?.price ?? tickers[symbol]?.price ?? 0;

  return { tickers, priceMap, loading, error, wsStatus, getLatestPrice };
}
