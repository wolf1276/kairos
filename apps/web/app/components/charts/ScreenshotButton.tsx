"use client";

import { useCallback } from "react";
import type { IChartApi } from "lightweight-charts";

export function ScreenshotButton({ chartRef }: { chartRef: React.RefObject<IChartApi | null> }) {
  const takeScreenshot = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    try {
      const canvas = chart.takeScreenshot();
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = `chart-${Date.now()}.png`;
      a.click();
    } catch {}
  }, [chartRef]);

  return (
    <button
      onClick={takeScreenshot}
      className="cursor-pointer rounded-lg px-2 py-1 font-mono text-[10px] text-text-muted transition-colors hover:text-text-secondary hover:bg-bg-card"
      title="Screenshot"
    >
      Screenshot
    </button>
  );
}
