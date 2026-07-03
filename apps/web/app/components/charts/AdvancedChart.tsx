"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type HistogramData,
  type SeriesType,
  type Time,
} from "lightweight-charts";
import { formatPrice, formatPct } from "@/app/lib/format";
import { useStreamingKlines } from "@/app/hooks/useStreamingKlines";
import { useChartConfig } from "@/app/hooks/useChartConfig";
import { ChartToolbar } from "@/app/components/charts/ChartToolbar";
import { DrawingToolbar } from "@/app/components/charts/DrawingToolbar";
import { DrawingManager } from "@/app/components/charts/drawing-tools/DrawingManager";
import { useDrawings } from "@/app/hooks/useDrawings";
import { useKeyboardShortcuts } from "@/app/hooks/useKeyboardShortcuts";
import type { ToolMode } from "@/app/components/charts/drawing-tools/types";
import { OrderBook } from "@/app/components/charts/OrderBook";

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

function calcSMA(values: number[], period: number): (number | undefined)[] {
  const result: (number | undefined)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    result.push(i >= period - 1 ? sum / period : undefined);
  }
  return result;
}

function calcBollinger(values: number[], period = 20, mult = 2) {
  const basis = calcSMA(values, period);
  const upper: (number | undefined)[] = [];
  const lower: (number | undefined)[] = [];
  for (let i = 0; i < values.length; i++) {
    const b = basis[i];
    if (b === undefined) { upper.push(undefined); lower.push(undefined); continue; }
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += (values[j] - b) ** 2;
    const sd = Math.sqrt(sq / period);
    upper.push(b + mult * sd);
    lower.push(b - mult * sd);
  }
  return { basis, upper, lower };
}

