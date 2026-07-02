"use client";

import { useEffect, useState } from "react";

export function ConfidenceRing({
  value,
  size = 72,
  strokeWidth = 5,
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
}) {
  const [animated, setAnimated] = useState(0);
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;

  useEffect(() => {
    const raf = requestAnimationFrame(() => setAnimated(value));
    return () => cancelAnimationFrame(raf);
  }, [value]);

  const offset = circ * (1 - animated / 100);
  const color =
    value >= 70 ? "#34d399" : value >= 45 ? "#f59e0b" : "#ef4444";

  return (
    <svg width={size} height={size} aria-label={`Confidence ${Math.round(value)}%`}>
      <defs>
        <filter id="ring-glow">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          filter="url(#ring-glow)"
          style={{ transition: "stroke-dashoffset 0.7s ease-out" }}
        />
      </g>
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fill="currentColor"
        className="text-text-primary"
        style={{
          fontSize: size * 0.22,
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 600,
        }}
      >
        {Math.round(value)}%
      </text>
    </svg>
  );
}
