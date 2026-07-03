"use client";

import { memo } from "react";

interface MiniSparklineProps {
  data: { t: number; v: number }[];
  width?: number;
  height?: number;
  className?: string;
  strokeWidth?: number;
}

export function MiniSparkline({
  data,
  width = 120,
  height = 40,
  className = "",
  strokeWidth = 1.5,
}: MiniSparklineProps) {
  if (data.length < 2) return null;

  const values = data.map((s) => s.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padding = 2;

  const points = data
    .map((s, i) => {
      const x = padding + (i / (data.length - 1)) * (width - padding * 2);
      const y = padding + (1 - (s.v - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  const up = values[values.length - 1] >= values[0];
  const color = up ? "var(--success)" : "var(--error)";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={`spark-gradient-${width}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={up ? "var(--success)" : "var(--error)"} stopOpacity="0.3" />
          <stop offset="100%" stopColor={up ? "var(--success)" : "var(--error)"} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default memo(MiniSparkline);