function calcRSI(values: number[], period = 14): (number | undefined)[] {
  const result: (number | undefined)[] = new Array(values.length).fill(undefined);
  if (values.length <= period) return result;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gainSum += diff; else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

function calcMACD(values: number[], fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = calcEMA(values, fast);
  const emaSlow = calcEMA(values, slow);
  const macd = values.map((_, i) => emaFast[i] - emaSlow[i]);
  const signal = calcEMA(macd, signalPeriod);
  const hist = macd.map((v, i) => v - signal[i]);
  return { macd, signal, hist };
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
  const { candles, loading, error } = useStreamingKlines(symbol, bi);
  const { drawings: savedDrawings, save: saveDrawings } = useDrawings(symbol);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<AnySeries | null>(null);
  const ema8SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ema21SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbBasisRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdLineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdSignalRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdHistRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const fittedRef = useRef(false);
  const prevDataRef = useRef<CandlestickData[]>([]);
  const vwapLineRef = useRef<ReturnType<AnySeries["createPriceLine"]> | null>(null);
  const priceLineRef = useRef<ReturnType<AnySeries["createPriceLine"]> | null>(null);
  const mgrRef = useRef<DrawingManager | null>(null);

  const [toolMode, setToolMode] = useState<ToolMode>("select");
  const [showOrderBook, setShowOrderBook] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [undoState, setUndoState] = useState({ canUndo: false, canRedo: false });
  const syncUndoState = () => {
    const mgr = mgrRef.current;
    setUndoState({ canUndo: mgr?.canUndo ?? false, canRedo: mgr?.canRedo ?? false });
  };

  const TOOL_LABELS: Record<ToolMode, string> = {
    select: "",
    trend_line: "Trend",
    horizontal_line: "H-Line",
    vertical_line: "V-Line",
    ray_line: "Ray",
    fib_retracement: "Fib",
    text: "Text",
  };

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

  // Bollinger Bands / RSI / MACD (all derived from sorted, de-duped closes)
  const { bbData, rsiData, macdData } = useMemo(() => {
    if (candles.length < 2) {
      return {
        bbData: { upper: [] as LineData[], basis: [] as LineData[], lower: [] as LineData[] },
        rsiData: [] as LineData[],
        macdData: { macd: [] as LineData[], signal: [] as LineData[], hist: [] as HistogramData[] },
      };
    }
    const sorted = [...candles].sort((a, b) => a.openTime - b.openTime)
      .filter((c, i, self) => i === 0 || c.openTime !== self[i - 1].openTime);
    const closes = sorted.map((c) => c.close || 0);
    const times = sorted.map((c) => Math.floor(c.openTime / 1000) as Time);

    const bb = calcBollinger(closes);
    const rsi = calcRSI(closes);
    const macd = calcMACD(closes);

    const toLine = (vals: (number | undefined)[]): LineData[] =>
      times.map((t, i) => ({ time: t, value: vals[i] })).filter((d) => d.value !== undefined) as LineData[];

    return {
      bbData: { upper: toLine(bb.upper), basis: toLine(bb.basis), lower: toLine(bb.lower) },
      rsiData: toLine(rsi),
      macdData: {
        macd: times.map((t, i) => ({ time: t, value: macd.macd[i] })),
        signal: times.map((t, i) => ({ time: t, value: macd.signal[i] })),
        hist: times.map((t, i) => ({
          time: t,
          value: macd.hist[i],
          color: macd.hist[i] >= 0 ? "rgba(52,211,153,0.6)" : "rgba(239,68,68,0.6)",
        })),
      },
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

    const bbUpper = chart.addSeries(LineSeries, { color: "rgba(148,163,184,0.5)", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const bbBasis = chart.addSeries(LineSeries, { color: "rgba(148,163,184,0.7)", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const bbLower = chart.addSeries(LineSeries, { color: "rgba(148,163,184,0.5)", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });

    // RSI — its own pane below the main chart
    const rsiPane = chart.addPane();
    const rsiSeries = chart.addSeries(LineSeries, {
      color: "#a78bfa", lineWidth: 1, priceLineVisible: false, lastValueVisible: true,
    }, rsiPane.paneIndex());
    rsiPane.setHeight(0);

    // MACD — its own pane below RSI
    const macdPane = chart.addPane();
    const macdHist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, macdPane.paneIndex());
    const macdLine = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1, priceLineVisible: false, lastValueVisible: true }, macdPane.paneIndex());
    const macdSignal = chart.addSeries(LineSeries, { color: "#06b6d4", lineWidth: 1, priceLineVisible: false, lastValueVisible: true }, macdPane.paneIndex());
    macdPane.setHeight(0);

    chartRef.current = chart;
    seriesRef.current = mainSeries;
    ema8SeriesRef.current = ema8;
    ema21SeriesRef.current = ema21;
    bbUpperRef.current = bbUpper;
    bbBasisRef.current = bbBasis;
    bbLowerRef.current = bbLower;
    rsiSeriesRef.current = rsiSeries;
    macdLineRef.current = macdLine;
    macdSignalRef.current = macdSignal;
    macdHistRef.current = macdHist;

    // `autoSize` (set above) already tracks the container via its own internal
    // ResizeObserver — calling `chart.resize()` ourselves on top of that fights it
    // and pins the container to a stale width (this caused the order-book panel to
    // reopen misaligned). Only nudge `fitContent()` after a fullscreen transition,
    // which doesn't touch sizing and so can't conflict with autoSize.
    const handleFullscreenChange = () => {
      requestAnimationFrame(() => {
        chartRef.current?.timeScale().fitContent();
      });
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    // Drawing manager
    const mgr = new DrawingManager();
    mgrRef.current = mgr;
    mgr.attach(chart, mainSeries, containerRef.current, {
      onChange: (drawings) => { saveDrawings(drawings); syncUndoState(); },
      onSelect: (id) => setSelectedId(id),
      onRequestText: (callback) => {
        const text = window.prompt("Enter annotation text:");
        if (text) callback(text);
      },
    });

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      mgr.detach();
      mgrRef.current = null;
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      ema8SeriesRef.current = null;
      ema21SeriesRef.current = null;
      bbUpperRef.current = null;
      bbBasisRef.current = null;
      bbLowerRef.current = null;
      rsiSeriesRef.current = null;
      macdLineRef.current = null;
      macdSignalRef.current = null;
      macdHistRef.current = null;
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

    // Bollinger Bands
    const bu = bbUpperRef.current, bb = bbBasisRef.current, bl = bbLowerRef.current;
    if (bu && bb && bl) {
      if (bbData.basis.length >= 2) {
        bu.setData(bbData.upper);
        bb.setData(bbData.basis);
        bl.setData(bbData.lower);
      }
      bu.applyOptions({ visible: indicators.bb });
      bb.applyOptions({ visible: indicators.bb });
      bl.applyOptions({ visible: indicators.bb });
    }

    // RSI (own pane)
    const rsiSeries = rsiSeriesRef.current;
    if (rsiSeries) {
      if (rsiData.length >= 2) rsiSeries.setData(rsiData);
      const pane = rsiSeries.getPane();
      const targetHeight = indicators.rsi ? 100 : 0;
      if (pane.getHeight() !== targetHeight) pane.setHeight(targetHeight);
    }

    // MACD (own pane)
    const mLine = macdLineRef.current, mSignal = macdSignalRef.current, mHist = macdHistRef.current;
    if (mLine && mSignal && mHist) {
      if (macdData.macd.length >= 2) {
        mLine.setData(macdData.macd);
        mSignal.setData(macdData.signal);
        mHist.setData(macdData.hist);
      }
      const pane = mLine.getPane();
      const targetHeight = indicators.macd ? 100 : 0;
      if (pane.getHeight() !== targetHeight) pane.setHeight(targetHeight);
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
  }, [data, chartType, vwap, last, bbData, rsiData, macdData, indicators.vwap, indicators.currentPrice, indicators.ema8, indicators.ema21, indicators.bb, indicators.rsi, indicators.macd]);

  // ── Keyboard shortcuts ──
  const handleToolChange = (mode: ToolMode) => {
    setToolMode(mode);
    mgrRef.current?.setToolMode(mode);
  };
  const handleUndo = () => { mgrRef.current?.undo(); syncUndoState(); };
  const handleRedo = () => { mgrRef.current?.redo(); syncUndoState(); };
  const handleDelete = () => {
    const id = mgrRef.current?.getSelectedId();
    if (id) { mgrRef.current?.removeDrawing(id); syncUndoState(); }
  };

  useKeyboardShortcuts(
    handleToolChange,
    handleUndo,
    handleRedo,
    handleDelete,
    () => {
      setToolMode("select");
      mgrRef.current?.setToolMode("select");
      mgrRef.current?.selectDrawing(null);
    },
  );

  return (
    <div>
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
        onToggleOrderBook={() => setShowOrderBook((v) => !v)}
      />

      {/* Drawing toolbar + Chart + Order Book */}
      <div className="flex gap-2">
        <DrawingToolbar
          toolMode={toolMode}
          onToolChange={handleToolChange}
          onUndo={handleUndo}
          onRedo={handleRedo}
          canUndo={undoState.canUndo}
          canRedo={undoState.canRedo}
          onDelete={handleDelete}
          hasSelection={selectedId !== null}
        />

        <div style={{ position: "relative", flex: 1, minHeight: height }}>
          <div
            ref={containerRef}
            style={{ width: "100%", minHeight: height, borderRadius: 12, overflow: "hidden" }}
          />

          {/* Legend overlay */}
          <div className="pointer-events-none absolute left-3 top-2 z-[1] flex items-baseline gap-2">
            <span className="font-display text-xl font-bold tabular-nums text-text-primary drop-shadow-sm">
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
            {toolMode !== "select" && (
              <span className="rounded border border-white/10 bg-bg-elevated/80 px-1.5 py-[1px] font-mono text-[10px] uppercase tracking-wider text-text-muted backdrop-blur-sm">
                {TOOL_LABELS[toolMode]}
              </span>
            )}
          </div>

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
    </div>
  );
}
