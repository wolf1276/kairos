import type {
  ISeriesPrimitiveBase,
  SeriesAttachedParameter,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  PrimitiveHoveredItem,
  Time,
} from "lightweight-charts";
import type { Drawing, DrawingPoint } from "../types";

const FIB_LEVELS = [
  { key: "0", level: 0, color: "#6b7280" },
  { key: "0.236", level: 0.236, color: "#f59e0b" },
  { key: "0.382", level: 0.382, color: "#f59e0b" },
  { key: "0.5", level: 0.5, color: "#e2e8f0" },
  { key: "0.618", level: 0.618, color: "#06b6d4" },
  { key: "0.786", level: 0.786, color: "#06b6d4" },
  { key: "1", level: 1, color: "#6b7280" },
];

const EXT_LEVELS = [
  { key: "1.272", level: 1.272, color: "#8b5cf6" },
  { key: "1.618", level: 1.618, color: "#8b5cf6" },
  { key: "2.618", level: 2.618, color: "#8b5cf6" },
];

interface FibLine {
  y: number;
  label: string;
  color: string;
  bgColor: string;
}

export class FibonacciPrimitive implements ISeriesPrimitiveBase<SeriesAttachedParameter<Time>> {
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
    return [new FibPaneView(this._drawing, this._series, this._chart, this._isSelected)];
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const lines = this._getLines();
    for (const line of lines) {
      if (Math.abs(y - line.y) <= 6) {
        return {
          externalId: this._drawing.id,
          zOrder: "top" as const,
          distance: 0,
          hitTestPriority: 1,
          cursorStyle: "pointer",
        };
      }
    }
    return null;
  }

  private _getLines(): FibLine[] {
    const p = this._drawing.points;
    if (p.length < 2) return [];
    const p0 = this._series?.priceToCoordinate(p[0].price);
    const p1 = this._series?.priceToCoordinate(p[1].price);
    if (p0 == null || p1 == null) return [];

    const priceLow = Math.min(p[0].price, p[1].price);
    const priceHigh = Math.max(p[0].price, p[1].price);
    const range = priceHigh - priceLow;
    if (range === 0) return [];

    const lines: FibLine[] = [];

    // Retracement levels: between 0 and 1
    for (const fl of FIB_LEVELS) {
      const price = priceLow + fl.level * range;
      const y = this._series?.priceToCoordinate(price);
      if (y == null) continue;
      lines.push({
        y,
        label: `${fl.key} (${price.toFixed(2)})`,
        color: fl.color,
        bgColor: "rgba(107, 114, 128, 0.06)",
      });
    }

    // Extension levels: beyond 1 (above high) and below 0 (below low)
    for (const fl of EXT_LEVELS) {
      const price = priceLow + fl.level * range;
      const y = this._series?.priceToCoordinate(price);
      if (y == null) continue;
      lines.push({
        y,
        label: `${fl.key} (${price.toFixed(2)})`,
        color: fl.color,
        bgColor: "rgba(139, 92, 246, 0.06)",
      });
    }

    return lines;
  }
}

class FibPaneView implements IPrimitivePaneView {
  constructor(
    private _drawing: Drawing,
    private _series: SeriesAttachedParameter<Time>["series"] | null,
    private _chart: SeriesAttachedParameter<Time>["chart"] | null,
    private _isSelected: boolean,
  ) {}

  zOrder() {
    return "normal" as const;
  }

  renderer(): IPrimitivePaneRenderer | null {
    const p = this._drawing.points;
    if (p.length < 2) return null;
    const p0 = this._series?.priceToCoordinate(p[0].price);
    const p1 = this._series?.priceToCoordinate(p[1].price);
    if (p0 == null || p1 == null) return null;

    const priceLow = Math.min(p[0].price, p[1].price);
    const priceHigh = Math.max(p[0].price, p[1].price);
    const range = priceHigh - priceLow;
    if (range === 0) return null;

    const allLevels = [...FIB_LEVELS, ...EXT_LEVELS];
    type ComputedLevel = { y: number; key: string; label: string; color: string; bgColor: string };
    const computed: ComputedLevel[] = [];

    for (const fl of allLevels) {
      const price = priceLow + fl.level * range;
      const y = this._series?.priceToCoordinate(price);
      if (y == null) continue;
      const isExt = EXT_LEVELS.includes(fl);
      computed.push({
        y,
        key: fl.key,
        label: `${fl.key} (${price.toFixed(2)})`,
        color: fl.color,
        bgColor: isExt ? "rgba(139, 92, 246, 0.06)" : "rgba(107, 114, 128, 0.06)",
      });
    }

    if (computed.length === 0) return null;

    return {
      draw(target) {
        target.useBitmapCoordinateSpace((scope) => {
          const ctx = scope.context;
          const width = ctx.canvas.width;

          // Draw background fills between levels
          for (let i = 0; i < computed.length - 1; i++) {
            const top = computed[i].y;
            const bottom = computed[i + 1].y;
            ctx.fillStyle = computed[i].bgColor;
            ctx.fillRect(0, Math.min(top, bottom), width, Math.abs(bottom - top));
          }

          // Draw level lines + labels
          ctx.font = "10px 'JetBrains Mono', monospace";
          for (const c of computed) {
            ctx.beginPath();
            ctx.moveTo(0, c.y);
            ctx.lineTo(width, c.y);
            ctx.strokeStyle = c.color;
            ctx.lineWidth = 1;
            ctx.stroke();

            const label = c.label;
            const m = ctx.measureText(label);
            const lx = width - m.width - 6;
            const ly = c.y - 8;

            ctx.fillStyle = "rgba(18, 18, 22, 0.85)";
            ctx.fillRect(lx - 2, ly - 2, m.width + 8, 16);

            ctx.fillStyle = c.color;
            ctx.textBaseline = "bottom";
            ctx.fillText(label, lx + 2, ly + 14);
          }
        });
      },
    };
  }
}
