"use client";

import type { Trade } from "@/lib/paper-trading";
import { formatPrice, formatNumber, formatTime, baseAsset } from "@/app/lib/format";

export function TradeHistory({ trades }: { trades: Trade[] }) {
  if (trades.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="font-mono text-[11px] text-text-muted">No trades yet</span>
      </div>
    );
  }

  return (
    <div className="max-h-[200px] overflow-y-auto">
      <table className="w-full font-mono text-[10px]">
        <thead>
          <tr className="text-text-muted">
            <th className="px-2 py-1 text-left font-medium">Time</th>
            <th className="px-2 py-1 text-left font-medium">Action</th>
            <th className="px-2 py-1 text-left font-medium">Asset</th>
            <th className="px-2 py-1 text-right font-medium">Size</th>
            <th className="px-2 py-1 text-right font-medium">Price</th>
            <th className="px-2 py-1 text-right font-medium">PnL</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const isBuy = t.action === "BUY";
            return (
              <tr key={t.id} className="border-t border-border/40 transition-colors hover:bg-bg-card/50">
                <td className="px-2 py-1.5 text-left text-text-muted tabular-nums">
                  {formatTime(t.timestamp)}
                </td>
                <td className="px-2 py-1.5 text-left">
                  <span
                    className={`rounded px-1 py-0.5 text-[9px] font-semibold ${
                      isBuy ? "bg-success/10 text-success" : "bg-error/10 text-error"
                    }`}
                  >
                    {t.action}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-left text-text-primary">
                  {baseAsset(t.symbol)}
                </td>
                <td className="px-2 py-1.5 text-right text-text-secondary tabular-nums">
                  {formatNumber(t.amount, 2)}
                </td>
                <td className="px-2 py-1.5 text-right text-text-secondary tabular-nums">
                  {formatPrice(t.price)}
                </td>
                <td
                  className={`px-2 py-1.5 text-right tabular-nums ${
                    t.pnl != null
                      ? t.pnl > 0
                        ? "text-success"
                        : t.pnl < 0
                          ? "text-error"
                          : "text-text-secondary"
                      : "text-text-muted"
                  }`}
                >
                  {t.pnl != null ? formatPrice(t.pnl) : "\u2014"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
