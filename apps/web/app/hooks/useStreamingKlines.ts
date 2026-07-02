"use client";

import { useEffect, useRef, useState } from "react";
import { fetchCandlesGQL, type GQLCandle } from "@/app/lib/graphql/client";

export type Candle = GQLCandle;

type RawKline = [number, string, string, string, string, string, number];

const BINANCE_CDN = "https://data-api.binance.vision";
const BINANCE_API = "https://api.binance.com";

async function fetchKlinesHTTP(
  symbol: string,
  interval: string,
  limit: number,
): Promise<Candle[]> {
  const params = `symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
  let res: Response;
  try {
    res = await fetch(`${BINANCE_CDN}/api/v3/klines?${params}`);
    if (!res.ok) throw new Error(`CDN klines: HTTP ${res.status}`);
  } catch {
    res = await fetch(`${BINANCE_API}/api/v3/klines?${params}`);
    if (!res.ok) throw new Error(`Binance API klines: HTTP ${res.status}`);
  }
  const raw: RawKline[] = await res.json();
  return raw.map((c) => ({
    openTime: c[0],
    open: parseFloat(c[1]),
    high: parseFloat(c[2]),
    low: parseFloat(c[3]),
    close: parseFloat(c[4]),
    volume: parseFloat(c[5]),
    closeTime: c[6],
  }));
}

interface BinanceKlineData {
  e: "kline";
  E: number;
  s: string;
  k: {
    t: number;
    T: number;
    s: string;
    i: string;
    o: string;
    c: string;
    h: string;
    l: string;
    v: string;
    n: number;
    x: boolean;
    q: string;
    V: string;
    Q: string;
  };
}

export function useStreamingKlines(symbol: string, interval: string) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const candlesRef = useRef<Candle[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnectCountRef = useRef(0);
  const aliveRef = useRef(true);
  const throttleRef = useRef(0);

  // Initial fetch — direct Binance CDN first, fall back to GraphQL
  useEffect(() => {
    if (!symbol || !interval) return;
    let alive = true;

    const fetchInitial = async () => {
      setLoading(true);
      setError(null);
      try {
        try {
          const data = await fetchKlinesHTTP(symbol, interval, 120);
          if (alive) {
            candlesRef.current = data;
            setCandles(data);
            setLoading(false);
          }
          return;
        } catch {}
        const data = await fetchCandlesGQL(symbol, interval, 120);
        if (alive) {
          candlesRef.current = data;
          setCandles(data);
          setLoading(false);
        }
      } catch (e) {
        if (alive) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    };

    fetchInitial();
    return () => { alive = false; };
  }, [symbol, interval]);

  // WebSocket for live kline updates
  useEffect(() => {
    if (!symbol || !interval) return;
    aliveRef.current = true;
    reconnectCountRef.current = 0;

    const connect = () => {
      if (!aliveRef.current) return;

      const stream = `${symbol.toLowerCase()}@kline_${interval}`;
      const url = `wss://stream.binance.com:9443/ws/${stream}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!aliveRef.current) { ws.close(); return; }
        reconnectCountRef.current = 0;
        setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.e !== "kline" || !msg.k) return;

          const k: BinanceKlineData["k"] = msg.k;

          const updated: Candle = {
            openTime: k.t,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
            closeTime: k.T,
          };

          const arr = candlesRef.current;
          const last = arr[arr.length - 1];

          if (last && updated.openTime === last.openTime) {
            // ── Same candle — update in place (no array copy) ──
            if (
              last.open === updated.open &&
              last.high === updated.high &&
              last.low === updated.low &&
              last.close === updated.close &&
              last.volume === updated.volume
            ) return; // no-op: data unchanged
            candlesRef.current = [...arr.slice(0, -1), updated];
          } else {
            // ── New candle (closed or forming) — always track it ──
            candlesRef.current = [...arr, updated];
            if (candlesRef.current.length > 120) candlesRef.current.shift();
          }

          // RAF-throttle React state update
          const now = performance.now();
          if (now - throttleRef.current >= 100) {
            throttleRef.current = now;
            setCandles(candlesRef.current);
          }
        } catch {}
      };

      ws.onclose = () => {
        setConnected(false);
        if (!aliveRef.current) return;
        reconnectCountRef.current++;
        const delay = Math.min(
          1000 * Math.pow(2, reconnectCountRef.current - 1),
          30000
        );
        reconnectTimerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      aliveRef.current = false;
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [symbol, interval]);

  // HTTP polling fallback — every 30s when WS is not connected
  useEffect(() => {
    if (!symbol || !interval || connected) return;
    let alive = true;

    const fetchCandles = async () => {
      try {
        try {
          const data = await fetchKlinesHTTP(symbol, interval, 120);
          if (!alive) return;
          candlesRef.current = data;
          setCandles(data);
          setError(null);
          return;
        } catch {}
        const data = await fetchCandlesGQL(symbol, interval, 120);
        if (!alive) return;
        candlesRef.current = data;
        setCandles(data);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    };

    const id = setInterval(fetchCandles, 30000);
    return () => { alive = false; clearInterval(id); };
  }, [symbol, interval, connected]);

  return { candles, loading, error, connected };
}
