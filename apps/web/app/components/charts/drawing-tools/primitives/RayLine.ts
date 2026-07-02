import type {
  ISeriesPrimitiveBase,
  SeriesAttachedParameter,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  PrimitiveHoveredItem,
  Time,
} from "lightweight-charts";
import type { Drawing, DrawingPoint } from "../types";
import { hitTestPoint, hitTestLine } from "../renderers/utils";

export class RayLinePrimitive implements ISeriesPrimitiveBase<SeriesAttachedParameter<Time>> {
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
    return [new RayLinePaneView(this._drawing, this._series, this._chart, this._isSelected)];
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const p = this._drawing.points;
    if (p.length < 2) return null;
    const x1 = this._chart?.timeScale().timeToCoordinate(p[0].time as Time);
    const y1 = this._series?.priceToCoordinate(p[0].price);
    const x2 = this._chart?.timeScale().timeToCoordinate(p[1].time as Time);
    const y2 = this._series?.priceToCoordinate(p[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return null;

    if (hitTestPoint(x, y, x1, y1, 8)) {
      return {
        externalId: this._drawing.id,
        zOrder: "top" as const,
        distance: 0,
        hitTestPriority: 2,
        cursorStyle: "grab",
      };
    }

    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0) {
      if (Math.abs(x - x1) <= 6) {
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

    const width = 3000;
    const ex = x1 + (dx > 0 ? width : -width);
    const ey = y1 + (dy / dx) * (ex - x1);
    if (hitTestLine(x1, y1, ex, ey, x, y, 6)) {
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

class RayLinePaneView implements IPrimitivePaneView {
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

    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0) return null;

    const color = this._drawing.style.color;
    const lw = this._drawing.style.lineWidth;
    const sel = this._isSelected;
    const width = 3000;
    const ex = x1 + (dx > 0 ? width : -width);
    const ey = y1 + (dy / dx) * (ex - x1);

    return {
      draw(target) {
        target.useBitmapCoordinateSpace((scope) => {
          const ctx = scope.context;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(ex, ey);
          ctx.strokeStyle = color;
          ctx.lineWidth = lw;
          ctx.stroke();

          if (sel) {
            ctx.beginPath();
            ctx.arc(x1, y1, 5, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
          }
        });
      },
    };
  }
}
