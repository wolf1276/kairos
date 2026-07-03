"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";

interface ExecutionTimelineProps {
  items: {
    id: string;
    action: string;
    asset: string;
    amount: string;
    timestamp: number;
    reason: string;
    policy: string;
    result: "success" | "failed" | "pending";
  }[];
}

export function ExecutionTimeline({ items }: ExecutionTimelineProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-bg-card p-6 text-center">
        <p className="text-xs text-text-muted">No recent executions</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-bg-card p-5">
      <h3 className="font-display text-sm font-medium text-text-primary mb-4">Recent Executions</h3>
      <div className="space-y-0">
        {items.map((item, i) => (
          <div key={item.id} className={cn("flex gap-3 pb-4 last:pb-0", i < items.length - 1 && "border-b border-white/[0.04]")}>
            <div className="flex flex-col items-center">
              <div className={cn("mt-1 h-2 w-2 rounded-full", item.result === "success" && "bg-success", item.result === "failed" && "bg-error", item.result === "pending" && "bg-amber-400 animate-pulse")} />
              {i < items.length - 1 && <div className="w-px flex-1 bg-white/[0.04] mt-1" />}
            </div>
            <div className="flex-1 min-w-0 pb-1">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-text-primary">{item.action}</p>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    {item.asset} · {item.amount}
                  </p>
                </div>
                <span className="text-[10px] text-text-muted font-mono tabular-nums whitespace-nowrap">
                  {new Date(item.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-secondary">
                <span className="truncate">{item.reason}</span>
                <span className="text-text-muted">via {item.policy}</span>
                <span className={cn("font-medium uppercase tracking-wider", item.result === "success" && "text-success", item.result === "failed" && "text-error", item.result === "pending" && "text-amber-400")}>
                  {item.result}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(ExecutionTimeline);
