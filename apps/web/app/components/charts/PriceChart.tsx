"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  createChart,
  ColorType,
  CandlestickSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type SeriesType,
  type Time,
} from "lightweight-charts";
import { formatPrice, formatPct } from "@/app/lib/format";
import { useStreamingKlines } from "@/app/hooks/useStreamingKlines";
import { useChartConfig } from "@/app/hooks/useChartConfig";
import { ChartToolbar } from "@/app/components/charts/ChartToolbar";

type AnySeries = ISeriesApi<SeriesType>;

const THEME = {
  bg: "#121216",
  text: "#6b6a66",
  grid: "#1e1e24",
  up: "#34d399",
  down: "#ef4444",
  wickUp: "#34d399",
  wickDown: "#ef4444",
};

const EMA8_COLOR = "#f59e0b";
const EMA21_COLOR = "#06b6d4";

function calcEMA(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [values[0]];
  for (let i = 1; i < values.length; i++)
    result.push(values[i] * k + result[i - 1] * (1 - k));
  return result;
}

export function PriceChart({
  symbol,
  height = 440,
  onSymbolChange,
  symbols,
}: {
  symbol: string;
  height?: number;
  onSymbolChange?: (symbol: string) => void;
  symbols?: string[];
}) {
  const { interval, setInterval, bi, chartType, setChartType, indicators, toggleIndicator } =
    useChartConfig();
  const { candles, loading, error, connected } = useStreamingKlines(symbol, bi);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<AnySeries | null>(null);
  const ema8SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ema21SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const fittedRef = useRef(false);
  const prevDataRef = useRef<CandlestickData[]>([]);
  const ema8PrevRef = useRef<LineData[]>([]);
  const ema21PrevRef = useRef<LineData[]>([]);
  const vwapLineRef = useRef<ReturnType<AnySeries["createPriceLine"]> | null>(null);
  const priceLineRef = useRef<ReturnType<AnySeries["createPriceLine"]> | null>(null);

  // Derived candlestick data
  const { data, first, last, changePct, trendUp } = useMemo(() => {
    const d: CandlestickData[] = candles
      .map((c) => ({
        time: Math.floor(c.openTime / 1000) as Time,
        open: c.open || 0,
        high: c.high || 0,
        low: c.low || 0,
        close: c.close || 0,
      }))
      .sort((a, b) => Number(a.time) - Number(b.time))
      .filter((item, index, arr) => index === 0 || item.time !== arr[index - 1].time);
    const f = d[0]?.close ?? 0;
    const l = d[d.length - 1]?.close ?? 0;
    const chg = f ? ((l - f) / f) * 100 : 0;
    const refIdx = d.length >= 2 ? d.length - 2 : d.length - 1;
    const trendPrice = d[refIdx]?.close ?? l;
    return { data: d, first: f, last: l, changePct: chg, trendUp: trendPrice >= f };
  }, [candles]);

  // VWAP
  const vwap = useMemo(() => {
    if (candles.length < 2) return 0;
    let pv = 0, tv = 0;
    for (const c of candles) {
      const tp = (c.high + c.low + c.close) / 3;
      pv += tp * c.volume;
      tv += c.volume;
    }
    return tv > 0 ? pv / tv : 0;
  }, [candles]);

  // EMA data
  const emaData = useMemo(() => {
    if (candles.length < 2) return { ema8: [] as LineData[], ema21: [] as LineData[] };
    const sorted = [...candles].sort((a, b) => a.openTime - b.openTime)
      .filter((c, i, self) => i === 0 || c.openTime !== self[i - 1].openTime);
    const closes = sorted.map((c) => c.close || 0);
    const e8 = calcEMA(closes, 8);
    const e21 = calcEMA(closes, 21);
    return {
      ema8: sorted.map((c, i) => ({
        time: Math.floor(c.openTime / 1000) as Time,
        value: e8[i],
      })),
      ema21: sorted.map((c, i) => ({
        time: Math.floor(c.openTime / 1000) as Time,
        value: e21[i],
      })),
    };
  }, [candles]);

  // ── Create chart + all series ──
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
        vertLine: {
          color: "#6b6a66",
          width: 1,
          style: 2,
          labelBackgroundColor: THEME.grid,
        },
        horzLine: {
          color: "#6b6a66",
          width: 1,
          style: 2,
          labelBackgroundColor: THEME.grid,
        },
      },
      timeScale: {
        borderColor: THEME.grid,
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 2,
      },
      rightPriceScale: { borderColor: THEME.grid },
      handleScroll: true,
      handleScale: true,
    });

    const mainSeries = chart.addSeries(CandlestickSeries, {
      upColor: THEME.up,
      downColor: THEME.down,
      wickUpColor: THEME.wickUp,
      wickDownColor: THEME.wickDown,
      borderVisible: false,
    });

    const ema8 = chart.addSeries(LineSeries, {
      color: EMA8_COLOR,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: true,
      priceFormat: { type: "price" },
    });

    const ema21 = chart.addSeries(LineSeries, {
      color: EMA21_COLOR,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: true,
      priceFormat: { type: "price" },
    });

    chartRef.current = chart;
    seriesRef.current = mainSeries;
    ema8SeriesRef.current = ema8;
    ema21SeriesRef.current = ema21;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      ema8SeriesRef.current = null;
      ema21SeriesRef.current = null;
      vwapLineRef.current = null;
      priceLineRef.current = null;
    };
  }, [height]);

  // ── Reset on symbol or interval change ──
  useEffect(() => {
    fittedRef.current = false;
    prevDataRef.current = [];
    ema8PrevRef.current = [];
    ema21PrevRef.current = [];
    vwapLineRef.current = null;
    priceLineRef.current = null;
  }, [symbol, bi]);

  // ── Chart type switching ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (seriesRef.current) chart.removeSeries(seriesRef.current);
    vwapLineRef.current = null;
    priceLineRef.current = null;

    if (chartType === "line") {
      seriesRef.current = chart.addSeries(LineSeries, {
        color: THEME.up,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        priceFormat: { type: "price" },
      });
    } else {
      seriesRef.current = chart.addSeries(CandlestickSeries, {
        upColor: THEME.up,
        downColor: THEME.down,
        wickUpColor: THEME.wickUp,
        wickDownColor: THEME.wickDown,
        borderVisible: false,
      });
    }

    fittedRef.current = false;
    prevDataRef.current = [];
  }, [chartType]);

  // ── Single merged data/indicator/VWAP/price effect ──
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || data.length === 0) return;

    // 1. Main series data
    const prev = prevDataRef.current;
    const isNewSeq = prev.length > 0 && prev[0].time !== data[0].time;
    const lenChanged = prev.length > 0 && prev.length !== data.length;
    const lastBar = data[data.length - 1];

    if (prev.length === 0 || isNewSeq || lenChanged) {
      if (chartType === "line") {
        (series as ISeriesApi<"Line">).setData(
          data.map((d) => ({ time: d.time, value: d.close || 0 })),
        );
      } else {
        (series as ISeriesApi<"Candlestick">).setData(data);
      }
      if (!fittedRef.current) {
        chartRef.current?.timeScale().fitContent();
        fittedRef.current = true;
      }
    } else {
      if (chartType === "line") {
        (series as ISeriesApi<"Line">).update({ time: lastBar.time, value: lastBar.close || 0 });
      } else {
        (series as ISeriesApi<"Candlestick">).update(lastBar);
      }
    }
    prevDataRef.current = data;

    // 2. EMA8
    const e8 = ema8SeriesRef.current;
    if (e8) {
      if (emaData.ema8.length >= 2) {
        const e8Prev = ema8PrevRef.current;
        if (e8Prev.length === 0) {
          e8.setData(emaData.ema8);
        } else {
          e8.update(emaData.ema8[emaData.ema8.length - 1]);
        }
        ema8PrevRef.current = emaData.ema8;
      }
      e8.applyOptions({ visible: indicators.ema8 });
    }

    // 3. EMA21
    const e21 = ema21SeriesRef.current;
    if (e21) {
      if (emaData.ema21.length >= 2) {
        const e21Prev = ema21PrevRef.current;
        if (e21Prev.length === 0) {
          e21.setData(emaData.ema21);
        } else {
          e21.update(emaData.ema21[emaData.ema21.length - 1]);
        }
        ema21PrevRef.current = emaData.ema21;
      }
      e21.applyOptions({ visible: indicators.ema21 });
    }

    // 4. VWAP price line
    if (vwap > 0) {
      if (!indicators.vwap) {
        if (vwapLineRef.current) {
          series.removePriceLine(vwapLineRef.current);
          vwapLineRef.current = null;
        }
      } else if (!vwapLineRef.current) {
        vwapLineRef.current = series.createPriceLine({
          price: vwap,
          color: "#a78bfa",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "VWAP",
        });
      } else {
        vwapLineRef.current.applyOptions({ price: vwap });
      }
    }

    // 5. Current price line
    if (last > 0) {
      if (!indicators.currentPrice) {
        if (priceLineRef.current) {
          series.removePriceLine(priceLineRef.current);
          priceLineRef.current = null;
        }
      } else if (!priceLineRef.current) {
        priceLineRef.current = series.createPriceLine({
          price: last,
          color: "rgba(248, 246, 241, 0.25)",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: false,
        });
      } else {
        priceLineRef.current.applyOptions({ price: last });
      }
    }
  }, [data, chartType, emaData.ema8, emaData.ema21, vwap, last, indicators.vwap, indicators.currentPrice, indicators.ema8, indicators.ema21]);

  return (
    <div>
      {/* Price + Status */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
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
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            connected
              ? "bg-success shadow-[0_0_6px_theme(colors.success)]"
              : loading
                ? "bg-warning"
                : "bg-error"
          }`}
          title={connected ? "Live" : loading ? "Connecting\u2026" : "Disconnected"}
        />
      </div>

      {/* Toolbar */}
      <ChartToolbar
        symbol={symbol}
        interval={interval}
        chartType={chartType}
        indicators={indicators}
        onIntervalChange={setInterval}
        onChartTypeChange={setChartType}
        onToggleIndicator={toggleIndicator}
        onFitContent={() => chartRef.current?.timeScale().fitContent()}
        onFullscreen={() => containerRef.current?.requestFullscreen().catch(() => {})}
        symbols={symbols}
        onSymbolChange={onSymbolChange}
      />

      {/* Chart */}
      <div style={{ position: "relative", height }}>
        <div ref={containerRef} style={{ width: "100%", height, borderRadius: 12, overflow: "hidden" }} />
        {error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-bg-elevated">
            <p className="text-sm text-text-muted">Failed to load chart &middot; {error}</p>
          </div>
        )}
        {loading && data.length === 0 && !error && (
          <div className="absolute inset-0 z-10 animate-pulse rounded-xl bg-bg-elevated" />
        )}
      </div>
    </div>
  );
}
