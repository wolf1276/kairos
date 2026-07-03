"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";

interface PolicySummaryProps {
  policies: {
    id: string;
    name: string;
    usage: number;
    limit: number;
    status: "active" | "warning" | "critical";
  }[];
}

export function PolicySummary({ policies }: PolicySummaryProps) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-bg-card p-5">
      <h3 className="font-display text-sm font-medium text-text-primary mb-4">Policy Summary</h3>
      <div className="space-y-3">
        {policies.map((policy) => {
          const pct = (policy.usage / policy.limit) * 100;
          const statusColor = policy.status === "active" ? "text-success" : policy.status === "warning" ? "text-amber-400" : "text-error";
          return (
            <div key={policy.id} className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-text-primary">{policy.name}</p>
                <span className={cn("text-[10px] font-medium uppercase tracking-wider", statusColor)}>
                  {policy.status}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-text-muted">
                <span>
                  {policy.usage.toLocaleString()} / {policy.limit.toLocaleString()}
                </span>
                <span className="font-mono text-text-secondary tabular-nums">{pct.toFixed(0)}%</span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all duration-500", policy.status === "active" && "bg-success/70", policy.status === "warning" && "bg-amber-400/70", policy.status === "critical" && "bg-error/70")}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(PolicySummary);
