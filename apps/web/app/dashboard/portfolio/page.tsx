"use client";

import { useState, useEffect, useCallback } from "react";

interface Position {
  symbol: string;
  amount: number;
  entryPrice: number;
  currentPrice?: number;
  pnl?: number;
}

interface PortfolioData {
  balance: number;
  totalValue: number;
  unrealizedPnL: number;
  positions: Position[];
}

interface TradeRecord {
  id: string;
  symbol: string;
  action: string;
  amount: number;
  price: number;
  timestamp: number;
  pnl?: number;
}

export default function PortfolioPage() {
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPortfolio = useCallback(async () => {
    try {
      const res = await fetch("/api/portfolio");
      if (res.ok) {
        const d = await res.json();
        setPortfolio(d);
      }
    } catch {
      // noop
    }
  }, []);

  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch("/api/trades");
      if (res.ok) {
        const d = await res.json();
        setTrades(d);
      }
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchPortfolio(), fetchTrades()]).finally(() =>
      setLoading(false)
    );
  }, [fetchPortfolio, fetchTrades]);

  useEffect(() => {
    const interval = setInterval(fetchPortfolio, 30000);
    return () => clearInterval(interval);
  }, [fetchPortfolio]);

  const pnlColor = (val: number) =>
    val >= 0 ? "text-success" : "text-error";

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* ── Portfolio summary ── */}
      <div className="rounded-2xl border border-border bg-bg-card p-5">
        <h3 className="mb-4 font-display text-base font-semibold">
          Portfolio
        </h3>
        {loading ? (
          <p className="text-sm text-text-muted">Loading...</p>
        ) : portfolio ? (
          <div className="space-y-3">
            <div className="rounded-xl bg-bg-elevated p-4">
              <p className="font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">
                Balance
              </p>
              <p className="mt-1 font-display text-3xl font-bold tracking-tight">
                ${portfolio.balance.toFixed(2)}
              </p>
            </div>

            <div className="flex gap-3">
              <div className="flex-1 rounded-xl bg-bg-elevated p-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-text-muted">
                  Total Value
                </p>
                <p className="mt-1 font-display text-xl font-bold">
                  ${portfolio.totalValue.toFixed(2)}
                </p>
              </div>
              <div className="flex-1 rounded-xl bg-bg-elevated p-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-text-muted">
                  Unrealized PnL
                </p>
                <p
                  className={`mt-1 font-display text-xl font-bold ${pnlColor(portfolio.unrealizedPnL)}`}
                >
                  {portfolio.unrealizedPnL >= 0 ? "+" : ""}
                  {portfolio.unrealizedPnL.toFixed(2)}
                </p>
              </div>
            </div>

            {/* Positions */}
            {portfolio.positions.length > 0 && (
              <div>
                <p className="mb-2 font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">
                  Positions
                </p>
                <div className="space-y-1">
                  {portfolio.positions.map((pos, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-lg bg-bg-elevated px-4 py-2.5"
                    >
                      <span className="font-mono text-xs font-medium">
                        {pos.symbol}
                      </span>
                      <span className="text-xs text-text-secondary">
                        {pos.amount.toFixed(4)} @ ${pos.entryPrice.toFixed(4)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-text-muted">No portfolio data yet</p>
        )}
      </div>

      {/* ── Charts column ── */}
      <div className="space-y-6">
        {/* Equity curve placeholder */}
        <div className="rounded-2xl border border-border bg-bg-card p-5">
          <h3 className="mb-4 font-display text-base font-semibold">
            Equity Curve
          </h3>
          {/* TODO: render an <AreaChart /> from recharts showing PnL over time */}
          <div className="flex h-48 items-center justify-center rounded-xl bg-bg-elevated">
            <p className="text-sm text-text-muted">
              recharts <code className="text-accent">&lt;AreaChart /&gt;</code>{" "}
              — equity curve over time
            </p>
          </div>
        </div>

        {/* Allocation placeholder */}
        <div className="rounded-2xl border border-border bg-bg-card p-5">
          <h3 className="mb-4 font-display text-base font-semibold">
            Allocation
          </h3>
          {/* TODO: render a <PieChart /> from recharts showing asset allocation */}
          <div className="flex h-48 items-center justify-center rounded-xl bg-bg-elevated">
            <p className="text-sm text-text-muted">
              recharts <code className="text-accent">&lt;PieChart /&gt;</code>{" "}
              — asset allocation breakdown
            </p>
          </div>
        </div>
      </div>

      {/* ── Trade history ── */}
      <div className="lg:col-span-2 rounded-2xl border border-border bg-bg-card p-5">
        <h3 className="mb-4 font-display text-base font-semibold">
          Trade History
        </h3>
        {loading ? (
          <p className="text-sm text-text-muted">Loading...</p>
        ) : trades.length === 0 ? (
          <p className="text-sm text-text-muted">No trades yet</p>
        ) : (
          <div className="space-y-1">
            {trades.map((trade) => (
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
                      className={`text-xs font-medium ${pnlColor(trade.pnl)}`}
                    >
                      {trade.pnl >= 0 ? "+" : ""}
                      {trade.pnl.toFixed(2)}
                    </span>
                  )}
                  <span className="text-[10px] text-text-muted">
                    {new Date(trade.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
