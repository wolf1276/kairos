import type {
  ISeriesPrimitiveBase,
  SeriesAttachedParameter,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  PrimitiveHoveredItem,
  Time,
} from "lightweight-charts";
import type { Drawing, DrawingPoint } from "../types";

export class TextAnnotationPrimitive implements ISeriesPrimitiveBase<SeriesAttachedParameter<Time>> {
  private _chart: SeriesAttachedParameter<Time>["chart"] | null = null;
  private _series: SeriesAttachedParameter<Time>["series"] | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _drawing: Drawing;
  private _isSelected = false;

  constructor(drawing: Drawing) {
    this._drawing = drawing;
  }

  getDrawing(): Drawing {
    return this._drawing;
  }

  setSelected(selected: boolean) {
    this._isSelected = selected;
    this._requestUpdate?.();
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this._chart = param.chart;
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }

  updatePoints(points: DrawingPoint[]) {
    this._drawing.points = points;
    this._requestUpdate?.();
  }

  updateAllViews(): void {}

  paneViews(): readonly IPrimitivePaneView[] {
    return [new TextPaneView(this._drawing, this._series, this._chart, this._isSelected)];
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const pt = this._drawing.points[0];
    if (!pt) return null;
    const cx = this._chart?.timeScale().timeToCoordinate(pt.time as Time);
    const cy = this._series?.priceToCoordinate(pt.price);
    if (cx == null || cy == null) return null;

    const text = this._drawing.text ?? "";
    const w = Math.max(text.length * 8, 20);
    const h = 24;
    if (x >= cx - 4 && x <= cx + w + 4 && y >= cy - h && y <= cy + 4) {
      return {
        externalId: this._drawing.id,
        zOrder: "top" as const,
        distance: 0,
        hitTestPriority: 1,
        cursorStyle: "pointer",
      };
    }
    return null;
  }
}

class TextPaneView implements IPrimitivePaneView {
  constructor(
    private _drawing: Drawing,
    private _series: SeriesAttachedParameter<Time>["series"] | null,
    private _chart: SeriesAttachedParameter<Time>["chart"] | null,
    private _isSelected: boolean,
  ) {}

  zOrder() {
    return "top" as const;
  }

  renderer(): IPrimitivePaneRenderer | null {
    const pt = this._drawing.points[0];
    if (!pt) return null;
    const cx = this._chart?.timeScale().timeToCoordinate(pt.time as Time);
    const cy = this._series?.priceToCoordinate(pt.price);
    if (cx == null || cy == null) return null;
    const text = this._drawing.text ?? "";
    const color = this._drawing.style.color;

    return {
      draw(target) {
        target.useBitmapCoordinateSpace((scope) => {
          const ctx = scope.context;
          ctx.font = "12px 'JetBrains Mono', monospace";
          const m = ctx.measureText(text);
          const pad = 6;
          const bx = cx - 2;
          const by = cy - m.actualBoundingBoxAscent - pad;

          ctx.fillStyle = "rgba(18, 18, 22, 0.85)";
          ctx.fillRect(bx, by, m.width + pad * 2, m.actualBoundingBoxAscent + pad * 2);

          ctx.fillStyle = color;
          ctx.textBaseline = "bottom";
          ctx.fillText(text, bx + pad, by + m.actualBoundingBoxAscent + pad);
        });
      },
    };
  }
}
