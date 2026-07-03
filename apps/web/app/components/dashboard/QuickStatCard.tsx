"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";

interface QuickStatCardProps {
  label: string;
  value: string;
  change?: {
    value: string;
    positive: boolean;
  };
}

export function QuickStatCard({ label, value, change }: QuickStatCardProps) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-bg-card p-4 transition-all duration-300 hover:border-white/[0.12] hover:bg-bg-elevated/60">
      <p className="text-[10px] uppercase tracking-[0.15em] text-text-muted">{label}</p>
      <p className="mt-1.5 font-display text-lg font-semibold text-text-primary tabular-nums">{value}</p>
      {change && (
        <p className={cn("mt-1 text-[11px] font-medium tabular-nums", change.positive ? "text-success" : "text-error")}>
          {change.positive ? "+" : ""}{change.value}
        </p>
      )}
    </div>
  );
}

export default memo(QuickStatCard);
