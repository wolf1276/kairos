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

export class VerticalLinePrimitive implements ISeriesPrimitiveBase<SeriesAttachedParameter<Time>> {
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

  timeAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    const time = this._drawing.points[0]?.time;
    if (time == null) return [];
    return [
      {
        coordinate: () => {
          const coord = this._chart?.timeScale().timeToCoordinate(time as Time);
          return coord ?? -1e9;
        },
        text: () => {
          const d = new Date(time * 1000);
          return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        },
        textColor: () => this._drawing.style.color,
        backColor: () => "#1e1e24",
        visible: () => this._isSelected,
        tickVisible: () => false,
      },
    ];
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [new VLinePaneView(this._drawing, this._series, this._chart, this._isSelected)];
  }

  hitTest(x: number, _y: number): PrimitiveHoveredItem | null {
    void _y;
    const time = this._drawing.points[0]?.time;
    if (time == null) return null;
    const xCoord = this._chart?.timeScale().timeToCoordinate(time as Time);
    if (xCoord == null) return null;
    if (Math.abs(x - xCoord) <= 6) {
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

class VLinePaneView implements IPrimitivePaneView {
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
    const time = this._drawing.points[0]?.time;
    if (time == null) return null;
    const x = this._chart?.timeScale().timeToCoordinate(time as Time);
    if (x == null) return null;
    const color = this._drawing.style.color;
    const lw = this._drawing.style.lineWidth;
    const sel = this._isSelected;

    return {
      draw(target) {
        target.useBitmapCoordinateSpace((scope) => {
          const ctx = scope.context;
          const height = ctx.canvas.height;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.strokeStyle = color;
          ctx.lineWidth = lw;
          ctx.stroke();

          if (sel) {
            ctx.beginPath();
            ctx.arc(x, 10, 5, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
          }
        });
      },
    };
  }
}
