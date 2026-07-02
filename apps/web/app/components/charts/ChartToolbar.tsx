"use client";

import { Maximize2, RotateCcw } from "lucide-react";
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
  { key: "currentPrice", label: "Price" },
];

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: "candlestick", label: "Candlestick" },
  { value: "line", label: "Line" },
];

function Divider() {
  return <div className="h-4 w-px shrink-0 bg-border" />;
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
  showTradingPanel,
  onToggleOrderBook,
  onToggleTradingPanel,
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
  showTradingPanel?: boolean;
  onToggleOrderBook?: () => void;
  onToggleTradingPanel?: () => void;
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
      <select
        value={chartType}
        onChange={(e) => onChartTypeChange(e.target.value as ChartType)}
        className="cursor-pointer rounded-lg border border-border bg-transparent px-2 py-1 font-mono text-[11px] text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {CHART_TYPES.map((t) => (
          <option key={t.value} value={t.value} className="bg-bg-elevated">
            {t.label}
          </option>
        ))}
      </select>

      <Divider />

      {/* Indicators */}
      <div className="flex items-center gap-1 shrink-0">
        {INDICATOR_DEFS.map((ind) => {
          const active = indicators[ind.key];
          return (
            <button
              key={ind.key}
              onClick={() => onToggleIndicator(ind.key)}
              className={cn(
                "cursor-pointer rounded-lg px-2 py-1 font-mono text-[10px] whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                active
                  ? "border border-accent/20 bg-accent-muted text-accent"
                  : "text-text-muted hover:text-text-secondary",
              )}
            >
              {ind.label}
            </button>
          );
        })}
      </div>

      <div className="ml-auto flex items-center gap-1 shrink-0">
        {onToggleOrderBook && (
          <button
            onClick={onToggleOrderBook}
            className={cn(
              "cursor-pointer rounded-lg px-2 py-1 font-mono text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
              showOrderBook
                ? "text-accent"
                : "text-text-muted hover:text-text-secondary",
            )}
          >
            Book
          </button>
        )}
        {onToggleTradingPanel && (
          <button
            onClick={onToggleTradingPanel}
            className={cn(
              "cursor-pointer rounded-lg px-2 py-1 font-mono text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
              showTradingPanel
                ? "text-accent"
                : "text-text-muted hover:text-text-secondary",
            )}
          >
            Panel
          </button>
        )}
        <div className="h-4 w-px bg-border" />
        <button
          onClick={onFitContent}
          title="Fit Content"
          className="cursor-pointer rounded-lg p-1.5 text-text-muted transition-colors hover:bg-bg-card hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <RotateCcw size={14} />
        </button>
        <button
          onClick={onFullscreen}
          title="Fullscreen"
          className="cursor-pointer rounded-lg p-1.5 text-text-muted transition-colors hover:bg-bg-card hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Maximize2 size={14} />
        </button>
      </div>
    </div>
  );
}
