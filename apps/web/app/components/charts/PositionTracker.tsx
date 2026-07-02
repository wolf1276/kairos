"use client";

import type { PricedPosition } from "@/app/hooks/usePaperTrading";
import { formatPrice, formatNumber, formatPct, baseAsset } from "@/app/lib/format";

export function PositionTracker({
  positions,
  onClose,
}: {
  positions: PricedPosition[];
  onClose: (symbol: string) => void;
}) {
  if (positions.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="font-mono text-[11px] text-text-muted">No open positions</span>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full font-mono text-[10px]">
        <thead>
          <tr className="text-text-muted">
            <th className="px-2 py-1 text-left font-medium">Asset</th>
            <th className="px-2 py-1 text-right font-medium">Size</th>
            <th className="px-2 py-1 text-right font-medium">Entry</th>
            <th className="px-2 py-1 text-right font-medium">Mark</th>
            <th className="px-2 py-1 text-right font-medium">PnL</th>
            <th className="px-2 py-1 text-right font-medium">Value</th>
            <th className="px-2 py-1" />
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const pnlColor = p.pnl > 0 ? "text-success" : p.pnl < 0 ? "text-error" : "text-text-secondary";
            return (
              <tr key={p.symbol} className="border-t border-border/40 transition-colors hover:bg-bg-card/50">
                <td className="px-2 py-1.5 text-left font-semibold text-text-primary">
                  {baseAsset(p.symbol)}
                </td>
                <td className="px-2 py-1.5 text-right text-text-secondary tabular-nums">
                  {formatNumber(p.amount, 2)}
                </td>
                <td className="px-2 py-1.5 text-right text-text-secondary tabular-nums">
                  {formatPrice(p.entryPrice)}
                </td>
                <td className="px-2 py-1.5 text-right text-text-secondary tabular-nums">
                  {formatPrice(p.currentPrice)}
                </td>
                <td className={`px-2 py-1.5 text-right tabular-nums ${pnlColor}`}>
                  <div>{formatPrice(p.pnl)}</div>
                  <div className="text-[9px] opacity-70">{formatPct(p.pnlPct)}</div>
                </td>
                <td className="px-2 py-1.5 text-right text-text-secondary tabular-nums">
                  {formatPrice(p.value)}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button
                    onClick={() => onClose(p.symbol)}
                    className="cursor-pointer rounded px-1.5 py-0.5 text-[9px] text-error transition-colors hover:bg-error/10"
                  >
                    Close
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
