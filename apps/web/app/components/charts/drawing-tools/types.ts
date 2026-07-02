export type ToolMode =
  | "select"
  | "trend_line"
  | "horizontal_line"
  | "vertical_line"
  | "ray_line"
  | "text"
  | "fib_retracement";

export type DrawingType = ToolMode & string;

export interface DrawingPoint {
  time: number;
  price: number;
}

export interface DrawingStyle {
  color: string;
  lineWidth: number;
  opacity: number;
}

export interface Drawing {
  id: string;
  type: DrawingType;
  points: DrawingPoint[];
  style: DrawingStyle;
  text?: string;
  createdAt: number;
}

export interface DrawingState {
  drawings: Drawing[];
  selectedId: string | null;
}

export interface UndoEntry {
  drawings: Drawing[];
  selectedId: string | null;
}
