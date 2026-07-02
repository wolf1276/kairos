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

export class HorizontalLinePrimitive implements ISeriesPrimitiveBase<SeriesAttachedParameter<Time>> {
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
    const price = this._drawing.points[0]?.price;
    if (price == null) return [];
    return [
      {
        coordinate: () => this._series?.priceToCoordinate(price) ?? -1e9,
        text: () => price.toFixed(2),
        textColor: () => this._drawing.style.color,
        backColor: () => "#1e1e24",
        visible: () => this._isSelected,
        tickVisible: () => false,
      },
    ];
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [new HLinePaneView(this._drawing, this._series, this._chart, this._isSelected)];
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const price = this._drawing.points[0]?.price;
    if (price == null) return null;
    const yCoord = this._series?.priceToCoordinate(price);
    if (yCoord == null) return null;
    if (Math.abs(y - yCoord) <= 6) {
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

class HLinePaneView implements IPrimitivePaneView {
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
    const price = this._drawing.points[0]?.price;
    if (price == null) return null;
    const y = this._series?.priceToCoordinate(price);
    if (y == null) return null;
    const color = this._drawing.style.color;
    const lw = this._drawing.style.lineWidth;
    const sel = this._isSelected;

    return {
      draw(target) {
        target.useBitmapCoordinateSpace((scope) => {
          const ctx = scope.context;
          const width = ctx.canvas.width;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.strokeStyle = color;
          ctx.lineWidth = lw;
          ctx.stroke();

          if (sel) {
            ctx.beginPath();
            ctx.arc(width - 10, y, 5, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
          }
        });
      },
    };
  }
}
