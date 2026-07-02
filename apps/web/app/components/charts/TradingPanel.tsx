"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { IChartApi } from "lightweight-charts";
import type { PricedPosition } from "@/app/hooks/usePaperTrading";
import type { Trade } from "@/lib/paper-trading";
import type { PriceAlert } from "@/app/hooks/usePriceAlerts";
import { PositionTracker } from "./PositionTracker";
import { TradeHistory } from "./TradeHistory";
import { PriceAlertsPanel } from "./PriceAlertsPanel";
import { ScreenshotButton } from "./ScreenshotButton";

type Tab = "positions" | "trades" | "alerts";

const TABS: { value: Tab; label: string }[] = [
  { value: "positions", label: "Positions" },
  { value: "trades", label: "Trades" },
  { value: "alerts", label: "Alerts" },
];

export function TradingPanel({
  positions,
  trades,
  priceAlerts,
  symbol,
  chartRef,
  onClosePosition,
  onAddAlert,
  onRemoveAlert,
  onClearTriggered,
}: {
  positions: PricedPosition[];
  trades: Trade[];
  priceAlerts: PriceAlert[];
  symbol: string;
  chartRef: React.RefObject<IChartApi | null>;
  onClosePosition: (symbol: string) => void;
  onAddAlert: (symbol: string, price: number, direction: "above" | "below") => void;
  onRemoveAlert: (id: string) => void;
  onClearTriggered: () => void;
}) {
  const [tab, setTab] = useState<Tab>("positions");

  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] backdrop-blur-xl">
      {/* Tab bar */}
      <div className="flex items-center border-b border-white/5">
        <div className="flex items-center gap-1 px-2 py-1">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={cn(
                "cursor-pointer rounded-lg px-2.5 py-1 font-mono text-[10px] font-medium transition-colors",
                tab === t.value
                  ? "bg-white/8 text-text-primary"
                  : "text-text-muted hover:text-text-secondary",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1 px-2 py-1">
          <ScreenshotButton chartRef={chartRef} />
        </div>
      </div>

      {/* Tab content */}
      <div className="p-2">
        {tab === "positions" && (
          <PositionTracker positions={positions} onClose={onClosePosition} />
        )}
        {tab === "trades" && <TradeHistory trades={trades} />}
        {tab === "alerts" && (
          <PriceAlertsPanel
            alerts={priceAlerts}
            symbol={symbol}
            onAdd={onAddAlert}
            onRemove={onRemoveAlert}
            onClearTriggered={onClearTriggered}
          />
        )}
      </div>
    </div>
  );
}
