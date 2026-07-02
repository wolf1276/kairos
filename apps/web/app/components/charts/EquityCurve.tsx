"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Trade } from "@/lib/paper-trading";
import { formatUsd } from "@/app/lib/format";

/**
 * Reconstructs an equity curve from realized PnL over time.
 * equity(t) = initialBalance + Σ realized pnl up to t.
 * A final live point folds in current unrealized PnL when provided.
 */
export function EquityCurve({
  trades,
  initialBalance = 10000,
  liveEquity,
  height = 200,
}: {
  trades: Trade[];
  initialBalance?: number;
  liveEquity?: number;
  height?: number;
}) {
  const data = useMemo(() => {
    const chronological = [...trades].sort((a, b) => a.timestamp - b.timestamp);
    const points: { t: number; equity: number }[] = [];
    let equity = initialBalance;

    if (chronological.length > 0) {
      points.push({ t: chronological[0].timestamp - 1, equity });
    }
    let lastTs = 0;
    for (const trade of chronological) {
      equity += trade.pnl ?? 0;
      lastTs = trade.timestamp;
      points.push({ t: trade.timestamp, equity: Number(equity.toFixed(2)) });
    }
    // Fold current unrealized PnL into a trailing "now" point (just after the
    // last trade, to keep the x-axis monotonic without an impure Date.now()).
    if (liveEquity !== undefined && chronological.length > 0) {
      points.push({ t: lastTs + 60000, equity: Number(liveEquity.toFixed(2)) });
    }
    return points;
  }, [trades, initialBalance, liveEquity]);

  if (data.length < 2) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-1 rounded-xl bg-bg-elevated text-center"
        style={{ height }}
      >
        <p className="text-sm text-text-secondary">No equity history yet</p>
        <p className="text-xs text-text-muted">
          Close a position to start building your curve
        </p>
      </div>
    );
  }

  const last = data[data.length - 1].equity;
  const up = last >= initialBalance;
  const stroke = up ? "#34d399" : "#ef4444";

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="equity-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#2a2a2e" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="t"
          tickFormatter={(t) =>
            new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })
          }
          tick={{ fill: "#6b6a66", fontSize: 10, fontFamily: "monospace" }}
          tickLine={false}
          axisLine={false}
          minTickGap={48}
        />
        <YAxis
          domain={["auto", "auto"]}
          tick={{ fill: "#6b6a66", fontSize: 10, fontFamily: "monospace" }}
          tickLine={false}
          axisLine={false}
          width={64}
          orientation="right"
          tickFormatter={(v) => formatUsd(v, { compact: true }).replace("$", "")}
        />
        <Tooltip
          contentStyle={{
            background: "#1e1e24",
            border: "1px solid #2a2a2e",
            borderRadius: 12,
            fontSize: 12,
          }}
          labelStyle={{ color: "#a8a6a2" }}
          labelFormatter={(t) => new Date(t as number).toLocaleString()}
          formatter={(v) => [formatUsd(Number(v)), "Equity"]}
        />
        <Area
          type="monotone"
          dataKey="equity"
          stroke={stroke}
          strokeWidth={2}
          fill="url(#equity-grad)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
