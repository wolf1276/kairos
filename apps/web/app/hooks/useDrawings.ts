"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Drawing } from "@/app/components/charts/drawing-tools/types";

const STORAGE_PREFIX = "kairos:drawings:";

function getKey(symbol: string) {
  return `${STORAGE_PREFIX}${symbol}`;
}

let cachedRaw: string | undefined;
let cachedDrawings: Drawing[] | undefined;
const EMPTY_DRAWINGS: Drawing[] = [];

function getSnapshot(symbol: string): () => Drawing[] {
  return () => {
    try {
      const raw = localStorage.getItem(getKey(symbol));
      const rawStr = raw ?? "";
      if (rawStr === cachedRaw && cachedDrawings) return cachedDrawings;
      cachedRaw = rawStr;
      cachedDrawings = raw ? (JSON.parse(raw) as Drawing[]) : [];
      return cachedDrawings;
    } catch {
      cachedDrawings = [];
      return cachedDrawings;
    }
  };
}

function subscribe(symbol: string) {
  return (cb: () => void) => {
    const handler = (e: StorageEvent) => {
      if (e.key === getKey(symbol)) cb();
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  };
}

export function useDrawings(symbol: string) {
  const snap = getSnapshot(symbol);
  const sub = subscribe(symbol);
  const getServerSnapshot = useCallback(() => EMPTY_DRAWINGS, []);

  const drawings = useSyncExternalStore(sub, snap, getServerSnapshot);

  const save = useCallback(
    (d: Drawing[]) => {
      const json = JSON.stringify(d);
      localStorage.setItem(getKey(symbol), json);
      cachedRaw = json;
      cachedDrawings = d;
      window.dispatchEvent(new Event("storage"));
    },
    [symbol],
  );

  return { drawings, save };
}
