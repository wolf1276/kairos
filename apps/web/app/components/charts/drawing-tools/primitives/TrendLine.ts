import type {
  ISeriesPrimitiveBase,
  SeriesAttachedParameter,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  PrimitiveHoveredItem,
  ISeriesPrimitiveAxisView,
  Time,
} from "lightweight-charts";
import type { Drawing, DrawingPoint } from "../types";
import { hitTestLine, hitTestPoint } from "../renderers/utils";

export class TrendLinePrimitive implements ISeriesPrimitiveBase<SeriesAttachedParameter<Time>> {
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

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    const p = this._drawing.points;
    if (p.length < 2) return [];
    return p.map((pt) => ({
      coordinate: () => this._series?.priceToCoordinate(pt.price) ?? -1e9,
      text: () => pt.price.toFixed(2),
      textColor: () => this._drawing.style.color,
      backColor: () => "#1e1e24",
      visible: () => this._isSelected,
      tickVisible: () => false,
    }));
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [new TrendLinePaneView(this._drawing, this._series, this._chart, this._isSelected)];
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const p = this._drawing.points;
    if (p.length < 2) return null;
    const x1 = this._chart?.timeScale().timeToCoordinate(p[0].time as Time);
    const y1 = this._series?.priceToCoordinate(p[0].price);
    const x2 = this._chart?.timeScale().timeToCoordinate(p[1].time as Time);
    const y2 = this._series?.priceToCoordinate(p[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return null;

    if (hitTestPoint(x, y, x1, y1, 8) || hitTestPoint(x, y, x2, y2, 8)) {
      return {
        externalId: this._drawing.id,
        zOrder: "top" as const,
        distance: 0,
        hitTestPriority: 2,
        cursorStyle: "grab",
      };
    }
    if (hitTestLine(x1, y1, x2, y2, x, y, 6)) {
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

class TrendLinePaneView implements IPrimitivePaneView {
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
    const p = this._drawing.points;
    if (p.length < 2) return null;
    const x1 = this._chart?.timeScale().timeToCoordinate(p[0].time as Time);
    const y1 = this._series?.priceToCoordinate(p[0].price);
    const x2 = this._chart?.timeScale().timeToCoordinate(p[1].time as Time);
    const y2 = this._series?.priceToCoordinate(p[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return null;
    const color = this._drawing.style.color;
    const lw = this._drawing.style.lineWidth;
    const sel = this._isSelected;

    return {
      draw(target) {
        target.useBitmapCoordinateSpace((scope) => {
          const ctx = scope.context;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.strokeStyle = color;
          ctx.lineWidth = lw;
          ctx.stroke();

          if (sel) {
            ctx.beginPath();
            ctx.arc(x1, y1, 5, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(x2, y2, 5, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
          }
        });
      },
    };
  }
}
