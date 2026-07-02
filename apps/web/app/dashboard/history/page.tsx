"use client";

import { useState, useEffect, useCallback } from "react";

type SortKey = "timestamp" | "symbol" | "action" | "amount" | "price" | "pnl";

interface TradeRecord {
  id: string;
  symbol: string;
  action: string;
  amount: number;
  price: number;
  timestamp: number;
  pnl?: number;
}

export default function HistoryPage() {
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSymbol, setFilterSymbol] = useState("");
  const [filterAction, setFilterAction] = useState<"ALL" | "BUY" | "SELL">(
    "ALL"
  );
  const [sortKey] = useState<SortKey>("timestamp");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const perPage = 15;

  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch("/api/trades");
      if (res.ok) {
        const d = await res.json();
        setTrades(d);
      }
    } catch {
      // noop
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTrades();
  }, [fetchTrades]);

  // Compute stats
  const totalTrades = trades.length;
  const winningTrades = trades.filter((t) => t.pnl !== undefined && t.pnl > 0);
  const winRate = totalTrades > 0 ? winningTrades.length / totalTrades : 0;
  const totalPnl = trades.reduce(
    (sum, t) => sum + (t.pnl ?? 0),
    0
  );

  // Filter
  const filtered = trades.filter((t) => {
    if (filterSymbol && !t.symbol.includes(filterSymbol.toUpperCase()))
      return false;
    if (filterAction !== "ALL" && t.action !== filterAction) return false;
    return true;
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortKey === "timestamp") cmp = a.timestamp - b.timestamp;
    else if (sortKey === "symbol") cmp = a.symbol.localeCompare(b.symbol);
    else if (sortKey === "action") cmp = a.action.localeCompare(b.action);
    else if (sortKey === "amount") cmp = a.amount - b.amount;
    else if (sortKey === "price") cmp = a.price - b.price;
    else if (sortKey === "pnl") cmp = (a.pnl ?? 0) - (b.pnl ?? 0);
    return sortDir === "desc" ? -cmp : cmp;
  });

  // Paginate
  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const paged = sorted.slice((page - 1) * perPage, page * perPage);

  const pnlColor = (val: number) =>
    val >= 0 ? "text-success" : "text-error";

  return (
    <div className="space-y-6">
      {/* ── Stats bar ── */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-2xl border border-border bg-bg-card p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-text-muted">
            Total Trades
          </p>
          <p className="mt-1 font-display text-xl font-bold">{totalTrades}</p>
        </div>
        <div className="rounded-2xl border border-border bg-bg-card p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-text-muted">
            Win Rate
          </p>
          <p className="mt-1 font-display text-xl font-bold">
            {(winRate * 100).toFixed(1)}%
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-bg-card p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-text-muted">
            Total PnL
          </p>
          <p className={`mt-1 font-display text-xl font-bold ${pnlColor(totalPnl)}`}>
            {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-bg-card p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-text-muted">
            Filtered
          </p>
          <p className="mt-1 font-display text-xl font-bold">
            {filtered.length}
          </p>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-bg-card p-4">
        <div>
          <label className="mr-2 font-mono text-[10px] uppercase tracking-widest text-text-muted">
            Symbol
          </label>
          <input
            type="text"
            value={filterSymbol}
            onChange={(e) => {
              setFilterSymbol(e.target.value);
              setPage(1);
            }}
            placeholder="XLM, BTC..."
            className="w-28 rounded-lg border border-border bg-bg-elevated px-3 py-1.5 font-mono text-xs text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mr-2 font-mono text-[10px] uppercase tracking-widest text-text-muted">
            Type
          </label>
          <select
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
        <button
          onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
          className="ml-auto rounded-lg border border-border bg-bg-elevated px-3 py-1.5 font-mono text-xs text-text-secondary hover:border-accent/40"
        >
          {sortDir === "desc" ? "↓ Newest" : "↑ Oldest"}
        </button>
        {/* TODO: add date range picker */}
      </div>

      {/* ── Trades table ── */}
      <div className="rounded-2xl border border-border bg-bg-card p-5">
        {loading ? (
          <p className="text-sm text-text-muted">Loading...</p>
        ) : paged.length === 0 ? (
          <p className="text-sm text-text-muted">No trades match your filters</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border font-mono text-[10px] uppercase tracking-widest text-text-muted">
                  <th className="pb-2 pr-4">Time</th>
                  <th className="pb-2 pr-4">Symbol</th>
                  <th className="pb-2 pr-4">Action</th>
                  <th className="pb-2 pr-4 text-right">Amount</th>
                  <th className="pb-2 pr-4 text-right">Price</th>
                  <th className="pb-2 pr-4 text-right">PnL</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((trade) => (
                  <tr
                    key={trade.id}
                    className="border-b border-border/50 transition-colors hover:bg-bg-elevated/50"
                  >
                    <td className="py-2.5 pr-4 font-mono text-xs text-text-muted">
                      {new Date(trade.timestamp).toLocaleString()}
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-xs font-medium">
                      {trade.symbol}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span
                        className={`text-xs font-medium ${
                          trade.action === "BUY"
                            ? "text-emerald-400"
                            : "text-red-400"
                        }`}
                      >
                        {trade.action}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-xs">
                      {trade.amount.toFixed(4)}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-xs">
                      ${trade.price.toFixed(4)}
                    </td>
                    <td className="py-2.5 text-right font-mono text-xs">
                      {trade.pnl !== undefined && (
                        <span className={pnlColor(trade.pnl)}>
                          {trade.pnl >= 0 ? "+" : ""}
                          {trade.pnl.toFixed(2)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-lg border border-border bg-bg-elevated px-3 py-1 font-mono text-xs text-text-secondary disabled:opacity-30"
            >
              Prev
            </button>
            <span className="font-mono text-xs text-text-muted">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="rounded-lg border border-border bg-bg-elevated px-3 py-1 font-mono text-xs text-text-secondary disabled:opacity-30"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
