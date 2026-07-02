import type { IChartApi, ISeriesApi, SeriesType, MouseEventParams, Time } from "lightweight-charts";
import type { Drawing, ToolMode, DrawingPoint } from "./types";
import { TrendLinePrimitive } from "./primitives/TrendLine";
import { HorizontalLinePrimitive } from "./primitives/HorizontalLine";
import { VerticalLinePrimitive } from "./primitives/VerticalLine";
import { RayLinePrimitive } from "./primitives/RayLine";
import { TextAnnotationPrimitive } from "./primitives/TextAnnotation";
import { FibonacciPrimitive } from "./primitives/Fibonacci";

type AnyPrimitive =
  | TrendLinePrimitive
  | HorizontalLinePrimitive
  | VerticalLinePrimitive
  | RayLinePrimitive
  | TextAnnotationPrimitive
  | FibonacciPrimitive;

export class DrawingManager {
  private _chart: IChartApi | null = null;
  private _series: ISeriesApi<SeriesType> | null = null;
  private _primitives = new Map<string, AnyPrimitive>();

  private _toolMode: ToolMode = "select";
  private _pendingPoint: DrawingPoint | null = null;
  private _selectedId: string | null = null;

  private _undoStack: Drawing[][] = [];
  private _redoStack: Drawing[][] = [];

  private _onChange: ((drawings: Drawing[]) => void) | null = null;
  private _onSelect: ((id: string | null) => void) | null = null;
  private _onRequestText: ((callback: (text: string) => void) => void) | null = null;

  private _idCounter = 0;

  // Drag state
  private _dragId: string | null = null;
  private _dragStartPoints: DrawingPoint[] | null = null;
  private _dragStartX = 0;
  private _dragStartY = 0;

  // Bound handlers for cleanup
  private _onDocPointerDown: ((e: PointerEvent) => void) | null = null;
  private _onDocPointerMove: ((e: PointerEvent) => void) | null = null;
  private _onDocPointerUp: (() => void) | null = null;

  attach(
    chart: IChartApi,
    series: ISeriesApi<SeriesType>,
    _containerEl: HTMLElement,
    callbacks?: {
      onChange?: (drawings: Drawing[]) => void;
      onSelect?: (id: string | null) => void;
      onRequestText?: (callback: (text: string) => void) => void;
    },
  ) {
    this._chart = chart;
    this._series = series;
    this._onChange = callbacks?.onChange ?? null;
    this._onSelect = callbacks?.onSelect ?? null;
    this._onRequestText = callbacks?.onRequestText ?? null;

    chart.subscribeClick(this._handleClick);

    this._onDocPointerDown = (e: PointerEvent) => this._handleDocPointerDown(e);
    this._onDocPointerMove = (e: PointerEvent) => this._handleDocPointerMove(e);
    this._onDocPointerUp = () => this._handleDocPointerUp();
    document.addEventListener("pointerdown", this._onDocPointerDown);
    document.addEventListener("pointermove", this._onDocPointerMove);
    document.addEventListener("pointerup", this._onDocPointerUp);
  }

  detach() {
    if (this._chart) {
      this._chart.unsubscribeClick(this._handleClick);
    }
    if (this._onDocPointerDown) {
      document.removeEventListener("pointerdown", this._onDocPointerDown);
    }
    if (this._onDocPointerMove) {
      document.removeEventListener("pointermove", this._onDocPointerMove);
    }
    if (this._onDocPointerUp) {
      document.removeEventListener("pointerup", this._onDocPointerUp);
    }
    this._onDocPointerDown = null;
    this._onDocPointerMove = null;
    this._onDocPointerUp = null;
    this._clearAllPrimitives();
    this._chart = null;
    this._series = null;
    this._pendingPoint = null;
    this._dragId = null;
    this._dragStartPoints = null;
  }

  setToolMode(mode: ToolMode) {
    this._toolMode = mode;
    this._pendingPoint = null;
  }

