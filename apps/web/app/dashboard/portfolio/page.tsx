"use client";

import { useState } from "react";
import Link from "next/link";
import { usePrices } from "@/app/hooks/usePrices";
import { usePaperTrading } from "@/app/hooks/usePaperTrading";
import { StatCard } from "@/app/components/ui/StatCard";
import { Card, CardBody, CardHeader } from "@/app/components/ui/Card";
import { Badge } from "@/app/components/ui/Badge";
import { EquityCurve } from "@/app/components/charts/EquityCurve";
import { AllocationPie } from "@/app/components/charts/AllocationPie";
import {
  baseAsset,
  formatNumber,
  formatPrice,
  formatPct,
  formatSignedUsd,
  formatTime,
  formatUsd,
  pnlColor,
} from "@/app/lib/format";

const MARKET_SYMBOLS = ["BTCUSDT", "ETHUSDT", "XLMUSDT", "SOLUSDT", "ADAUSDT", "XRPUSDT", "DOGEUSDT"];
const INITIAL_BALANCE = 10000;

export default function PortfolioPage() {
  const { priceMap } = usePrices(MARKET_SYMBOLS);
  const { ready, balance, positions, trades, totalValue, unrealizedPnL, closePosition } =
    usePaperTrading(priceMap);

  const [closing, setClosing] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const realizedPnL = trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const loading = !ready;

  const handleClose = (symbol: string) => {
    const price = priceMap[symbol];
    if (!price) {
      setToast({ kind: "err", msg: `No live price for ${symbol} yet` });
      return;
    }
    setClosing(symbol);
    try {
      const t = closePosition(symbol, price);
      setToast({
        kind: "ok",
        msg: `Closed ${baseAsset(symbol)} · realized ${formatSignedUsd(t.pnl ?? 0)}`,
      });
    } catch (e) {
      setToast({ kind: "err", msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setClosing(null);
      window.setTimeout(() => setToast(null), 4000);
    }
  };

  return (
    <div className="space-y-6">
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`animate-fade-in-up rounded-xl border px-4 py-3 text-xs ${
            toast.kind === "ok"
              ? "border-success/20 bg-success/10 text-success"
              : "border-error/20 bg-error/10 text-error"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* ── Stat strip ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Value" loading={loading} value={formatUsd(totalValue)} />
        <StatCard label="Cash Balance" loading={loading} value={formatUsd(balance)} />
        <StatCard
          label="Unrealized PnL"
          loading={loading}
          value={formatSignedUsd(unrealizedPnL)}
          valueClassName={pnlColor(unrealizedPnL)}
        />
        <StatCard
          label="Realized PnL"
          loading={loading}
          value={formatSignedUsd(realizedPnL)}
          valueClassName={pnlColor(realizedPnL)}
        />
      </div>

      {/* ── Charts ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Equity Curve" />
          <CardBody className="pt-3">
            <EquityCurve
              trades={trades}
              initialBalance={INITIAL_BALANCE}
              liveEquity={totalValue}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Allocation" />
          <CardBody className="pt-3">
            <AllocationPie cash={balance} positions={positions} />
          </CardBody>
        </Card>
      </div>

      {/* ── Positions ── */}
      <Card>
        <CardHeader
          title="Open Positions"
          action={
            positions.length > 0 ? (
              <Badge tone="accent">{positions.length}</Badge>
            ) : undefined
          }
        />
        <CardBody className="pt-3">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-bg-elevated" />
              ))}
            </div>
          ) : positions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <p className="text-sm text-text-secondary">No open positions</p>
              <Link
                href="/dashboard/trade"
                className="text-sm text-accent underline underline-offset-2"
              >
                Open a position →
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border font-mono text-[10px] uppercase tracking-widest text-text-muted">
                    <th className="pb-2 pr-4">Asset</th>
                    <th className="pb-2 pr-4 text-right">Amount</th>
                    <th className="pb-2 pr-4 text-right">Entry</th>
                    <th className="pb-2 pr-4 text-right">Mark</th>
                    <th className="pb-2 pr-4 text-right">Value</th>
                    <th className="pb-2 pr-4 text-right">PnL</th>
                    <th className="pb-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => (
                    <tr
                      key={p.symbol}
                      className="border-b border-border/50 transition-colors hover:bg-bg-elevated/40"
                    >
                      <td className="py-3 pr-4 font-mono text-xs font-semibold">
                        {baseAsset(p.symbol)}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums">
                        {formatNumber(p.amount)}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums text-text-secondary">
                        {formatPrice(p.entryPrice)}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums">
                        {formatPrice(p.currentPrice)}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums">
                        {formatUsd(p.value)}
                      </td>
                      <td
                        className={`py-3 pr-4 text-right font-mono text-xs tabular-nums ${pnlColor(
                          p.pnl
                        )}`}
                      >
                        {formatSignedUsd(p.pnl)}
                        <span className="ml-1 text-[10px] opacity-70">
                          ({formatPct(p.pnlPct)})
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <button
                          onClick={() => handleClose(p.symbol)}
                          disabled={closing === p.symbol}
                          className="cursor-pointer rounded-lg border border-border bg-bg-elevated px-3 py-1 font-mono text-[11px] text-text-secondary transition-colors hover:border-error/40 hover:text-error disabled:opacity-40"
                        >
                          {closing === p.symbol ? "…" : "Close"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* ── Recent trade history ── */}
      <Card>
        <CardHeader
          title="Recent Activity"
          action={
            trades.length > 0 ? (
              <Link href="/dashboard/history" className="text-xs text-accent hover:underline">
                View all
              </Link>
            ) : undefined
          }
        />
        <CardBody className="pt-3">
          {trades.length === 0 ? (
            <p className="py-4 text-center text-sm text-text-muted">No trades yet</p>
          ) : (
            <div className="space-y-1">
              {trades.slice(0, 8).map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-lg bg-bg-elevated px-3 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <Badge tone={t.action === "BUY" ? "buy" : "sell"}>{t.action}</Badge>
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
                        className={`w-16 text-right font-mono text-xs font-medium tabular-nums ${pnlColor(
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
  );
}
