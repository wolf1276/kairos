"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, ColorType, CandlestickSeries, type IChartApi, type ISeriesApi, type CandlestickData } from "lightweight-charts";
import { Segmented } from "@/app/components/ui/Segmented";
import { formatPrice, formatPct } from "@/app/lib/format";
import { useStreamingKlines } from "@/app/hooks/useStreamingKlines";

type Interval = "15m" | "1h" | "4h" | "1d";

const INTERVALS: { value: Interval; label: string }[] = [
  { value: "15m", label: "15m" },
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
  { value: "1d", label: "1D" },
];

const BINANCE_INTERVAL: Record<Interval, string> = {
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
};

const THEME = {
  bg: "#121216",
  text: "#6b6a66",
  grid: "#1e1e24",
  up: "#34d399",
  down: "#ef4444",
  wickUp: "#34d399",
  wickDown: "#ef4444",
};

export function PriceChart({ symbol, height = 440 }: { symbol: string; height?: number }) {
  const [interval, setInterval_] = useState<Interval>("1h");
  const bi = BINANCE_INTERVAL[interval];

  const { candles, loading, error, connected } = useStreamingKlines(symbol, bi);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const fittedRef = useRef(false);

  const { data, first, last, changePct, trendUp } = useMemo(() => {
    const d: CandlestickData[] = candles
      .map((c) => ({
        time: Math.floor(c.openTime / 1000) as CandlestickData["time"],
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
      .sort((a, b) => Number(a.time) - Number(b.time));
    const f = d[0]?.close ?? 0;
    const l = d[d.length - 1]?.close ?? 0;
    const chg = f ? ((l - f) / f) * 100 : 0;
    const refIdx = d.length >= 2 ? d.length - 2 : d.length - 1;
    const trendPrice = d[refIdx]?.close ?? l;
    return { data: d, first: f, last: l, changePct: chg, trendUp: trendPrice >= f };
  }, [candles]);

  // Create chart + series once
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      height,
      layout: {
        background: { type: ColorType.Solid, color: THEME.bg },
        textColor: THEME.text,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: THEME.grid },
        horzLines: { color: THEME.grid },
      },
      crosshair: {
        vertLine: { color: "#6b6a66", width: 1, style: 2, labelBackgroundColor: THEME.grid },
        horzLine: { color: "#6b6a66", width: 1, style: 2, labelBackgroundColor: THEME.grid },
      },
      timeScale: {
        borderColor: THEME.grid,
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 2,
      },
      rightPriceScale: {
        borderColor: THEME.grid,
      },
      handleScroll: true,
      handleScale: true,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: THEME.up,
      downColor: THEME.down,
      wickUpColor: THEME.wickUp,
      wickDownColor: THEME.wickDown,
      borderVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height]);

  const prevDataRef = useRef<CandlestickData[]>([]);

  // Reset fitContent when symbol or interval changes
  useEffect(() => {
    fittedRef.current = false;
    prevDataRef.current = [];
  }, [symbol, bi]);

  // Update data on the existing series
  useEffect(() => {
    if (!seriesRef.current || data.length === 0) return;
    const prev = prevDataRef.current;
    const isNewSeq = prev.length > 0 && prev[0].time !== data[0].time;

    if (prev.length === 0 || isNewSeq) {
      seriesRef.current.setData(data);
      if (!fittedRef.current) {
        chartRef.current?.timeScale().fitContent();
        fittedRef.current = true;
      }
    } else {
      seriesRef.current.update(data[data.length - 1]);
    }

    prevDataRef.current = data;
  }, [data]);

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
            {symbol}
          </p>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold tabular-nums">
              {loading && !last ? "—" : formatPrice(last)}
            </span>
            {!!first && (
              <span
                className={`font-mono text-xs font-medium tabular-nums ${
                  trendUp ? "text-success" : "text-error"
                }`}
              >
                {formatPct(changePct)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              connected
                ? "bg-success shadow-[0_0_6px_theme(colors.success)]"
                : loading
                  ? "bg-warning"
                  : "bg-error"
            }`}
            title={connected ? "Live" : loading ? "Connecting…" : "Disconnected"}
          />
          <Segmented
            size="sm"
            options={INTERVALS}
            value={interval}
            onChange={setInterval_}
            className="shrink-0"
          />
        </div>
      </div>

      <div style={{ position: "relative", height }}>
        <div ref={containerRef} style={{ height, borderRadius: 12, overflow: "hidden" }} />
        {error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-bg-elevated">
            <p className="text-sm text-text-muted">Failed to load chart · {error}</p>
          </div>
        )}
        {loading && data.length === 0 && !error && (
          <div className="absolute inset-0 z-10 animate-pulse rounded-xl bg-bg-elevated" />
        )}
      </div>
    </div>
  );
}
