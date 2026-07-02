"use client";

import Link from "next/link";
import { usePrices } from "@/app/hooks/usePrices";
import { usePaperTrading } from "@/app/hooks/usePaperTrading";
import { StatCard } from "@/app/components/ui/StatCard";
import { Card, CardBody, CardHeader } from "@/app/components/ui/Card";
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
    desc: "Set intent, analyze markets, execute",
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

export default function DashboardOverview() {
  const { tickers, priceMap, loading: pricesLoading } = usePrices(MARKET_SYMBOLS);
  const { ready, balance, positions, trades, totalValue, unrealizedPnL } =
    usePaperTrading(priceMap);

  const totalReturn = totalValue - INITIAL_BALANCE;
  const totalReturnPct = (totalReturn / INITIAL_BALANCE) * 100;
  const loading = !ready;

  const movers = MARKET_SYMBOLS.map((s) => tickers[s]).filter(Boolean);
  const recentTrades = trades.slice(0, 6);

  return (
    <div className="space-y-6">
      {/* ── Stat strip ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Portfolio Value"
          loading={loading}
          value={formatUsd(totalValue)}
          sub={
            <span className={pnlColor(totalReturn)}>
              {formatSignedUsd(totalReturn)} ({formatPct(totalReturnPct)})
            </span>
          }
        />
        <StatCard label="Cash Balance" loading={loading} value={formatUsd(balance)} />
        <StatCard
          label="Unrealized PnL"
          loading={loading}
          value={formatSignedUsd(unrealizedPnL)}
          valueClassName={pnlColor(unrealizedPnL)}
        />
        <StatCard
          label="Open Positions"
          loading={loading}
          value={String(positions.length)}
        />
      </div>

      {/* ── Quick actions ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {QUICK_ACTIONS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="group rounded-2xl border border-border bg-bg-card p-5 transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <div className="flex items-center justify-between">
              <p className="font-display text-base font-semibold">{a.title}</p>
              <span className="text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent">
                →
              </span>
            </div>
            <p className="mt-1 text-sm text-text-muted">{a.desc}</p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ── Market overview ── */}
        <Card>
          <CardHeader
            title="Markets"
            action={
              <Badge tone="success" dot>
                Live
              </Badge>
            }
          />
          <CardBody className="pt-3">
            {pricesLoading && movers.length === 0 ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-11 animate-pulse rounded-lg bg-bg-elevated"
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                {movers.map((m) => {
                  const up = m.change24h >= 0;
                  return (
                    <Link
                      key={m.symbol}
                      href={`/dashboard/trade?symbol=${m.symbol}`}
                      className="flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:bg-bg-elevated"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold">
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
          </CardBody>
        </Card>

        {/* ── Recent trades ── */}
        <Card>
          <CardHeader
            title="Recent Trades"
            action={
              trades.length > 0 ? (
                <Link
                  href="/dashboard/history"
                  className="text-xs text-accent hover:underline"
                >
                  View all
                </Link>
              ) : undefined
            }
          />
          <CardBody className="pt-3">
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-11 animate-pulse rounded-lg bg-bg-elevated"
                  />
                ))}
              </div>
            ) : recentTrades.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <p className="text-sm text-text-secondary">No trades yet</p>
                <Link
                  href="/dashboard/trade"
                  className="text-sm text-accent underline underline-offset-2"
                >
                  Start trading →
                </Link>
              </div>
            ) : (
              <div className="space-y-1">
                {recentTrades.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between rounded-lg bg-bg-elevated px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <Badge tone={t.action === "BUY" ? "buy" : "sell"}>
                        {t.action}
                      </Badge>
                      <span className="font-mono text-xs font-medium">
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
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
