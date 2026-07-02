"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePrices } from "@/app/hooks/usePrices";
import { usePaperTrading } from "@/app/hooks/usePaperTrading";
import { Badge } from "@/app/components/ui/Badge";
import {
  baseAsset,
  formatPrice,
  formatNumber,
  formatPct,
  formatSignedUsd,
  formatTime,
  formatUsd,
  pnlColor,
} from "@/app/lib/format";

const MARKET_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "XLMUSDT",
  "SOLUSDT",
  "ADAUSDT",
  "XRPUSDT",
  "DOGEUSDT",
];

const INITIAL_BALANCE = 10000;

const QUICK_ACTIONS = [
  {
    href: "/dashboard/trade",
    title: "New Trade",
    desc: "Set intent, analyze, execute",
  },
  {
    href: "/dashboard/portfolio",
    title: "Portfolio",
    desc: "Track positions, PnL & allocation",
  },
  {
    href: "/dashboard/delegations",
    title: "Delegations",
    desc: "Manage smart wallets & policies",
  },
];

function EquitySparkline({
  trades,
}: {
  trades: { timestamp: number; pnl?: number }[];
}) {
  const pathData = useMemo(() => {
    const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
    if (sorted.length < 2) return null;
    const equity = sorted.reduce<number[]>((acc, t) => {
      acc.push((acc[acc.length - 1] ?? INITIAL_BALANCE) + (t.pnl ?? 0));
      return acc;
    }, []);
    const min = Math.min(...equity);
    const max = Math.max(...equity);
    const range = max - min || 1;
    const w = 200;
    const h = 48;
    const pad = 2;
    const coords = equity.map((v, i) => {
      const x = pad + (i / (equity.length - 1)) * (w - 2 * pad);
      const y = pad + ((max - v) / range) * (h - 2 * pad);
      return `${x},${y}`;
    });
    const up = equity[equity.length - 1] >= equity[0];
    return { points: coords.join(" "), w, h, up };
  }, [trades]);

  if (!pathData) return null;

  return (
    <svg width={pathData.w} height={pathData.h} className="shrink-0 opacity-25">
      <polyline
        points={pathData.points}
        fill="none"
        stroke={pathData.up ? "var(--color-success)" : "var(--color-error)"}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function DashboardOverview() {
  const { tickers, priceMap, loading: pricesLoading } = usePrices(MARKET_SYMBOLS);
  const { ready, balance, positions, trades, totalValue, unrealizedPnL } =
    usePaperTrading(priceMap);

  const totalReturn = totalValue - INITIAL_BALANCE;
  const totalReturnPct = (totalReturn / INITIAL_BALANCE) * 100;
  const loading = !ready;

  const movers = MARKET_SYMBOLS.map((s) => tickers[s]).filter(Boolean);
  const recentTrades = trades.slice(0, 5);

  return (
    <div className="space-y-5">
      {/* ── Hero: Portfolio Summary ── */}
      <div className="rounded-2xl card-glass card-glow p-7 transition-shadow duration-300">
        <div className="flex items-start justify-between">
          <div className="space-y-1.5">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
              Portfolio Value
            </p>
            {loading ? (
              <div className="h-10 w-44 animate-pulse rounded-md bg-bg-elevated/60" />
            ) : (
              <p className="font-display text-4xl font-bold tracking-tight text-text-primary tabular-nums transition-all duration-500">
                {formatUsd(totalValue)}
              </p>
            )}
            {!loading && (
              <p
                className={`font-mono text-xs font-medium tabular-nums ${pnlColor(totalReturn)}`}
              >
                {formatSignedUsd(totalReturn)} ({formatPct(totalReturnPct)})
              </p>
            )}
          </div>

          <div className="flex items-center gap-8 pt-1">
            <div className="text-right">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                Cash
              </p>
              <p className="mt-0.5 font-mono text-sm tabular-nums text-text-secondary">
                {loading ? "\u2014" : formatUsd(balance)}
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                Positions
              </p>
              <p className="mt-0.5 font-mono text-sm tabular-nums text-text-secondary">
                {loading ? "\u2014" : String(positions.length)}
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                Unreal. PnL
              </p>
              <p
                className={`mt-0.5 font-mono text-sm tabular-nums ${loading ? "text-text-secondary" : pnlColor(unrealizedPnL)}`}
              >
                {loading ? "\u2014" : formatSignedUsd(unrealizedPnL)}
              </p>
            </div>
          </div>
        </div>

        <div className="relative mt-5 flex justify-end">
          <EquitySparkline trades={trades} />
        </div>
      </div>

      {/* ── Quick Actions ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {QUICK_ACTIONS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="rounded-xl card-glass p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_40px_-8px_rgba(0,0,0,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          >
            <div className="flex items-center justify-between">
              <span className="font-display text-sm font-medium text-text-primary">
                {a.title}
              </span>
              <span className="text-xs text-text-muted transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-accent">
                →
              </span>
            </div>
            <p className="mt-0.5 text-xs text-text-muted/70">{a.desc}</p>
          </Link>
        ))}
      </div>

      {/* ── Data Panels ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Markets */}
        <div className="rounded-2xl card-glass p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-sm font-medium text-text-primary">
              Markets
            </h3>
            <Badge tone="success" dot>
              Live
            </Badge>
          </div>
          {pricesLoading && movers.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded-lg bg-bg-elevated/50"
                />
              ))}
            </div>
          ) : (
            <div className="space-y-0.5">
              {movers.map((m) => {
                const up = m.change24h >= 0;
                return (
                  <Link
                    key={m.symbol}
                    href={`/dashboard/trade?symbol=${m.symbol}`}
                    className="flex items-center justify-between rounded-lg px-3 py-2.5 transition-all duration-200 hover:bg-white/[0.03]"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-semibold text-text-primary">
                        {baseAsset(m.symbol)}
                      </span>
                      <span className="font-mono text-[10px] text-text-muted">
                        /USDT
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="font-mono text-xs tabular-nums text-text-secondary">
                        {formatPrice(m.price)}
                      </span>
                      <span
                        className={`w-16 text-right font-mono text-xs font-medium tabular-nums ${
                          up ? "text-success" : "text-error"
                        }`}
                      >
                        {formatPct(m.change24h)}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Trades */}
        <div className="rounded-2xl card-glass p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-sm font-medium text-text-primary">
              Recent Trades
            </h3>
            {trades.length > 0 && (
              <Link
                href="/dashboard/history"
                className="text-xs text-text-muted transition-colors duration-200 hover:text-text-secondary"
              >
                View all
              </Link>
            )}
          </div>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded-lg bg-bg-elevated/50"
                />
              ))}
            </div>
          ) : recentTrades.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <p className="text-sm text-text-muted">No trades yet</p>
              <Link
                href="/dashboard/trade"
                className="text-sm text-text-secondary underline underline-offset-2 transition-colors hover:text-text-primary"
              >
                Start trading →
              </Link>
            </div>
          ) : (
            <div className="space-y-0.5">
              {recentTrades.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2.5 transition-colors duration-200 hover:bg-white/[0.04]"
                >
                  <div className="flex items-center gap-2">
                    <Badge tone={t.action === "BUY" ? "buy" : "sell"}>
                      {t.action}
                    </Badge>
                    <span className="font-mono text-xs font-medium text-text-primary">
                      {baseAsset(t.symbol)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs tabular-nums text-text-secondary">
                      {formatNumber(t.amount)} @ {formatPrice(t.price)}
                    </span>
                    {t.pnl !== undefined && (
                      <span
                        className={`w-14 text-right font-mono text-xs font-medium tabular-nums ${pnlColor(
                          t.pnl
                        )}`}
                      >
                        {formatSignedUsd(t.pnl)}
                      </span>
                    )}
                    <span className="hidden font-mono text-[10px] text-text-muted sm:inline">
                      {formatTime(t.timestamp)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
