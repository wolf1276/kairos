"use client";

import { useEffect, useRef, useState } from "react";

export interface OrderBookLevel {
  price: number;
  size: number;
  total: number;
}

interface DepthData {
  bids: [string, string][];
  asks: [string, string][];
}

const WS_BASE = "wss://stream.binance.com:9443/stream";
const MAX_RECONNECT_DELAY = 30000;
const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_ATTEMPTS = 5;

export function useOrderBook(symbol: string | null) {
  const [bids, setBids] = useState<OrderBookLevel[]>([]);
  const [asks, setAsks] = useState<OrderBookLevel[]>([]);
  const [connected, setConnected] = useState(false);

  const bidsRef = useRef<OrderBookLevel[]>([]);
  const asksRef = useRef<OrderBookLevel[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const aliveRef = useRef(true);
  const rafRef = useRef(0);
  const connectIdRef = useRef(0);
  const dirtyRef = useRef(false);

  const cleanup = () => {
    clearTimeout(reconnectTimerRef.current);
    wsRef.current?.close();
    wsRef.current = null;
  };

  useEffect(() => {
    if (!symbol) return;

    aliveRef.current = true;
    const stream = `${symbol.toLowerCase()}@depth20@100ms`;

    function connect() {
      cleanup();
      if (!aliveRef.current) return;

      connectIdRef.current++;
      const connectId = connectIdRef.current;
      const url = `${WS_BASE}?streams=${stream}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (connectId !== connectIdRef.current || !aliveRef.current) {
          ws.close();
          return;
        }
        reconnectCountRef.current = 0;
        setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (!msg.stream || !msg.data) return;
          const depth = msg.data as DepthData;
          if (!depth.bids || !depth.asks) return;

          let bidTotal = 0;
          bidsRef.current = depth.bids
            .map(([price, size]) => {
              const s = parseFloat(size);
              bidTotal += s;
              return { price: parseFloat(price), size: s, total: bidTotal };
            })
            .filter((l) => l.size > 0);

          let askTotal = 0;
          asksRef.current = depth.asks
            .map(([price, size]) => {
              const s = parseFloat(size);
              askTotal += s;
              return { price: parseFloat(price), size: s, total: askTotal };
            })
            .filter((l) => l.size > 0);

          dirtyRef.current = true;
        } catch {}
      };

      ws.onclose = () => {
        setConnected(false);
        if (connectId !== connectIdRef.current || !aliveRef.current) return;
        reconnectCountRef.current++;
        if (reconnectCountRef.current >= MAX_RECONNECT_ATTEMPTS) return;
        const delay = Math.min(
          INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectCountRef.current - 1),
          MAX_RECONNECT_DELAY,
        );
        reconnectTimerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();
    }

    connect();

    const loop = () => {
      if (dirtyRef.current) {
        dirtyRef.current = false;
        setBids(bidsRef.current);
        setAsks(asksRef.current);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      aliveRef.current = false;
      cleanup();
      cancelAnimationFrame(rafRef.current);
      setConnected(false);
    };
  }, [symbol]);

  return { bids, asks, connected };
}
