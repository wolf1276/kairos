"use client";

import { usePrices } from "@/app/hooks/usePrices";
import { baseAsset, formatPrice, formatPct } from "@/app/lib/format";

const TICKER_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "XLMUSDT",
  "SOLUSDT",
  "ADAUSDT",
  "XRPUSDT",
  "DOGEUSDT",
];

export default function TerminalTicker() {
  const { tickers, loading } = usePrices(TICKER_SYMBOLS, 15000);

  const items = TICKER_SYMBOLS.map((s) => tickers[s]).filter(Boolean);
  // Duplicate for a seamless marquee loop.
  const loop = items.length > 0 ? [...items, ...items] : [];

  return (
    <div className="relative overflow-hidden border-b border-border bg-bg-card/80">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-bg-primary to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-bg-primary to-transparent" />

      {loading && items.length === 0 ? (
        <div className="flex py-2">
          <span className="mx-6 font-mono text-[13px] text-text-muted">
            Loading live prices…
          </span>
        </div>
      ) : (
        <div className="flex animate-ticker py-2" aria-hidden="true">
          {loop.map((item, i) => {
            const up = item.change24h >= 0;
            return (
              <span
                key={`${item.symbol}-${i}`}
                className="mx-6 flex shrink-0 items-center gap-3 font-mono text-[13px] tracking-wide"
              >
                <span className="text-text-muted">{baseAsset(item.symbol)}/USD</span>
                <span className="text-text-primary tabular-nums">
                  {formatPrice(item.price)}
                </span>
                <span
                  className={`tabular-nums ${up ? "text-success" : "text-error"}`}
                >
                  {formatPct(item.change24h)}
                </span>
                <span className="mx-2 text-border">|</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
