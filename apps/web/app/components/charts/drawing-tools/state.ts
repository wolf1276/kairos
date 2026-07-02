import { useState, useCallback, useRef } from "react";
import type { Drawing, ToolMode } from "./types";

export function useDrawingState() {
  const [toolMode, setToolMode] = useState<ToolMode>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const pendingRef = useRef<{ time: number; price: number } | null>(null);

  const onDrawingsChange = useCallback((d: Drawing[]) => {
    setDrawings([...d]);
  }, []);

  const onSelect = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  const changeTool = useCallback((mode: ToolMode) => {
    setToolMode(mode);
    pendingRef.current = null;
  }, []);

  const hasActiveDrawing = toolMode !== "select";

  return {
    toolMode,
    setToolMode: changeTool,
    selectedId,
    onSelect,
    drawings,
    onDrawingsChange,
    hasActiveDrawing,
    pendingRef,
  };
}
