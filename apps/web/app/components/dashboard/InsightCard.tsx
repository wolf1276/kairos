"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { ArrowUpRight, AlertTriangle, Lightbulb, TrendingUp } from "lucide-react";

interface InsightCardProps {
  type: "opportunity" | "risk" | "observation" | "optimization";
  title: string;
  summary: string;
  confidence: number;
  timestamp: number;
  actionLabel?: string;
  onAction?: () => void;
}

const TYPE_CONFIG = {
  opportunity: { icon: TrendingUp, color: "text-success", bg: "bg-success/8", border: "border-success/15", label: "Opportunity" },
  risk: { icon: AlertTriangle, color: "text-error", bg: "bg-error/8", border: "border-error/15", label: "Risk Alert" },
  observation: { icon: Lightbulb, color: "text-sky-400", bg: "bg-sky-400/8", border: "border-sky-400/15", label: "Observation" },
  optimization: { icon: ArrowUpRight, color: "text-accent", bg: "bg-accent-muted/70", border: "border-accent/10", label: "Suggestion" },
};

export function InsightCard({ type, title, summary, confidence, timestamp, actionLabel, onAction }: InsightCardProps) {
  const config = TYPE_CONFIG[type];
  const Icon = config.icon;

  return (
    <div className={cn("rounded-xl border p-4 transition-all duration-200 hover:shadow-lg", config.bg, config.border)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg", config.bg, config.color)}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <span className="text-[10px] font-medium uppercase tracking-wider text-text-muted">{config.label}</span>
        </div>
        <span className="text-[10px] text-text-muted font-mono tabular-nums">
          {Math.round(confidence * 100)}% confidence
        </span>
      </div>

      <h4 className="mt-2.5 text-xs font-medium text-text-primary">{title}</h4>
      <p className="mt-1 text-[11px] text-text-secondary leading-relaxed line-clamp-2">{summary}</p>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[10px] text-text-muted">
          {new Date(timestamp).toLocaleTimeString()}
        </span>
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className={cn(
              "rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors",
              "border border-white/5 bg-white/[0.03] text-text-secondary hover:text-text-primary hover:bg-white/[0.06]"
            )}
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export default memo(InsightCard);
