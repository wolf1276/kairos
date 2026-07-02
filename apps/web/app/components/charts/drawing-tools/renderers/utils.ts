export function drawLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  lineWidth: number,
) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

export function drawDashedLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  lineWidth: number,
) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: string,
  fill?: string,
) {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

export function hitTestPoint(
  px: number,
  py: number,
  x: number,
  y: number,
  threshold = 8,
): boolean {
  return Math.abs(px - x) <= threshold && Math.abs(py - y) <= threshold;
}

export function hitTestLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  mx: number,
  my: number,
  threshold = 6,
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return Math.abs(mx - x1) <= threshold && Math.abs(my - y1) <= threshold;
  const t = Math.max(0, Math.min(1, ((mx - x1) * dx + (my - y1) * dy) / (len * len)));
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  return Math.abs(mx - px) <= threshold && Math.abs(my - py) <= threshold;
}
