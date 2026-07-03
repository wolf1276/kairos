"use client";

import { useCallback } from "react";
import { useSyncExternalStore } from "react";

export type Interval = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w" | "1M";
export type ChartType = "candlestick" | "line";

export interface IndicatorConfig {
  vwap: boolean;
  ema8: boolean;
  ema21: boolean;
  currentPrice: boolean;
  bb: boolean;
  rsi: boolean;
  macd: boolean;
}

export interface ChartConfig {
  interval: Interval;
  chartType: ChartType;
  indicators: IndicatorConfig;
}

const BINANCE_INTERVAL_MAP: Record<Interval, string> = {
  "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
  "1h": "1h", "4h": "4h", "1d": "1d", "1w": "1w", "1M": "1M",
};

const DEFAULT_CONFIG: ChartConfig = {
  interval: "1h",
  chartType: "candlestick",
  indicators: { vwap: true, ema8: true, ema21: true, currentPrice: true, bb: false, rsi: false, macd: false },
};

const STORAGE_KEY = "kairos:chart-config";

let cachedRaw: string | undefined;
let cachedConfig: ChartConfig | undefined;

function getSnapshot(): ChartConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const rawStr = raw ?? "";
    if (rawStr === cachedRaw && cachedConfig) return cachedConfig;
    cachedRaw = rawStr;
    if (raw) {
      const saved = JSON.parse(raw) as Partial<ChartConfig>;
      cachedConfig = {
        ...DEFAULT_CONFIG,
        ...saved,
        indicators: { ...DEFAULT_CONFIG.indicators, ...(saved.indicators ?? {}) },
      };
    } else {
      cachedConfig = { ...DEFAULT_CONFIG };
    }
    return cachedConfig;
  } catch {
    if (!cachedConfig) cachedConfig = { ...DEFAULT_CONFIG };
    return cachedConfig;
  }
}

function subscribeToStorage(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}

export function useChartConfig() {
  const config = useSyncExternalStore(
    subscribeToStorage,
    getSnapshot,
    () => DEFAULT_CONFIG,
  );

  const write = useCallback((patch: Partial<ChartConfig>) => {
    const prev = getSnapshot();
    const next: ChartConfig = {
      ...prev,
      ...patch,
      indicators: { ...prev.indicators, ...patch.indicators },
    };
    const json = JSON.stringify(next);
    localStorage.setItem(STORAGE_KEY, json);
    cachedRaw = json;
    cachedConfig = next;
    window.dispatchEvent(new Event("storage"));
  }, []);

  const setInterval = useCallback((interval: Interval) => write({ interval }), [write]);
  const setChartType = useCallback((chartType: ChartType) => write({ chartType }), [write]);
  const toggleIndicator = useCallback(
    (key: keyof IndicatorConfig, value?: boolean) => {
      const prev = getSnapshot();
      write({
        indicators: {
          ...prev.indicators,
          [key]: value ?? !prev.indicators[key],
        },
      });
    },
    [write],
  );

  return {
    ...config,
    bi: BINANCE_INTERVAL_MAP[config.interval],
    setInterval,
    setChartType,
    toggleIndicator,
    indicators: config.indicators,
  };
}
