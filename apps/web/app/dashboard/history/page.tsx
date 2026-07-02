"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePaperTrading } from "@/app/hooks/usePaperTrading";
import { StatCard } from "@/app/components/ui/StatCard";
import { Card, CardBody } from "@/app/components/ui/Card";
import { Badge } from "@/app/components/ui/Badge";
import {
  baseAsset,
  formatDateTime,
  formatNumber,
  formatPrice,
  formatSignedUsd,
  pnlColor,
} from "@/app/lib/format";
import type { Trade } from "@/lib/paper-trading";

type SortKey = "timestamp" | "symbol" | "action" | "amount" | "price" | "pnl";
const PER_PAGE = 12;

function SortHeader({
  label,
  k,
  align = "left",
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  k: SortKey;
  align?: "left" | "right";
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <th
      className={`pb-2 pr-4 ${align === "right" ? "text-right" : ""}`}
      aria-sort={active ? (sortDir === "desc" ? "descending" : "ascending") : "none"}
    >
      <button
        onClick={() => onSort(k)}
        className="cursor-pointer font-mono text-[10px] uppercase tracking-widest text-text-muted transition-colors hover:text-text-secondary"
      >
        {label}
        {active && <span className="ml-1">{sortDir === "desc" ? "↓" : "↑"}</span>}
      </button>
    </th>
  );
}

export default function HistoryPage() {
  const { ready, trades } = usePaperTrading();

  const [filterSymbol, setFilterSymbol] = useState("");
  const [filterAction, setFilterAction] = useState<"ALL" | "BUY" | "SELL">("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  // ── Stats ──
  const closed = trades.filter((t) => t.pnl !== undefined);
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const totalPnl = trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const totalFees = trades.reduce((s, t) => s + (t.fees ?? 0), 0);

  // ── Filter + sort ──
  const processed = useMemo(() => {
    const filtered = trades.filter((t) => {
      if (filterSymbol && !t.symbol.includes(filterSymbol.toUpperCase())) return false;
      if (filterAction !== "ALL" && t.action !== filterAction) return false;
      return true;
    });
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "timestamp": cmp = a.timestamp - b.timestamp; break;
        case "symbol": cmp = a.symbol.localeCompare(b.symbol); break;
        case "action": cmp = a.action.localeCompare(b.action); break;
        case "amount": cmp = a.amount - b.amount; break;
        case "price": cmp = a.price - b.price; break;
        case "pnl": cmp = (a.pnl ?? 0) - (b.pnl ?? 0); break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return sorted;
  }, [trades, filterSymbol, filterAction, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(processed.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const paged = processed.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(1);
  };

  const exportCsv = () => {
    const rows = [
      ["Timestamp", "Symbol", "Action", "Amount", "Price", "PnL", "Fees"],
      ...processed.map((t: Trade) => [
        new Date(t.timestamp).toISOString(),
        t.symbol,
        t.action,
        t.amount,
        t.price,
        t.pnl ?? "",
        t.fees ?? "",
      ]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kairos-trades-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* ── Stats ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Trades" loading={!ready} value={String(trades.length)} />
        <StatCard label="Win Rate" loading={!ready} value={`${winRate.toFixed(1)}%`} />
        <StatCard
          label="Realized PnL"
          loading={!ready}
          value={formatSignedUsd(totalPnl)}
          valueClassName={pnlColor(totalPnl)}
        />
        <StatCard label="Total Fees" loading={!ready} value={formatSignedUsd(-totalFees)} />
      </div>

      {/* ── Filters ── */}
      <Card>
        <CardBody className="flex flex-wrap items-end gap-4">
          <div>
            <label
              htmlFor="fsym"
              className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-text-muted"
            >
              Symbol
            </label>
            <input
              id="fsym"
              type="text"
              value={filterSymbol}
              onChange={(e) => {
                setFilterSymbol(e.target.value);
                setPage(1);
              }}
              placeholder="BTC, XLM…"
              className="w-32 rounded-lg border border-border bg-bg-elevated px-3 py-1.5 font-mono text-xs text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="fact"
              className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-text-muted"
            >
              Type
            </label>
            <select
              id="fact"
              value={filterAction}
              onChange={(e) => {
                setFilterAction(e.target.value as "ALL" | "BUY" | "SELL");
                setPage(1);
              }}
              className="rounded-lg border border-border bg-bg-elevated px-3 py-1.5 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
            >
              <option value="ALL">All</option>
              <option value="BUY">Buy</option>
              <option value="SELL">Sell</option>
            </select>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="font-mono text-[11px] text-text-muted">
              {processed.length} result{processed.length === 1 ? "" : "s"}
            </span>
            <button
              onClick={exportCsv}
              disabled={processed.length === 0}
              className="cursor-pointer rounded-lg border border-border bg-bg-elevated px-3 py-1.5 font-mono text-xs text-text-secondary transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-40"
            >
              Export CSV
            </button>
          </div>
        </CardBody>
      </Card>

      {/* ── Table ── */}
      <Card>
        <CardBody>
          {!ready ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-bg-elevated" />
              ))}
            </div>
          ) : paged.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <p className="text-sm text-text-secondary">
                {trades.length === 0 ? "No trades yet" : "No trades match your filters"}
              </p>
              {trades.length === 0 && (
                <Link
                  href="/dashboard/trade"
                  className="text-sm text-accent underline underline-offset-2"
                >
                  Start trading →
                </Link>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {(
                      [
                        { label: "Time", k: "timestamp", align: "left" },
                        { label: "Symbol", k: "symbol", align: "left" },
                        { label: "Action", k: "action", align: "left" },
                        { label: "Amount", k: "amount", align: "right" },
                        { label: "Price", k: "price", align: "right" },
                        { label: "PnL", k: "pnl", align: "right" },
                      ] as const
                    ).map((h) => (
                      <SortHeader
                        key={h.k}
                        label={h.label}
                        k={h.k}
                        align={h.align}
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={toggleSort}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paged.map((t) => (
                    <tr
                      key={t.id}
                      className="border-b border-border/50 transition-colors hover:bg-bg-elevated/40"
                    >
                      <td className="py-2.5 pr-4 font-mono text-xs text-text-muted">
                        {formatDateTime(t.timestamp)}
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-xs font-medium">
                        {baseAsset(t.symbol)}
                      </td>
                      <td className="py-2.5 pr-4">
                        <Badge tone={t.action === "BUY" ? "buy" : "sell"}>{t.action}</Badge>
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono text-xs tabular-nums">
                        {formatNumber(t.amount)}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono text-xs tabular-nums">
                        {formatPrice(t.price)}
                      </td>
                      <td className="py-2.5 text-right font-mono text-xs tabular-nums">
                        {t.pnl !== undefined ? (
                          <span className={pnlColor(t.pnl)}>{formatSignedUsd(t.pnl)}</span>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="cursor-pointer rounded-lg border border-border bg-bg-elevated px-3 py-1 font-mono text-xs text-text-secondary disabled:opacity-30"
              >
                Prev
              </button>
              <span className="font-mono text-xs text-text-muted">
                {safePage} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="cursor-pointer rounded-lg border border-border bg-bg-elevated px-3 py-1 font-mono text-xs text-text-secondary disabled:opacity-30"
              >
                Next
              </button>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
