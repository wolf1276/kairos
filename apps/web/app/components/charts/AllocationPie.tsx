"use client";

import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatUsd } from "@/app/lib/format";
import { baseAsset } from "@/app/lib/format";

// Accent-forward palette; cash is a muted slate so holdings stand out.
const COLORS = ["#7851e9", "#34d399", "#f59e0b", "#38bdf8", "#f472b6", "#a78bfa"];
const CASH_COLOR = "#3f3f46";

export function AllocationPie({
  cash,
  positions,
  height = 200,
}: {
  cash: number;
  positions: { symbol: string; value: number }[];
  height?: number;
}) {
  const data = useMemo(() => {
    const holdings = positions
      .filter((p) => p.value > 0)
      .map((p) => ({ name: baseAsset(p.symbol), value: Number(p.value.toFixed(2)) }));
    const slices = [{ name: "Cash", value: Number(Math.max(cash, 0).toFixed(2)) }, ...holdings];
    return slices.filter((s) => s.value > 0);
  }, [cash, positions]);

  const total = data.reduce((s, d) => s + d.value, 0);

  if (total <= 0) {
    return (
      <div
        className="flex items-center justify-center rounded-xl bg-bg-elevated"
        style={{ height }}
      >
        <p className="text-sm text-text-muted">No allocation data</p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width="55%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={"58%"}
            outerRadius={"90%"}
            paddingAngle={2}
            stroke="none"
            isAnimationActive={false}
          >
            {data.map((entry, i) => (
              <Cell
                key={entry.name}
                fill={entry.name === "Cash" ? CASH_COLOR : COLORS[i % COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: "#1e1e24",
              border: "1px solid #2a2a2e",
              borderRadius: 12,
              fontSize: 12,
            }}
            formatter={(v, n) => [formatUsd(Number(v)), String(n)]}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Legend with values (accessible text alternative to color) */}
      <ul className="flex-1 space-y-2">
        {data.map((entry, i) => (
          <li key={entry.name} className="flex items-center gap-2 text-xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{
                background: entry.name === "Cash" ? CASH_COLOR : COLORS[i % COLORS.length],
              }}
            />
            <span className="text-text-secondary">{entry.name}</span>
            <span className="ml-auto font-mono tabular-nums text-text-primary">
              {((entry.value / total) * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
