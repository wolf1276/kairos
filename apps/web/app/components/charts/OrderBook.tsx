"use client";

import { useMemo } from "react";
import { formatPrice, formatNumber } from "@/app/lib/format";
import { useOrderBook } from "@/app/hooks/useOrderBook";

const MAX_ROWS = 8;

export function OrderBook({ symbol, height: minH = 200 }: { symbol: string | null; height?: number }) {
  const { bids, asks } = useOrderBook(symbol);

  const maxTotal = useMemo(() => {
    const bidMax = bids.length > 0 ? bids[bids.length - 1].total : 0;
    const askMax = asks.length > 0 ? asks[asks.length - 1].total : 0;
    return Math.max(bidMax, askMax, 1);
  }, [bids, asks]);

  const bestBid = bids.length > 0 ? bids[0].price : null;
  const bestAsk = asks.length > 0 ? asks[0].price : null;
  const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
  const spreadPct = spread != null && bestAsk != null ? (spread / bestAsk) * 100 : null;

  const asksSlice = useMemo(() => asks.slice(0, MAX_ROWS), [asks]);
  const bidsSlice = useMemo(() => bids.slice(0, MAX_ROWS), [bids]);
  const reversedAsks = useMemo(() => [...asksSlice].reverse(), [asksSlice]);

  return (
    <div className="flex w-[160px] shrink-0 flex-col rounded-xl border border-border bg-bg-elevated/60 backdrop-blur-xl" style={{ minHeight: minH }}>
      {/* Header */}
      <div className="border-b border-border px-2 py-1.5">
        <span className="font-mono text-[10px] font-semibold text-text-primary">Book</span>
      </div>

      {/* Asks */}
      <div className="flex flex-col-reverse overflow-hidden">
        {reversedAsks.map((level) => {
          const barWidth = maxTotal > 0 ? (level.total / maxTotal) * 100 : 0;
          return (
            <div key={level.price} className="relative flex items-center px-2 py-[1px]">
              <div
                className="absolute right-0 top-0 bottom-0 bg-error/8"
                style={{ width: `${barWidth}%` }}
              />
              <span className="relative z-[1] font-mono text-[9px] text-error tabular-nums">
                {formatPrice(level.price)}
              </span>
              <span className="relative z-[1] ml-auto font-mono text-[9px] text-text-muted tabular-nums">
                {formatNumber(level.size, 2)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Spread */}
      <div className="border-y border-border px-2 py-1">
        <span className="font-mono text-[9px] text-text-muted tabular-nums">
          {spread != null ? formatPrice(spread) : "\u2014"}
          {spreadPct != null && ` (${spreadPct.toFixed(2)}%)`}
        </span>
      </div>

      {/* Bids */}
      <div className="flex flex-col overflow-hidden">
        {bidsSlice.map((level) => {
          const barWidth = maxTotal > 0 ? (level.total / maxTotal) * 100 : 0;
          return (
            <div key={level.price} className="relative flex items-center px-2 py-[1px]">
              <div
                className="absolute right-0 top-0 bottom-0 bg-success/8"
                style={{ width: `${barWidth}%` }}
              />
              <span className="relative z-[1] font-mono text-[9px] text-success tabular-nums">
                {formatPrice(level.price)}
              </span>
              <span className="relative z-[1] ml-auto font-mono text-[9px] text-text-muted tabular-nums">
                {formatNumber(level.size, 2)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {bids.length === 0 && asks.length === 0 && (
        <div className="flex items-center justify-center py-4">
          <span className="font-mono text-[9px] text-text-muted">No data</span>
        </div>
      )}
    </div>
  );
}
