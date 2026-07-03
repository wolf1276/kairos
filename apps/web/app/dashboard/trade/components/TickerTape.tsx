"use client";

import { useMemo } from "react";
import type { TickerMap } from "@/app/hooks/usePrices";
import { formatPrice, formatPct } from "@/app/lib/format";

const WATCHED_SYMBOLS = ["XLMUSDT", "BTCUSDT", "ETHUSDT", "SOLUSDT", "USDCUSDT"];

export function TickerTape({ tickers }: { tickers: TickerMap }) {
  const items = useMemo(
    () =>
      WATCHED_SYMBOLS.map((s) => {
        const t = tickers[s];
        if (!t) return null;
        return {
          symbol: s.replace("USDT", "/USDT"),
          price: t.price,
          change: t.change24h,
        };
      }).filter(Boolean),
    [tickers],
  );

  if (items.length === 0) return null;

  return (
    <div className="flex items-center gap-0 overflow-x-auto rounded-xl border border-border bg-bg-elevated/80 px-2 py-1.5 backdrop-blur-xl scrollbar-none">
      {items.map((item) => (
        <div key={item!.symbol} className="flex shrink-0 items-center gap-2 border-r border-border/50 px-3 last:border-r-0">
          <span className="font-mono text-[11px] font-semibold text-text-primary whitespace-nowrap">
            {item!.symbol}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-text-secondary whitespace-nowrap">
            {formatPrice(item!.price)}
          </span>
          <span
            className={`font-mono text-[10px] tabular-nums whitespace-nowrap ${
              item!.change >= 0 ? "text-success" : "text-error"
            }`}
          >
            {formatPct(item!.change)}
          </span>
        </div>
      ))}
    </div>
  );
}
