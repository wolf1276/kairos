"use client";

import {
  CandlestickChart,
  LineChart,
  BookOpen,
  Maximize2,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Interval, ChartType, IndicatorConfig } from "@/app/hooks/useChartConfig";

const INTERVALS: { value: Interval; label: string }[] = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "30m", label: "30m" },
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
  { value: "1d", label: "1D" },
  { value: "1w", label: "1W" },
  { value: "1M", label: "1M" },
];

const INDICATOR_DEFS: { key: keyof IndicatorConfig; label: string }[] = [
  { key: "vwap", label: "VWAP" },
  { key: "ema8", label: "EMA8" },
  { key: "ema21", label: "EMA21" },
  { key: "bb", label: "BB" },
  { key: "rsi", label: "RSI" },
  { key: "macd", label: "MACD" },
  { key: "currentPrice", label: "Price" },
];

function Divider() {
  return <div className="h-4 w-px shrink-0 bg-border" />;
}

function IconButton({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "flex shrink-0 cursor-pointer items-center justify-center rounded-lg p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        active
          ? "bg-accent-muted text-accent"
          : "text-text-muted hover:bg-bg-card hover:text-text-primary",
      )}
    >
      {children}
    </button>
  );
}

export function ChartToolbar({
  symbol,
  interval,
  chartType,
  indicators,
  onIntervalChange,
  onChartTypeChange,
  onToggleIndicator,
  onFitContent,
  onFullscreen,
  symbols,
  onSymbolChange,
  showOrderBook,
  onToggleOrderBook,
}: {
  symbol: string;
  interval: Interval;
  chartType: ChartType;
  indicators: IndicatorConfig;
  onIntervalChange: (v: Interval) => void;
  onChartTypeChange: (v: ChartType) => void;
  onToggleIndicator: (key: keyof IndicatorConfig, value?: boolean) => void;
  onFitContent: () => void;
  onFullscreen: () => void;
  symbols?: string[];
  onSymbolChange?: (symbol: string) => void;
  showOrderBook?: boolean;
  onToggleOrderBook?: () => void;
}) {
  return (
    <div className="mb-3 flex items-center gap-2 overflow-x-auto rounded-xl border border-border bg-bg-elevated/80 px-2 py-1.5 text-xs backdrop-blur-xl scrollbar-none">
      {/* Symbol */}
      {symbols && onSymbolChange ? (
        <select
          value={symbol}
          onChange={(e) => onSymbolChange(e.target.value)}
          className="flex shrink-0 cursor-pointer rounded-lg border border-border bg-transparent px-2 py-1 font-mono text-xs font-semibold text-text-primary whitespace-nowrap transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {symbols.map((s) => (
            <option key={s} value={s} className="bg-bg-elevated">
              {s.replace("USDT", "/USDT")}
            </option>
          ))}
        </select>
      ) : (
        <span className="flex shrink-0 items-center gap-1.5 px-1 font-mono text-xs font-semibold text-text-primary whitespace-nowrap">
          {symbol.replace("USDT", "/USDT")}
        </span>
      )}

      <Divider />

      {/* Timeframes */}
      <div className="flex items-center gap-0.5 shrink-0">
        {INTERVALS.map((i) => {
          const active = i.value === interval;
          return (
            <button
              key={i.value}
              onClick={() => onIntervalChange(i.value)}
              className={cn(
                "cursor-pointer rounded-lg px-2 py-1 font-mono text-[11px] whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                active
                  ? "bg-accent text-white shadow-sm"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              {i.label}
            </button>
          );
        })}
      </div>

      <Divider />

      {/* Chart Type */}
      <div className="flex items-center gap-0.5 shrink-0">
        <IconButton
          title="Candlestick"
          active={chartType === "candlestick"}
          onClick={() => onChartTypeChange("candlestick")}
        >
          <CandlestickChart size={14} />
        </IconButton>
        <IconButton
          title="Line"
          active={chartType === "line"}
          onClick={() => onChartTypeChange("line")}
        >
          <LineChart size={14} />
        </IconButton>
      </div>

      <Divider />

      {/* Indicators — always-visible toggle chips, one click to flip state */}
      <div className="flex items-center gap-1 shrink-0">
        {INDICATOR_DEFS.map((ind) => {
          const active = indicators[ind.key];
          return (
            <button
              key={ind.key}
              onClick={() => onToggleIndicator(ind.key)}
              aria-pressed={active}
              className={cn(
                "cursor-pointer rounded-lg px-2 py-1 font-mono text-[10px] whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                active
                  ? "border border-accent/20 bg-accent-muted text-accent"
                  : "border border-transparent text-text-muted hover:text-text-secondary",
              )}
            >
              {ind.label}
            </button>
          );
        })}
      </div>

      <div className="ml-auto flex items-center gap-0.5 shrink-0">
        {onToggleOrderBook && (
          <IconButton title="Order Book" active={showOrderBook} onClick={onToggleOrderBook}>
            <BookOpen size={14} />
          </IconButton>
        )}
        <Divider />
        <IconButton title="Fit Content" onClick={onFitContent}>
          <RotateCcw size={14} />
        </IconButton>
        <IconButton title="Fullscreen" onClick={onFullscreen}>
          <Maximize2 size={14} />
        </IconButton>
      </div>
    </div>
  );
}
