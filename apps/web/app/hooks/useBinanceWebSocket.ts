"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export interface WSTicker {
  symbol: string;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  eventTime: number;
}

export type WSTickerMap = Record<string, WSTicker>;
export type WSStatus = "connected" | "connecting" | "reconnecting" | "disconnected";

const WS_BASE = "wss://stream.binance.com:9443/stream";
const MAX_RECONNECT_DELAY = 30000;
const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_ATTEMPTS = 5;
const PING_INTERVAL = 180000;

interface BinanceTickerData {
  e: "24hrTicker";
  E: number;
  s: string;
  c: string;
  h: string;
  l: string;
  v: string;
  P: string;
}

interface BinanceStreamMsg {
  stream: string;
  data: BinanceTickerData;
}

interface BinancePongMsg {
  method: "pong";
}

type WSMessage = BinanceStreamMsg | BinancePongMsg;

export function useBinanceWebSocket(symbols: string[]) {
  const key = [...symbols].sort().join(",").toLowerCase();
  const [tickers, setTickers] = useState<WSTickerMap>({});
  const [status, setStatus] = useState<WSStatus>("disconnected");

  const tickersRef = useRef<WSTickerMap>({});
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const aliveRef = useRef(true);
  const throttleRef = useRef(0);
  const rafRef = useRef(0);

  const streams = symbols.map((s) => `${s.toLowerCase()}@ticker`).join("/");

  const cleanup = useCallback(() => {
    clearTimeout(reconnectTimerRef.current);
    clearInterval(pingTimerRef.current);
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  const connect = useCallback(() => {
    cleanup();
    if (!aliveRef.current || !streams) return;

    setStatus(reconnectCountRef.current > 0 ? "reconnecting" : "connecting");

    const url = `${WS_BASE}?streams=${streams}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!aliveRef.current) { ws.close(); return; }
      reconnectCountRef.current = 0;
      setStatus("connected");

      pingTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ method: "ping" }));
        }
      }, PING_INTERVAL);
    };

    ws.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data);
        if ((msg as BinancePongMsg).method === "pong") return;

        const streamMsg = msg as BinanceStreamMsg;
        if (!streamMsg.stream || !streamMsg.data) return;

        const d = streamMsg.data;
        const sym = d.s;
        if (!sym) return;

        tickersRef.current[sym] = {
          symbol: sym,
          price: parseFloat(d.c),
          change24h: parseFloat(d.P),
          high24h: parseFloat(d.h),
          low24h: parseFloat(d.l),
          volume24h: parseFloat(d.v),
          eventTime: d.E,
        };
      } catch {}
    };

    ws.onclose = () => {
      clearInterval(pingTimerRef.current);
      if (!aliveRef.current) return;
      setStatus("reconnecting");
      handleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [streams, cleanup]);

  const handleReconnect = useCallback(() => {
    if (!aliveRef.current) return;
    if (reconnectCountRef.current >= MAX_RECONNECT_ATTEMPTS) {
      setStatus("disconnected");
      return;
    }
    reconnectCountRef.current++;
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectCountRef.current - 1),
      MAX_RECONNECT_DELAY
    );
    reconnectTimerRef.current = setTimeout(connect, delay);
  }, [connect]);

  useEffect(() => {
    if (!key) return;
    aliveRef.current = true;
    connect();
    return () => {
      aliveRef.current = false;
      cleanup();
      cancelAnimationFrame(rafRef.current);
    };
  }, [key, connect, cleanup]);

  useEffect(() => {
    let lastGen = 0;
    const loop = (now: number) => {
      if (now - throttleRef.current >= 100) {
        const ref = tickersRef.current;
        let gen = 0;
        for (const _ in ref) gen++;
        if (gen !== lastGen || (gen > 0 && ref[Object.keys(ref)[0]]?.price !== undefined)) {
          lastGen = gen;
          setTickers({ ...ref });
          throttleRef.current = now;
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [key]);

  return { tickers, tickersRef, status };
}
