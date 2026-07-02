"use client";

import { useEffect } from "react";
import type { ToolMode } from "@/app/components/charts/drawing-tools/types";

export function useKeyboardShortcuts(
  onToolChange: (mode: ToolMode) => void,
  onUndo: () => void,
  onRedo: () => void,
  onDelete: () => void,
  onEscape: () => void,
) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      if (e.key === "Escape") {
        e.preventDefault();
        onEscape();
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        onDelete();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) onRedo();
        else onUndo();
        return;
      }

      const toolMap: Record<string, ToolMode> = {
        l: "trend_line",
        h: "horizontal_line",
        v: "vertical_line",
        r: "ray_line",
        f: "fib_retracement",
        t: "text",
        s: "select",
      };

      const mode = toolMap[e.key.toLowerCase()];
      if (mode) {
        e.preventDefault();
        onToolChange(mode);
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onToolChange, onUndo, onRedo, onDelete, onEscape]);
}
