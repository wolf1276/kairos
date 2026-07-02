"use client";

import { useState } from "react";
import type { PriceAlert } from "@/app/hooks/usePriceAlerts";
import { formatPrice, formatDateTime } from "@/app/lib/format";

export function PriceAlertsPanel({
  alerts,
  symbol,
  onAdd,
  onRemove,
  onClearTriggered,
}: {
  alerts: PriceAlert[];
  symbol: string;
  onAdd: (symbol: string, targetPrice: number, direction: "above" | "below") => void;
  onRemove: (id: string) => void;
  onClearTriggered: () => void;
}) {
  const [targetPrice, setTargetPrice] = useState("");
  const [direction, setDirection] = useState<"above" | "below">("above");

  const handleAdd = () => {
    const price = parseFloat(targetPrice);
    if (isNaN(price) || price <= 0) return;
    onAdd(symbol, price, direction);
    setTargetPrice("");
  };

  const triggered = alerts.filter((a) => a.triggered);
  const active = alerts.filter((a) => !a.triggered);

  return (
    <div>
      {/* Add alert form */}
      <div className="mb-3 flex items-center gap-2 px-2">
        <input
          type="number"
          step="any"
          value={targetPrice}
          onChange={(e) => setTargetPrice(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="Price"
          className="w-24 rounded-lg border border-border bg-bg-elevated px-2 py-1 font-mono text-[10px] text-text-primary placeholder-text-muted outline-none transition-colors focus:border-accent/40"
        />
        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value as "above" | "below")}
          className="cursor-pointer rounded-lg border border-border bg-bg-elevated px-1.5 py-1 font-mono text-[10px] text-text-secondary outline-none transition-colors focus:border-accent/40"
        >
          <option value="above">Above</option>
          <option value="below">Below</option>
        </select>
        <button
          onClick={handleAdd}
          className="cursor-pointer rounded-lg bg-accent px-2.5 py-1 font-mono text-[10px] font-semibold text-white transition-colors hover:bg-accent/80"
        >
          Add
        </button>
      </div>

      {/* Active alerts */}
      {active.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 px-2 font-mono text-[9px] font-medium uppercase tracking-wider text-text-muted">
            Active ({active.length})
          </div>
          {active.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between px-2 py-1 transition-colors hover:bg-bg-card/50"
            >
              <span className="font-mono text-[10px] text-text-secondary">
                {a.direction === "above" ? "\u2191" : "\u2193"} {formatPrice(a.targetPrice)}
              </span>
              <button
                onClick={() => onRemove(a.id)}
                className="cursor-pointer font-mono text-[10px] text-text-muted transition-colors hover:text-error"
              >
                \u2715
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Triggered alerts */}
      {triggered.length > 0 && (
        <div>
          <div className="mb-1 flex items-center justify-between px-2">
            <span className="font-mono text-[9px] font-medium uppercase tracking-wider text-text-muted">
              Triggered ({triggered.length})
            </span>
            <button
              onClick={onClearTriggered}
              className="cursor-pointer font-mono text-[9px] text-text-muted transition-colors hover:text-text-secondary"
            >
              Clear
            </button>
          </div>
          {triggered.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between px-2 py-1 opacity-50 transition-colors hover:bg-bg-card/50"
            >
              <span className="font-mono text-[10px] text-text-secondary line-through">
                {a.direction === "above" ? "\u2191" : "\u2193"} {formatPrice(a.targetPrice)}
              </span>
              <button
                onClick={() => onRemove(a.id)}
                className="cursor-pointer font-mono text-[10px] text-text-muted transition-colors hover:text-error"
              >
                \u2715
              </button>
            </div>
          ))}
        </div>
      )}

      {alerts.length === 0 && (
        <div className="flex items-center justify-center py-8">
          <span className="font-mono text-[11px] text-text-muted">No alerts set</span>
        </div>
      )}
    </div>
  );
}
