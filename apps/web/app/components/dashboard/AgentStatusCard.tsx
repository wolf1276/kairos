"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { Bot, AlertTriangle } from "lucide-react";

interface AgentStatusCardProps {
  name: string;
  status: "running" | "stopped" | "error" | "idle";
  health: number;
  confidence: number;
  currentTask: string;
  successRate: number;
  lastAction: string;
  latency: number;
}

const STATUS_CONFIG = {
  running: { label: "Running", color: "text-success", bg: "bg-success/8", border: "border-success/15" },
  stopped: { label: "Stopped", color: "text-text-muted", bg: "bg-white/[0.02]", border: "border-white/[0.06]" },
  error: { label: "Error", color: "text-error", bg: "bg-error/8", border: "border-error/15" },
  idle: { label: "Idle", color: "text-amber-400", bg: "bg-amber-400/8", border: "border-amber-400/15" },
};

export function AgentStatusCard({
  name,
  status,
  health,
  confidence,
  currentTask,
  successRate,
  lastAction,
  latency,
}: AgentStatusCardProps) {
  const config = STATUS_CONFIG[status];

  return (
    <div className="group rounded-2xl border border-white/[0.06] bg-bg-card p-4 transition-all duration-300 hover:border-white/[0.12] hover:bg-bg-elevated/80">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg border", config.bg, config.border, config.color)}>
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs font-medium text-text-primary">{name}</p>
            <span className={cn("text-[10px] font-medium uppercase tracking-wider", config.color)}>{config.label}</span>
          </div>
        </div>
        <StatusIndicator status={status} />
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-[11px]">
          <span className="text-text-muted">Health</span>
          <span className="font-mono text-text-secondary tabular-nums">{Math.round(health * 100)}%</span>
        </div>
        <div className="h-1 rounded-full bg-white/5 overflow-hidden">
          <div className="h-full rounded-full bg-success/80 transition-all duration-500" style={{ width: `${health * 100}%` }} />
        </div>

        <div className="flex justify-between text-[11px]">
          <span className="text-text-muted">Confidence</span>
          <span className="font-mono text-text-secondary tabular-nums">{Math.round(confidence * 100)}%</span>
        </div>
        <div className="h-1 rounded-full bg-white/5 overflow-hidden">
          <div className="h-full rounded-full bg-accent/80 transition-all duration-500" style={{ width: `${confidence * 100}%` }} />
        </div>

        <div className="pt-2 mt-2 border-t border-white/[0.04] space-y-1.5">
          <div className="flex justify-between text-[11px]">
            <span className="text-text-muted">Success Rate</span>
            <span className="font-mono text-text-secondary tabular-nums">{successRate.toFixed(1)}%</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-text-muted">Latency</span>
            <span className="font-mono text-text-secondary tabular-nums">{latency}ms</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-text-muted">Last Action</span>
            <span className="text-text-secondary truncate max-w-[120px]">{lastAction}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-text-muted">Task</span>
            <span className="text-text-secondary truncate max-w-[160px]">{currentTask}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusIndicator({ status }: { status: string }) {
  if (status === "running") {
    return (
      <span className="relative flex h-2.5 w-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success" />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex h-2.5 w-2.5 items-center justify-center">
        <AlertTriangle className="h-3.5 w-3.5 text-error" />
      </span>
    );
  }
  return (
    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white/10" />
  );
}

export default memo(AgentStatusCard);