  getToolMode(): ToolMode {
    return this._toolMode;
  }

  getSelectedId(): string | null {
    return this._selectedId;
  }

  getDrawings(): Drawing[] {
    const result: Drawing[] = [];
    for (const p of this._primitives.values()) {
      result.push(p.getDrawing());
    }
    return result;
  }

  addDrawing(drawing: Drawing) {
    if (!this._series) return;
    this._pushUndo();
    const primitive = this._createPrimitive(drawing);
    if (primitive) {
      this._primitives.set(drawing.id, primitive);
      this._series.attachPrimitive(primitive);
    }
    this._notifyChange();
  }

  removeDrawing(id: string) {
    if (!this._series) return;
    this._pushUndo();
    const primitive = this._primitives.get(id);
    if (primitive) {
      this._series.detachPrimitive(primitive);
      this._primitives.delete(id);
    }
    if (this._selectedId === id) {
      this._selectedId = null;
      this._onSelect?.(null);
    }
    this._notifyChange();
  }

  selectDrawing(id: string | null) {
    for (const [pid, p] of this._primitives) {
      p.setSelected(pid === id);
    }
    this._selectedId = id;
    this._onSelect?.(id);
  }

  clearAll() {
    if (!this._series) return;
    this._pushUndo();
    this._clearAllPrimitives();
    this._selectedId = null;
    this._onSelect?.(null);
    this._notifyChange();
  }

  loadDrawings(drawings: Drawing[]) {
    if (!this._series) return;
    this._clearAllPrimitives();
    for (const d of drawings) {
      const primitive = this._createPrimitive(d);
      if (primitive) {
        this._primitives.set(d.id, primitive);
        this._series.attachPrimitive(primitive);
      }
    }
    this._idCounter = drawings.reduce((m, d) => Math.max(m, parseInt(d.id) || 0), 0) + 1;
    this._notifyChange();
  }

  undo() {
    if (this._undoStack.length === 0) return;
    const prev = this._undoStack.pop()!;
    this._redoStack.push(this.getDrawings());
    this.loadDrawings(prev);
  }

  redo() {
    if (this._redoStack.length === 0) return;
    const next = this._redoStack.pop()!;
    this._undoStack.push(this.getDrawings());
    this.loadDrawings(next);
  }

  get canUndo(): boolean {
    return this._undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this._redoStack.length > 0;
  }

  get isDragging(): boolean {
    return this._dragId !== null;
  }

  reset() {
    this._clearAllPrimitives();
    this._selectedId = null;
    this._pendingPoint = null;
    this._undoStack = [];
    this._redoStack = [];
    this._idCounter = 0;
    this._dragId = null;
    this._dragStartPoints = null;
  }

  private _genId(): string {
    return String(this._idCounter++);
  }

  private _pushUndo() {
    this._undoStack.push(this.getDrawings());
    if (this._undoStack.length > 50) this._undoStack.shift();
    this._redoStack = [];
  }

  private _clearAllPrimitives() {
    if (!this._series) return;
    for (const primitive of this._primitives.values()) {
      this._series.detachPrimitive(primitive);
    }
    this._primitives.clear();
  }

  private _createPrimitive(drawing: Drawing): AnyPrimitive | null {
    switch (drawing.type) {
      case "trend_line":
        return new TrendLinePrimitive(drawing);
      case "horizontal_line":
        return new HorizontalLinePrimitive(drawing);
      case "vertical_line":
        return new VerticalLinePrimitive(drawing);
      case "ray_line":
        return new RayLinePrimitive(drawing);
      case "text":
        return new TextAnnotationPrimitive(drawing);
      case "fib_retracement":
        return new FibonacciPrimitive(drawing);
      default:
        return null;
    }
  }

