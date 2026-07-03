"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";

interface ActivityFeedProps {
  items: {
    id: string;
    message: string;
    timestamp: number;
    type: "info" | "success" | "warning" | "error";
  }[];
}

export function ActivityFeed({ items }: ActivityFeedProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-bg-card p-6 text-center">
        <p className="text-xs text-text-muted">No recent activity</p>
      </div>
    );
  }

  const typeColor = {
    info: "bg-sky-400",
    success: "bg-success",
    warning: "bg-amber-400",
    error: "bg-error",
  };

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-sm font-medium text-text-primary">Activity Feed</h3>
        <span className="text-[10px] text-text-muted">Live</span>
      </div>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", typeColor[item.type])} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-text-secondary leading-relaxed">{item.message}</p>
              <p className="mt-0.5 text-[10px] text-text-muted font-mono tabular-nums">
                {new Date(item.timestamp).toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(ActivityFeed);
