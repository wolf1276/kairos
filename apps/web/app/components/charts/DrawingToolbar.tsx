"use client";

import {
  MousePointer2,
  TrendingUp,
  Minus,
  SeparatorVertical,
  ArrowUpRight,
  Percent,
  Type,
  Undo2,
  Redo2,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolMode } from "@/app/components/charts/drawing-tools/types";

const TOOLS: { mode: ToolMode; title: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { mode: "select", title: "Cross / Select (S)", icon: MousePointer2 },
  { mode: "trend_line", title: "Trend Line (L)", icon: TrendingUp },
  { mode: "horizontal_line", title: "Horizontal Line (H)", icon: Minus },
  { mode: "vertical_line", title: "Vertical Line (V)", icon: SeparatorVertical },
  { mode: "ray_line", title: "Ray (R)", icon: ArrowUpRight },
  { mode: "fib_retracement", title: "Fib Retracement (F)", icon: Percent },
  { mode: "text", title: "Text (T)", icon: Type },
];

function ToolButton({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "flex w-full cursor-pointer items-center justify-center rounded-lg p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        active
          ? "bg-accent-muted text-accent"
          : "text-text-muted hover:bg-bg-card hover:text-text-primary",
      )}
    >
      {children}
    </button>
  );
}

export function DrawingToolbar({
  toolMode,
  onToolChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onDelete,
  hasSelection,
}: {
  toolMode: ToolMode;
  onToolChange: (mode: ToolMode) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onDelete: () => void;
  hasSelection: boolean;
}) {
  return (
    <div className="flex w-9 shrink-0 flex-col gap-0.5 rounded-xl border border-border bg-bg-elevated/80 p-1 backdrop-blur-xl">
      {TOOLS.map(({ mode, title, icon: Icon }) => (
        <ToolButton key={mode} title={title} active={toolMode === mode} onClick={() => onToolChange(mode)}>
          <Icon size={15} />
        </ToolButton>
      ))}

      <div className="my-1 h-px bg-border" />

      <ToolButton title="Undo (Ctrl+Z)" onClick={onUndo}>
        <Undo2 size={15} className={canUndo ? undefined : "opacity-30"} />
      </ToolButton>
      <ToolButton title="Redo (Ctrl+Shift+Z)" onClick={onRedo}>
        <Redo2 size={15} className={canRedo ? undefined : "opacity-30"} />
      </ToolButton>
      <ToolButton title="Delete Selected (Del)" onClick={onDelete}>
        <Trash2 size={15} className={hasSelection ? "text-error/80" : "opacity-30"} />
      </ToolButton>
    </div>
  );
}
