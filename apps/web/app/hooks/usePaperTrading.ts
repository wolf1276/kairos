"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PaperTradingEngine } from "@/lib/paper-trading";
import type { Trade, Position } from "@/lib/paper-trading";

// The engine persists to localStorage, so it MUST run in the browser.
// (The /api/* trade routes construct it server-side where there is no
// localStorage, so they never persist — this hook is the source of truth.)

const SYNC_EVENT = "kairos:paper-changed";

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SYNC_EVENT));
}

export interface PricedPosition extends Position {
  currentPrice: number;
  value: number;
  pnl: number;
  pnlPct: number;
}

interface RawSnapshot {
  balance: number;
  positions: Position[];
  trades: Trade[];
}

/**
 * Client-side paper-trading state. Pass a live `prices` map to get
 * mark-to-market position values, unrealized PnL and portfolio value.
 */
export function usePaperTrading(prices: Record<string, number> = {}) {
  const [snapshot, setSnapshot] = useState<RawSnapshot | null>(null);

  const reload = useCallback(() => {
    const engine = new PaperTradingEngine();
    const p = engine.getPortfolio();
    setSnapshot({
      balance: p.balance,
      positions: p.positions,
      trades: engine.getTradeHistory(),
    });
  }, []);

  useEffect(() => {
    // Initial read + subscribe to the external localStorage-backed store.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
    const handler = () => reload();
    window.addEventListener(SYNC_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(SYNC_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, [reload]);

  const buy = useCallback((symbol: string, amount: number, price: number): Trade => {
    const t = new PaperTradingEngine().buy(symbol, amount, price);
    notify();
    return t;
  }, []);

  const sell = useCallback((symbol: string, amount: number, price: number): Trade => {
    const t = new PaperTradingEngine().sell(symbol, amount, price);
    notify();
    return t;
  }, []);

  const closePosition = useCallback((symbol: string, price: number): Trade => {
    const t = new PaperTradingEngine().closePosition(symbol, price);
    notify();
    return t;
  }, []);

  const reset = useCallback((initialBalance = 10000) => {
    const engine = new PaperTradingEngine();
    engine.reset();
    engine.setBalance(initialBalance);
    notify();
  }, []);

  const balance = snapshot?.balance ?? 10000;

  const positions = useMemo<PricedPosition[]>(() => {
    return (snapshot?.positions ?? []).map((pos) => {
      const currentPrice = prices[pos.symbol] ?? pos.entryPrice;
      const value = pos.amount * currentPrice;
      const pnl = pos.amount * (currentPrice - pos.entryPrice);
      const pnlPct = pos.entryPrice
        ? ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100
        : 0;
      return { ...pos, currentPrice, value, pnl, pnlPct };
    });
  }, [snapshot?.positions, prices]);

  const positionsValue = positions.reduce((s, p) => s + p.value, 0);
  const unrealizedPnL = positions.reduce((s, p) => s + p.pnl, 0);
  const totalValue = balance + positionsValue;

  return {
    ready: snapshot !== null,
    balance,
    positions,
    trades: snapshot?.trades ?? [],
    positionsValue,
    unrealizedPnL,
    totalValue,
    buy,
    sell,
    closePosition,
    reset,
    reload,
  };
}
