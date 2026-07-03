"use client";

import type { IChartApi } from "lightweight-charts";
import type { PriceAlert } from "@/app/hooks/usePriceAlerts";
import { PriceAlertsPanel } from "./PriceAlertsPanel";
import { ScreenshotButton } from "./ScreenshotButton";

export function TradingPanel({
  priceAlerts,
  symbol,
  chartRef,
  onAddAlert,
  onRemoveAlert,
  onClearTriggered,
}: {
  priceAlerts: PriceAlert[];
  symbol: string;
  chartRef: React.RefObject<IChartApi | null>;
  onAddAlert: (symbol: string, price: number, direction: "above" | "below") => void;
  onRemoveAlert: (id: string) => void;
  onClearTriggered: () => void;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] backdrop-blur-xl">
      <div className="flex items-center border-b border-white/5">
        <div className="flex items-center gap-1 px-2 py-1">
          <span className="rounded-lg bg-white/8 px-2.5 py-1 font-mono text-[10px] font-medium text-text-primary">
            Alerts
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1 px-2 py-1">
          <ScreenshotButton chartRef={chartRef} />
        </div>
      </div>
      <div className="p-2">
        <PriceAlertsPanel
          alerts={priceAlerts}
          symbol={symbol}
          onAdd={onAddAlert}
          onRemove={onRemoveAlert}
          onClearTriggered={onClearTriggered}
        />
      </div>
    </div>
  );
}
