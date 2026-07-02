"use client";

import { useMemo } from "react";
import type { Candle } from "@/app/hooks/useStreamingKlines";

export function MiniChart({ candles }: { candles: Candle[] }) {
  const pathData = useMemo(() => {
    if (candles.length < 2) return null;
    const closes = candles.map((c) => c.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const range = max - min || 1;
    const w = 120;
    const h = 40;
    const pad = 2;
    const points = closes.map((v, i) => {
      const x = pad + (i / (closes.length - 1)) * (w - 2 * pad);
      const y = pad + ((max - v) / range) * (h - 2 * pad);
      return `${x},${y}`;
    });
    return { points: points.join(" "), w, h };
  }, [candles]);

  if (!pathData) {
    return (
      <div className="flex h-10 w-[120px] items-center justify-center">
        <span className="font-mono text-[9px] text-text-muted">\u2014</span>
      </div>
    );
  }

  return (
    <svg width={pathData.w} height={pathData.h} className="shrink-0">
      <polyline
        points={pathData.points}
        fill="none"
        stroke="#38bdf8"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
