"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { Brain, Zap, Shield, Clock } from "lucide-react";

interface AIControlCenterProps {
  status: "thinking" | "scanning" | "executing" | "idle";
  currentDecision: string;
  reasoning: string;
  confidence: number;
  riskLevel: "Low" | "Medium" | "High";
  marketSentiment: "Bullish" | "Bearish" | "Neutral";
  nextAnalysis: string;
  latency: number;
  agentHealth: number;
  modelStatus: "online" | "degraded" | "offline";
}

const STATUS_CONFIG = {
  thinking: { label: "Thinking", color: "text-amber-400", icon: Brain, pulse: true },
  scanning: { label: "Scanning", color: "text-sky-400", icon: Zap, pulse: true },
  executing: { label: "Executing", color: "text-success", icon: Zap, pulse: true },
  idle: { label: "Idle", color: "text-text-muted", icon: Clock, pulse: false },
};

export function AIControlCenter({
  status,
  currentDecision,
  reasoning,
  confidence,
  riskLevel,
  marketSentiment,
  nextAnalysis,
  latency,
  agentHealth,
  modelStatus,
}: AIControlCenterProps) {
  const config = STATUS_CONFIG[status];
  const StatusIcon = config.icon;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-sm font-medium text-text-primary">AI Control Center</h3>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-wider",
              modelStatus === "online" && "border-success/15 bg-success/8 text-success/90",
              modelStatus === "degraded" && "border-amber-400/15 bg-amber-400/8 text-amber-400/90",
              modelStatus === "offline" && "border-error/15 bg-error/8 text-error/90"
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", modelStatus === "online" && "bg-success", modelStatus === "degraded" && "bg-amber-400", modelStatus === "offline" && "bg-error")} />
            {modelStatus}
          </span>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-xl border border-white/5 bg-white/[0.02]",
              config.color
            )}
          >
            <StatusIcon className={cn("h-5 w-5", config.pulse && "animate-pulse")} />
          </div>
          <div>
            <p className={cn("text-sm font-medium", config.color)}>{config.label}</p>
            <p className="text-[11px] text-text-muted truncate max-w-[200px]">{currentDecision}</p>
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-3">
          <p className="text-[10px] font-medium uppercase tracking-widest text-text-muted mb-1">Reasoning</p>
          <p className="text-xs text-text-secondary leading-relaxed line-clamp-2">{reasoning}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <AIMetric label="Confidence" value={`${Math.round(confidence * 100)}%`} />
          <AIMetric label="Risk Level" value={riskLevel} trend={riskLevel === "Low" ? "success" : riskLevel === "Medium" ? "warning" : "error"} />
          <AIMetric label="Sentiment" value={marketSentiment} trend={marketSentiment === "Bullish" ? "success" : marketSentiment === "Bearish" ? "error" : "neutral"} />
          <AIMetric label="Latency" value={`${latency}ms`} />
          <AIMetric label="Health" value={`${Math.round(agentHealth * 100)}%`} trend={agentHealth > 0.9 ? "success" : "warning"} />
          <AIMetric label="Next Analysis" value={nextAnalysis} />
        </div>
      </div>
    </div>
  );
}

function AIMetric({ label, value, trend }: { label: string; value: string; trend?: "success" | "warning" | "error" | "neutral" }) {
  const color = trend === "success" ? "text-success" : trend === "warning" ? "text-amber-400" : trend === "error" ? "text-error" : "text-text-secondary";
  return (
    <div className="rounded-lg border border-white/[0.04] bg-white/[0.01] px-3 py-2">
      <p className="text-[9px] uppercase tracking-widest text-text-muted">{label}</p>
      <p className={cn("mt-0.5 font-mono text-xs font-medium tabular-nums", color)}>{value}</p>
    </div>
  );
}

export default memo(AIControlCenter);
