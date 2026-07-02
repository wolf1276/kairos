"use client";

import { cn } from "@/lib/utils";
import type { ToolMode } from "../types";

const TOOLS: { value: ToolMode; label: string; shortcut: string }[] = [
  { value: "select", label: "Select", shortcut: "Esc" },
  { value: "trend_line", label: "Trend", shortcut: "L" },
  { value: "horizontal_line", label: "H-Line", shortcut: "H" },
  { value: "vertical_line", label: "V-Line", shortcut: "V" },
  { value: "ray_line", label: "Ray", shortcut: "R" },
  { value: "fib_retracement", label: "Fib", shortcut: "F" },
  { value: "text", label: "Text", shortcut: "T" },
];

export function DrawingToolbar({
  toolMode,
  onToolChange,
  onUndo,
  onRedo,
  onClearAll,
  onDeleteSelected,
  canUndo,
  canRedo,
  hasSelection,
}: {
  toolMode: ToolMode;
  onToolChange: (mode: ToolMode) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClearAll: () => void;
  onDeleteSelected: () => void;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
}) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-border bg-bg-elevated/80 px-2 py-1.5 backdrop-blur-xl">
      {TOOLS.map((t) => (
        <button
          key={t.value}
          onClick={() => onToolChange(t.value)}
          title={`${t.label} (${t.shortcut})`}
          className={cn(
            "cursor-pointer rounded-lg px-2 py-1 font-mono text-[10px] whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
            toolMode === t.value
              ? "bg-accent text-white shadow-sm"
              : "text-text-muted hover:text-text-secondary hover:bg-bg-card",
          )}
        >
          {t.label}
        </button>
      ))}

      <div className="mx-1 h-4 w-px bg-border" />

      <button
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        className="cursor-pointer rounded-lg px-2 py-1 font-mono text-[10px] text-text-muted transition-colors hover:text-text-secondary hover:bg-bg-card disabled:opacity-30 disabled:cursor-not-allowed"
      >
        ↩
      </button>
      <button
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo (Ctrl+Shift+Z)"
        className="cursor-pointer rounded-lg px-2 py-1 font-mono text-[10px] text-text-muted transition-colors hover:text-text-secondary hover:bg-bg-card disabled:opacity-30 disabled:cursor-not-allowed"
      >
        ↪
      </button>

      <div className="mx-1 h-4 w-px bg-border" />

      <button
        onClick={onDeleteSelected}
        disabled={!hasSelection}
        title="Delete selected (Del)"
        className="cursor-pointer rounded-lg px-2 py-1 font-mono text-[10px] text-text-muted transition-colors hover:text-error hover:bg-bg-card disabled:opacity-30 disabled:cursor-not-allowed"
      >
        ✕
      </button>
      <button
        onClick={onClearAll}
        title="Clear all drawings"
        className="cursor-pointer rounded-lg px-2 py-1 font-mono text-[10px] text-text-muted transition-colors hover:text-error hover:bg-bg-card"
      >
        Clear
      </button>
    </div>
  );
}
