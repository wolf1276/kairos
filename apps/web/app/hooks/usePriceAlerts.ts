"use client";

import { useState, useCallback } from "react";

export interface PriceAlert {
  id: string;
  symbol: string;
  targetPrice: number;
  direction: "above" | "below";
  triggered: boolean;
  createdAt: number;
}

const STORAGE_KEY = "kairos:price-alerts";

function loadAlerts(): PriceAlert[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveAlerts(alerts: PriceAlert[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
  } catch {}
}

export function usePriceAlerts() {
  const [alerts, setAlerts] = useState<PriceAlert[]>(() => loadAlerts());

  const addAlert = useCallback((symbol: string, targetPrice: number, direction: "above" | "below") => {
    setAlerts((prev) => {
      const next: PriceAlert = {
        id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        symbol: symbol.toUpperCase(),
        targetPrice,
        direction,
        triggered: false,
        createdAt: Date.now(),
      };
      const updated = [...prev, next];
      saveAlerts(updated);
      return updated;
    });
  }, []);

  const removeAlert = useCallback((id: string) => {
    setAlerts((prev) => {
      const updated = prev.filter((a) => a.id !== id);
      saveAlerts(updated);
      return updated;
    });
  }, []);

  const clearTriggered = useCallback(() => {
    setAlerts((prev) => {
      const updated = prev.filter((a) => !a.triggered);
      saveAlerts(updated);
      return updated;
    });
  }, []);

  const checkAlerts = useCallback(
    (prices: Record<string, number>) => {
      setAlerts((prev) => {
        let changed = false;
        const updated = prev.map((a) => {
          if (a.triggered) return a;
          const currentPrice = prices[a.symbol];
          if (currentPrice == null) return a;
          const shouldTrigger =
            a.direction === "above" ? currentPrice >= a.targetPrice : currentPrice <= a.targetPrice;
          if (shouldTrigger) {
            changed = true;
            if (typeof window !== "undefined" && Notification.permission === "granted") {
              new Notification(`Price Alert: ${a.symbol}`, {
                body: `${a.symbol} is ${a.direction === "above" ? "above" : "below"} $${a.targetPrice.toFixed(2)} (current: $${currentPrice.toFixed(2)})`,
              });
            }
            return { ...a, triggered: true };
          }
          return a;
        });
        if (changed) saveAlerts(updated);
        return updated;
      });
    },
    [],
  );

  return { alerts, addAlert, removeAlert, clearTriggered, checkAlerts };
}
