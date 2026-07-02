"use client";

import { useMemo } from "react";
import type { Candle } from "./useStreamingKlines";

export interface MarketAnalysis {
  vwap: number;
  volatility: number;
  avgSpread: number;
  avgVolume: number;
  trend: "up" | "down" | "sideways";
  momentum: number;
  risk: "low" | "medium" | "high";
  liquidity: "low" | "medium" | "high";
  confidence: number;
  summary: string;
}

function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

export function useMarketAnalysis(
  candles: Candle[],
  price?: number
): MarketAnalysis {
  return useMemo(() => {
    if (candles.length < 5) {
      return {
        vwap: 0,
        volatility: 0,
        avgSpread: 0,
        avgVolume: 0,
        trend: "sideways",
        momentum: 0,
        risk: "medium",
        liquidity: "low",
        confidence: 50,
        summary: "Gathering enough data…",
      };
    }

    const n = candles.length;
    const closes = candles.map((c) => c.close);
    const volumes = candles.map((c) => c.volume);

    // VWAP
    let pv = 0,
      tv = 0;
    for (const c of candles) {
      const tp = (c.high + c.low + c.close) / 3;
      pv += tp * c.volume;
      tv += c.volume;
    }
    const vwap = tv > 0 ? pv / tv : 0;

    // Volatility — std dev of % returns
    const returns: number[] = [];
    for (let i = 1; i < n; i++) {
      if (closes[i - 1] > 0) returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
    const rMean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - rMean) ** 2, 0) / returns.length;
    const volatility = Math.sqrt(variance);

    // Avg spread
    const spreads = candles.map((c) => (c.high > 0 ? (c.high - c.low) / c.close : 0));
    const avgSpread = spreads.reduce((a, b) => a + b, 0) / spreads.length;

    // Avg volume
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / n;

    // Trend — short vs long EMA
    const shortP = Math.min(8, Math.max(2, Math.floor(n / 2)));
    const longP = Math.min(21, n - 1);
    const sEma = ema(closes, shortP);
    const lEma = ema(closes, longP);
    const trend = sEma > lEma * 1.002 ? "up" : sEma < lEma * 0.998 ? "down" : "sideways";

    // Momentum — ROC
    const lb = Math.min(14, closes.length - 1);
    const prev = closes[closes.length - 1 - lb];
    const momentum =
      closes[closes.length - 1] > 0 && prev > 0
        ? ((closes[closes.length - 1] - prev) / prev) * 100
        : 0;

    // Risk
    const risk = volatility > 0.03 ? "high" : volatility > 0.012 ? "medium" : "low";

    // Liquidity — coefficient of variation of volume
    const volStd = Math.sqrt(
      volumes.reduce((a, b) => a + (b - avgVolume) ** 2, 0) / volumes.length
    );
    const volCv = avgVolume > 0 ? volStd / avgVolume : 1;
    const liquidity = volCv < 0.5 ? "high" : volCv < 1 ? "medium" : "low";

    // Confidence 0-100
    let c = 50;
    if (trend === "up") c += 15;
    else if (trend === "down") c -= 15;
    if (volatility < 0.012) c += 10;
    else if (volatility > 0.03) c -= 10;
    if (liquidity === "high") c += 10;
    else if (liquidity === "low") c -= 5;
    if (avgSpread < 0.004) c += 5;
    if (momentum > 2) c += 10;
    else if (momentum < -2) c -= 10;
    if (price && vwap > 0) {
      const dist = Math.abs(price - vwap) / vwap;
      if (dist < 0.01) c += 10;
      else if (dist < 0.03) c += 5;
      else if (dist > 0.05) c -= 5;
    }
    c = Math.max(0, Math.min(100, c));

    const lastR = returns.length > 0 ? returns[returns.length - 1] : 0;
    const dir =
      trend === "up" ? "Bullish" : trend === "down" ? "Bearish" : "Neutral";
    const volPct = `${(volatility * 100).toFixed(1)}%`;
    const summary = `${dir} momentum${Math.abs(momentum) > 1 ? ` (${momentum > 0 ? "+" : ""}${momentum.toFixed(1)}% ROC)` : ""} · ${risk.toUpperCase()} risk · ${liquidity.toUpperCase()} liq · ${volPct} vol${lastR > 0 ? " · closing strong" : lastR < -0.01 ? " · closing weak" : ""}`;

    return {
      vwap,
      volatility,
      avgSpread,
      avgVolume,
      trend,
      momentum,
      risk,
      liquidity,
      confidence: c,
      summary,
    };
  }, [candles, price]);
}
