"use client";

import { memo, useEffect, useRef, useState } from "react";
import { createChart, ColorType, IChartApi, Time, UTCTimestamp, LineSeries } from "lightweight-charts";
import { cn } from "@/lib/utils";

type Range = "1D" | "7D" | "30D" | "90D" | "1Y" | "ALL";

interface PerformanceChartProps {
  data: { time: Time; value: number }[];
  delegatedData?: { time: Time; value: number }[];
  benchmarkData?: { time: Time; value: number }[];
  height?: number;
}

export function PerformanceChart({
  data,
  delegatedData,
  benchmarkData,
  height = 320,
}: PerformanceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [range, setRange] = useState<Range>("ALL");

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#5c5c62",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.03)" },
        horzLines: { color: "rgba(255,255,255,0.03)" },
      },
      crosshair: {
        mode: 0,
        vertLine: { color: "rgba(120,81,233,0.3)", width: 1, style: 2 },
        horzLine: { color: "rgba(120,81,233,0.3)", width: 1, style: 2 },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.03)",
        timeVisible: false,
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.03)",
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      handleScroll: { mouseWheel: false, pressedMouseMove: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true },
    });

    chartRef.current = chart;

    const portfolioSeries = chart.addSeries(LineSeries, {
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      color: "#7851e9",
    });
    portfolioSeries.setData(data);

    if (delegatedData) {
      const delegatedSeries = chart.addSeries(LineSeries, {
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        color: "#2dd4a0",
      });
      delegatedSeries.setData(delegatedData);
    }

    if (benchmarkData) {
      const benchmarkSeries = chart.addSeries(LineSeries, {
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        color: "#a8a6a2",
      });
      benchmarkSeries.setData(benchmarkData);
    }

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (containerRef.current) {
        chart.resize(containerRef.current.offsetWidth, height);
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [data, delegatedData, benchmarkData, height]);

  const ranges: Range[] = ["1D", "7D", "30D", "90D", "1Y", "ALL"];

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-display text-sm font-medium text-text-primary">Portfolio Performance</h3>
          <p className="text-[11px] text-text-muted mt-0.5">Net asset value over time</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-white/5 bg-white/[0.02] p-0.5">
          {ranges.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-medium transition-all duration-200",
                range === r
                  ? "bg-white/[0.08] text-text-primary shadow-sm"
                  : "text-text-muted hover:text-text-secondary"
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div ref={containerRef} className="w-full" style={{ height }} />
    </div>
  );
}

export default memo(PerformanceChart);
