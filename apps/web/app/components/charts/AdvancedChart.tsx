"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { DrawingManager } from "@/app/components/charts/drawing-tools/DrawingManager";
import { DrawingToolbar } from "@/app/components/charts/drawing-tools/ui/DrawingToolbar";
import { useDrawings } from "@/app/hooks/useDrawings";
import { useKeyboardShortcuts } from "@/app/hooks/useKeyboardShortcuts";
import { usePrices } from "@/app/hooks/usePrices";
import { usePaperTrading } from "@/app/hooks/usePaperTrading";
import { usePriceAlerts } from "@/app/hooks/usePriceAlerts";
import type { ToolMode } from "@/app/components/charts/drawing-tools/types";
import { OrderBook } from "@/app/components/charts/OrderBook";
import { TradingPanel } from "@/app/components/charts/TradingPanel";

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

export function AdvancedChart({
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
  const { drawings: savedDrawings, save: saveDrawings } = useDrawings(symbol);
  const { priceMap } = usePrices([symbol]);
  const { positions, trades, closePosition } = usePaperTrading(priceMap);
  const { alerts: priceAlerts, addAlert, removeAlert, clearTriggered, checkAlerts } = usePriceAlerts();

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<AnySeries | null>(null);
  const ema8SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ema21SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const fittedRef = useRef(false);
  const prevDataRef = useRef<CandlestickData[]>([]);
  const vwapLineRef = useRef<ReturnType<AnySeries["createPriceLine"]> | null>(null);
  const priceLineRef = useRef<ReturnType<AnySeries["createPriceLine"]> | null>(null);
  const mgrRef = useRef<DrawingManager | null>(null);

  const [toolMode, setToolMode] = useState<ToolMode>("select");
  const [showOrderBook, setShowOrderBook] = useState(true);
  const [showTradingPanel, setShowTradingPanel] = useState(true);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  // ── Create chart + all series + drawing manager ──
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
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
        tickMarkFormatter: (time: number) => {
          const d = new Date(time * 1000);
          return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
        },
      },
      rightPriceScale: { borderColor: THEME.grid },
      localization: {
        timeFormatter: (time: number) => {
          const d = new Date(time * 1000);
          return d.toLocaleString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });
        },
      },
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

    // Drawing manager
    const mgr = new DrawingManager();
    mgrRef.current = mgr;
    mgr.attach(chart, mainSeries, containerRef.current, {
      onChange: (drawings) => {
        saveDrawings(drawings);
        setCanUndo(mgr.canUndo);
        setCanRedo(mgr.canRedo);
      },
      onSelect: (id) => setSelectedId(id),
      onRequestText: (callback) => {
        const text = window.prompt("Enter annotation text:");
        if (text) callback(text);
      },
    });

    return () => {
      mgr.detach();
      mgrRef.current = null;
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      ema8SeriesRef.current = null;
      ema21SeriesRef.current = null;
      vwapLineRef.current = null;
      priceLineRef.current = null;
    };
  }, [height, saveDrawings]);

  // ── Load saved drawings when symbol changes ──
  useEffect(() => {
    mgrRef.current?.loadDrawings(savedDrawings);
    fittedRef.current = false;
    prevDataRef.current = [];
    vwapLineRef.current = null;
    priceLineRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, bi]);

  // ── Time scale options on interval change ──
  useEffect(() => {
    chartRef.current?.timeScale().applyOptions({
      secondsVisible: interval === "1m",
    });
  }, [interval]);

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

  // ── Data/indicator effect ──
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || data.length === 0) return;

    const prev = prevDataRef.current;
    const isNewSeq = prev.length > 0 && prev[0].time !== data[0].time;
    const lastBar = data[data.length - 1];

    if (prev.length === 0 || isNewSeq) {
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

    // EMA8
    const e8 = ema8SeriesRef.current;
    if (e8) {
      if (emaData.ema8.length >= 2) {
        e8.setData(emaData.ema8);
      }
      e8.applyOptions({ visible: indicators.ema8 });
    }

    // EMA21
    const e21 = ema21SeriesRef.current;
    if (e21) {
      if (emaData.ema21.length >= 2) {
        e21.setData(emaData.ema21);
      }
      e21.applyOptions({ visible: indicators.ema21 });
    }

    // VWAP
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

    // Price line
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, chartType, vwap, last, indicators.vwap, indicators.currentPrice, indicators.ema8, indicators.ema21]);

  // ── Price alert checker ──
  useEffect(() => {
    if (Object.keys(priceMap).length === 0) return;
    const id = window.setInterval(() => { checkAlerts(priceMap); }, 2000);
    return () => window.clearInterval(id);
  }, [priceMap, checkAlerts]);

  // ── Keyboard shortcuts ──
  useKeyboardShortcuts(
    (mode) => {
      setToolMode(mode);
      mgrRef.current?.setToolMode(mode);
    },
    () => { const m = mgrRef.current; m?.undo(); setCanUndo(m?.canUndo ?? false); setCanRedo(m?.canRedo ?? false); },
    () => { const m = mgrRef.current; m?.redo(); setCanUndo(m?.canUndo ?? false); setCanRedo(m?.canRedo ?? false); },
    () => {
      const id = mgrRef.current?.getSelectedId();
      if (id) { const m = mgrRef.current; m?.removeDrawing(id); setCanUndo(m?.canUndo ?? false); setCanRedo(m?.canRedo ?? false); }
    },
    () => {
      setToolMode("select");
      mgrRef.current?.setToolMode("select");
      mgrRef.current?.selectDrawing(null);
    },
  );

  return (
    <div>
      {/* Price + Status */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-2xl font-bold tabular-nums">
            {loading && !last ? "\u2014" : formatPrice(last)}
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

      {/* Drawing toolbar */}
      <div className="mb-2">
        <DrawingToolbar
          toolMode={toolMode}
          onToolChange={(mode) => {
            setToolMode(mode);
            mgrRef.current?.setToolMode(mode);
          }}
          onUndo={() => { const m = mgrRef.current; m?.undo(); setCanUndo(m?.canUndo ?? false); setCanRedo(m?.canRedo ?? false); }}
          onRedo={() => { const m = mgrRef.current; m?.redo(); setCanUndo(m?.canUndo ?? false); setCanRedo(m?.canRedo ?? false); }}
          onClearAll={() => { const m = mgrRef.current; m?.clearAll(); setCanUndo(m?.canUndo ?? false); setCanRedo(m?.canRedo ?? false); }}
          onDeleteSelected={() => {
            const id = mgrRef.current?.getSelectedId();
            if (id) { const m = mgrRef.current; m?.removeDrawing(id); setCanUndo(m?.canUndo ?? false); setCanRedo(m?.canRedo ?? false); }
          }}
          canUndo={canUndo}
          canRedo={canRedo}
          hasSelection={selectedId !== null}
        />
      </div>

      {/* Instrument toolbar */}
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
        showOrderBook={showOrderBook}
        showTradingPanel={showTradingPanel}
        onToggleOrderBook={() => setShowOrderBook((v) => !v)}
        onToggleTradingPanel={() => setShowTradingPanel((v) => !v)}
      />

      {/* Chart + Order Book */}
      <div className="flex gap-2">
        <div style={{ position: "relative", flex: 1, minHeight: height }}>
          <div
            ref={containerRef}
            style={{ width: "100%", minHeight: height, borderRadius: 12, overflow: "hidden" }}
          />
          {error && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-bg-elevated">
              <p className="text-sm text-text-muted">Failed to load chart &middot; {error}</p>
            </div>
          )}
          {loading && data.length === 0 && !error && (
            <div className="absolute inset-0 z-10 animate-pulse rounded-xl bg-bg-elevated" />
          )}
        </div>
        {showOrderBook && <OrderBook symbol={symbol} height={height} />}
      </div>

      {/* Trading panel */}
      {showTradingPanel && (
        <div className="mt-2">
          <TradingPanel
            positions={positions}
            trades={trades}
            priceAlerts={priceAlerts}
            symbol={symbol}
            chartRef={chartRef}
            onClosePosition={(sym) => {
              const p = priceMap[sym];
              if (p) closePosition(sym, p);
            }}
            onAddAlert={addAlert}
            onRemoveAlert={removeAlert}
            onClearTriggered={clearTriggered}
          />
        </div>
      )}
    </div>
  );
}