  private _handleClick = (param: MouseEventParams) => {
    if (this._toolMode === "select") {
      if (param.hoveredInfo?.objectId) {
        this.selectDrawing(param.hoveredInfo.objectId as string);
      } else {
        this.selectDrawing(null);
      }
      return;
    }

    if (this._toolMode === "text") {
      this._handleTextClick(param);
      return;
    }

    const point = this._getClickPoint(param);
    if (!point) return;

    const twoClickTools: ToolMode[] = ["trend_line", "ray_line", "fib_retracement"];
    if (twoClickTools.includes(this._toolMode)) {
      if (!this._pendingPoint) {
        this._pendingPoint = point;
        return;
      }
      this._finalizeDrawing(this._toolMode, [this._pendingPoint, point]);
      this._pendingPoint = null;
    } else {
      this._finalizeDrawing(this._toolMode, [point]);
    }
  };

  private _handleTextClick(param: MouseEventParams) {
    const point = this._getClickPoint(param);
    if (!point) return;
    this._onRequestText?.((text: string) => {
      this._finalizeDrawing("text", [point], text || "text");
    });
  }

  private _getClickPoint(param: MouseEventParams): DrawingPoint | null {
    if (!param.point || !this._series || !this._chart) return null;
    const time = this._chart.timeScale().coordinateToTime(param.point.x);
    if (time == null) return null;
    const price = this._series.coordinateToPrice(param.point.y);
    if (price == null) return null;
    return { time: Number(time), price };
  }

  // ── Drag-to-move via document-level pointer events ──

  private _clientToPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    if (!this._chart) return null;
    const chartEl = (this._chart as unknown as { chartElement?(): HTMLElement }).chartElement?.();
    if (!chartEl) return null;
    const rect = chartEl.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  private _handleDocPointerDown = (e: PointerEvent) => {
    if (this._toolMode !== "select" || !this._selectedId || this._dragId || !this._chart || !this._series) return;
    const pos = this._clientToPoint(e.clientX, e.clientY);
    if (!pos) return;
    const prim = this._primitives.get(this._selectedId);
    if (!prim) return;
    const hit = prim.hitTest(pos.x, pos.y);
    if (!hit) return;
    this._dragId = this._selectedId;
    this._dragStartPoints = prim.getDrawing().points.map((p) => ({ ...p }));
    this._dragStartX = e.clientX;
    this._dragStartY = e.clientY;
  };

  private _handleDocPointerMove = (e: PointerEvent) => {
    if (!this._dragId || !this._chart || !this._series) return;
    const prim = this._primitives.get(this._dragId);
    if (!prim) { this._dragId = null; return; }

    const dx = e.clientX - this._dragStartX;
    const dy = e.clientY - this._dragStartY;

    const newPoints = this._dragStartPoints!.map((p) => {
      const sx = this._chart!.timeScale().timeToCoordinate(p.time as Time);
      const sy = this._series!.priceToCoordinate(p.price);
      if (sx == null || sy == null) return { ...p };
      const nx = sx + dx;
      const ny = sy + dy;
      const t = this._chart!.timeScale().coordinateToTime(nx);
      const pr = this._series!.coordinateToPrice(ny);
      return {
        time: t != null ? Number(t) : p.time,
        price: pr != null ? pr : p.price,
      };
    });

    prim.updatePoints(newPoints);
  };

  private _handleDocPointerUp = () => {
    if (!this._dragId) return;
    if (this._dragStartPoints) {
      this._pushUndo();
      this._notifyChange();
    }
    this._dragId = null;
    this._dragStartPoints = null;
  };

  private _finalizeDrawing(
    type: string,
    points: DrawingPoint[],
    text?: string,
  ) {
    const drawing: Drawing = {
      id: this._genId(),
      type: type as Drawing["type"],
      points,
      style: {
        color: "#38bdf8",
        lineWidth: 2,
        opacity: 1,
      },
      text,
      createdAt: Date.now(),
    };
    this.addDrawing(drawing);
  }

  private _notifyChange() {
    this._onChange?.(this.getDrawings());
  }
}
