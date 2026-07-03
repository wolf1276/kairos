"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";

interface AllocationChartProps {
  assets: { label: string; value: number; color: string }[];
  total: number;
}

export function AllocationChart({ assets, total }: AllocationChartProps) {
  const cumulative = assets.reduce((acc, a) => [...acc, acc[acc.length - 1] + a.value], [0, 0] as number[]);

  const size = 160;
  const center = size / 2;
  const radius = 60;
  const strokeWidth = 20;

  const getCoordinatesForPercent = (percent: number) => {
    const x = center + radius * Math.cos(2 * Math.PI * percent);
    const y = center + radius * Math.sin(2 * Math.PI * percent);
    return { x, y };
  };

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-bg-card p-5">
      <h3 className="font-display text-sm font-medium text-text-primary mb-4">Portfolio Allocation</h3>
      <div className="flex items-center gap-6">
        <div className="relative">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {assets.map((asset, i) => {
              const startPercent = cumulative[i] / total;
              const endPercent = cumulative[i + 1] / total;
              const start = getCoordinatesForPercent(startPercent);
              const end = getCoordinatesForPercent(endPercent);
              const largeArcFlag = endPercent - startPercent > 0.5 ? 1 : 0;
              const pathData = [
                `M ${center} ${center}`,
                `L ${start.x} ${start.y}`,
                `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`,
                "Z",
              ].join(" ");

              return (
                <path
                  key={i}
                  d={pathData}
                  fill={asset.color}
                  opacity={0.85}
                  className="transition-all duration-300 hover:opacity-100"
                />
              );
            })}
            <circle cx={center} cy={center} r={radius - strokeWidth} fill="var(--bg-card)" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-[10px] uppercase tracking-wider text-text-muted">Total</p>
            <p className="font-mono text-xs font-medium text-text-primary">${total.toLocaleString()}</p>
          </div>
        </div>

        <div className="flex-1 space-y-2.5">
          {assets.map((asset, i) => {
            const pct = ((asset.value / total) * 100).toFixed(1);
            return (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: asset.color }} />
                  <span className="text-xs text-text-secondary">{asset.label}</span>
                </div>
                <div className="text-right">
                  <span className="font-mono text-xs text-text-primary tabular-nums">{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default memo(AllocationChart);
