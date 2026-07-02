"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Segmented } from "@/app/components/ui/Segmented";
import { formatPrice, formatPct } from "@/app/lib/format";

interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

type Interval = "15m" | "1h" | "4h" | "1d";

const INTERVALS: { value: Interval; label: string }[] = [
  { value: "15m", label: "15m" },
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
  { value: "1d", label: "1D" },
];

export function PriceChart({ symbol, height = 288 }: { symbol: string; height?: number }) {
  const [interval, setInterval_] = useState<Interval>("1h");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    const fetchCandles = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/klines?symbol=${symbol}&interval=${interval}&limit=120`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: Candle[] = await res.json();
        if (alive) setCandles(data);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    };

    fetchCandles();
    const id = window.setInterval(fetchCandles, 30000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [symbol, interval]);

  const { data, first, last, changePct, up } = useMemo(() => {
    const d = candles.map((c) => ({ t: c.openTime, price: c.close }));
    const f = d[0]?.price ?? 0;
    const l = d[d.length - 1]?.price ?? 0;
    const chg = f ? ((l - f) / f) * 100 : 0;
    return { data: d, first: f, last: l, changePct: chg, up: l >= f };
  }, [candles]);

  const stroke = up ? "#34d399" : "#ef4444";
  const timeFmt = (t: number) =>
    new Date(t).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: interval === "1d" ? undefined : "2-digit",
      ...(interval === "1d" ? { month: "short", day: "numeric" } : {}),
    });

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
            {symbol}
          </p>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold tabular-nums">
              {loading && !last ? "—" : formatPrice(last)}
            </span>
            {!!first && (
              <span
                className={`font-mono text-xs font-medium tabular-nums ${
                  up ? "text-success" : "text-error"
                }`}
              >
                {formatPct(changePct)}
              </span>
            )}
          </div>
        </div>
        <Segmented
          size="sm"
          options={INTERVALS}
          value={interval}
          onChange={setInterval_}
          className="shrink-0"
        />
      </div>

      {error ? (
        <div
          className="flex items-center justify-center rounded-xl bg-bg-elevated"
          style={{ height }}
        >
          <p className="text-sm text-text-muted">Failed to load chart · {error}</p>
        </div>
      ) : loading && data.length === 0 ? (
        <div
          className="animate-pulse rounded-xl bg-bg-elevated"
          style={{ height }}
        />
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id={`grad-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#2a2a2e" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="t"
              tickFormatter={timeFmt}
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
              width={56}
              tickFormatter={(v) => formatPrice(v).replace("$", "")}
              orientation="right"
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
              formatter={(v) => [formatPrice(Number(v)), "Price"]}
            />
            <Area
              type="monotone"
              dataKey="price"
              stroke={stroke}
              strokeWidth={2}
              fill={`url(#grad-${symbol})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
