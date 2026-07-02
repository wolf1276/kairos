"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface PortfolioSummary {
  balance: number;
  totalValue: number;
  unrealizedPnL: number;
  positionsCount: number;
}

interface RecentTrade {
  id: string;
  symbol: string;
  action: string;
  amount: number;
  price: number;
  timestamp: number;
  pnl?: number;
}

export default function DashboardOverview() {
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [portfolioRes, tradesRes] = await Promise.all([
        fetch("/api/portfolio"),
        fetch("/api/trades"),
      ]);
      if (portfolioRes.ok) {
        const data = await portfolioRes.json();
        setSummary({
          balance: data.balance ?? 0,
          totalValue: data.totalValue ?? 0,
          unrealizedPnL: data.unrealizedPnL ?? 0,
          positionsCount: data.positions?.length ?? 0,
        });
      }
      if (tradesRes.ok) {
        const data = await tradesRes.json();
        setRecentTrades(data.slice(0, 5));
      }
    } catch {
      // API not available yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const pnlColor = (val: number) =>
    val >= 0 ? "text-success" : "text-error";

  return (
    <div className="space-y-6">
      {/* ── Hero stat strip ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-border bg-bg-card p-5">
          <p className="font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">
            Balance
          </p>
          <p className="mt-1 font-display text-2xl font-bold tracking-tight">
            {loading ? "—" : `$${summary?.balance.toFixed(2) ?? "0.00"}`}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-bg-card p-5">
          <p className="font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">
            Portfolio Value
          </p>
          <p className="mt-1 font-display text-2xl font-bold tracking-tight">
            {loading ? "—" : `$${summary?.totalValue.toFixed(2) ?? "0.00"}`}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-bg-card p-5">
          <p className="font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">
            Unrealized PnL
          </p>
          <p
            className={`mt-1 font-display text-2xl font-bold tracking-tight ${
              summary ? pnlColor(summary.unrealizedPnL) : ""
            }`}
          >
            {loading
              ? "—"
              : `${
                  summary && summary.unrealizedPnL >= 0 ? "+" : ""
                }$${summary?.unrealizedPnL.toFixed(2) ?? "0.00"}`}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-bg-card p-5">
          <p className="font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">
            Open Positions
          </p>
          <p className="mt-1 font-display text-2xl font-bold tracking-tight">
            {loading ? "—" : String(summary?.positionsCount ?? 0)}
          </p>
        </div>
      </div>

      {/* ── Quick actions ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Link
          href="/dashboard/trade"
          className="group rounded-2xl border border-border bg-bg-card p-5 transition-colors hover:border-accent/40"
        >
          <p className="font-display text-base font-semibold">New Trade</p>
          <p className="mt-1 text-sm text-text-muted">
            Set intent, analyze markets, execute trades
          </p>
        </Link>
        <Link
          href="/dashboard/portfolio"
          className="group rounded-2xl border border-border bg-bg-card p-5 transition-colors hover:border-accent/40"
        >
          <p className="font-display text-base font-semibold">Portfolio</p>
          <p className="mt-1 text-sm text-text-muted">
            Track positions, PnL, and performance
          </p>
        </Link>
        <Link
          href="/dashboard/delegations"
          className="group rounded-2xl border border-border bg-bg-card p-5 transition-colors hover:border-accent/40"
        >
          <p className="font-display text-base font-semibold">Delegations</p>
          <p className="mt-1 text-sm text-text-muted">
            Manage smart wallets and delegation policies
          </p>
        </Link>
      </div>

      {/* ── Recent trades ── */}
      <div className="rounded-2xl border border-border bg-bg-card p-5">
        <h3 className="mb-4 font-display text-base font-semibold">
          Recent Trades
        </h3>
        {loading ? (
          <p className="text-sm text-text-muted">Loading...</p>
        ) : recentTrades.length === 0 ? (
          <p className="text-sm text-text-muted">
            No trades yet.{" "}
            <Link
              href="/dashboard/trade"
              className="text-accent underline underline-offset-2"
            >
              Start trading →
            </Link>
          </p>
        ) : (
          <div className="space-y-1">
            {recentTrades.map((trade) => (
              <div
                key={trade.id}
                className="flex items-center justify-between rounded-lg bg-bg-elevated px-4 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      trade.action === "BUY" ? "bg-emerald-400" : "bg-red-400"
                    }`}
                  />
                  <span className="font-mono text-xs font-medium">
                    {trade.symbol}
                  </span>
                  <span
                    className={`text-xs ${
                      trade.action === "BUY"
                        ? "text-emerald-400"
                        : "text-red-400"
                    }`}
                  >
                    {trade.action}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-text-secondary">
                    {trade.amount.toFixed(4)} @ ${trade.price.toFixed(4)}
                  </span>
                  {trade.pnl !== undefined && (
                    <span
                      className={`text-xs font-medium ${
                        trade.pnl >= 0 ? "text-success" : "text-error"
                      }`}
                    >
                      {trade.pnl >= 0 ? "+" : ""}
                      {trade.pnl.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
