"use client";

import { Suspense, useMemo, useState, useCallback, useRef, useEffect, startTransition, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import DelegationKit from "@/app/components/DelegationKit";
import { PriceChart } from "@/app/components/charts/PriceChart";
import { PriceViewPanel } from "@/app/components/panels/PriceViewPanel";
import { Card, CardBody, CardHeader } from "@/app/components/ui/Card";
import { Segmented } from "@/app/components/ui/Segmented";
import { usePrices } from "@/app/hooks/usePrices";
import { usePaperTrading } from "@/app/hooks/usePaperTrading";
import {
  baseAsset,
  formatNumber,
  formatPrice,
  formatPct,
  formatUsd,
} from "@/app/lib/format";

type Side = "BUY" | "SELL";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "XLMUSDT", "SOLUSDT", "ADAUSDT"];

function TradeInner() {
  const searchParams = useSearchParams();
  const initialSymbol = (searchParams.get("symbol") || "XLMUSDT").toUpperCase();

  const [symbol, setSymbol] = useState(
    SYMBOLS.includes(initialSymbol) ? initialSymbol : "XLMUSDT"
  );
  const { tickers, priceMap, wsStatus, getLatestPrice } = usePrices(SYMBOLS, 10000);
  const { balance, positions, buy, sell } = usePaperTrading(priceMap);

  const ticker = tickers[symbol];
  // Read from WS ref for instant accuracy, fall back to throttle-safe state
  const livePrice = getLatestPrice(symbol) ?? priceMap[symbol] ?? ticker?.price ?? 0;
  const heldPosition = positions.find((p) => p.symbol === symbol);

  const isMounted = useSyncExternalStore(() => () => {}, () => true, () => false);

  const [timeStr, setTimeStr] = useState("—");
  useEffect(() => {
    const update = () => {
      const t = new Date();
      startTransition(() => setTimeStr(
        `${t.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}.${String(t.getMilliseconds()).padStart(3, "0")}`
      ));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  // Price flash animation on change
  const prevPriceRef = useRef(livePrice);
  const [priceFlash, setPriceFlash] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (livePrice === prevPriceRef.current) return;
    const dir = livePrice > prevPriceRef.current ? "up" : "down";
    prevPriceRef.current = livePrice;
    setPriceFlash(dir);
    const t = setTimeout(() => setPriceFlash(null), 300);
    return () => clearTimeout(t);
  }, [livePrice]);

  // ── Feedback banner ──
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const flash = useCallback((kind: "ok" | "err", msg: string) => {
    setToast({ kind, msg });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  // ── Manual trade ──
  const [side, setSide] = useState<Side>("BUY");
  const [amount, setAmount] = useState("");
  const amountNum = parseFloat(amount) || 0;

  const maxAmount = useMemo(() => {
    if (side === "BUY") return livePrice > 0 ? balance / livePrice : 0;
    return heldPosition?.amount ?? 0;
  }, [side, livePrice, balance, heldPosition]);

  const estCost = amountNum * livePrice;

  const handleManualTrade = () => {
    const execPrice = getLatestPrice(symbol) || livePrice;
    if (amountNum <= 0 || execPrice <= 0) return;
    try {
      if (side === "BUY") buy(symbol, amountNum, execPrice);
      else sell(symbol, amountNum, execPrice);
      flash(
        "ok",
        `${side} ${formatNumber(amountNum)} ${baseAsset(symbol)} @ ${formatPrice(execPrice)}`
      );
      setAmount("");
    } catch (e) {
      flash("err", e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Toast ── */}
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

      {/* ── Symbol strip ── */}
      <div className="flex flex-wrap gap-2">
        {SYMBOLS.map((s) => {
          const t = tickers[s];
          const active = s === symbol;
          return (
            <button
              key={s}
              onClick={() => setSymbol(s)}
              className={`cursor-pointer rounded-xl border px-3.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                active
                  ? "border-accent/50 bg-accent-muted"
                  : "border-border bg-bg-card hover:border-accent/30"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold">
                  {baseAsset(s)}
                </span>
                {t && (
                  <span
                    className={`font-mono text-[10px] tabular-nums ${
                      t.change24h >= 0 ? "text-success" : "text-error"
                    }`}
                  >
                    {formatPct(t.change24h)}
                  </span>
                )}
              </div>
              <div className="mt-0.5 font-mono text-[11px] tabular-nums text-text-secondary">
                {t ? formatPrice(t.price) : "—"}
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ── Main column ── */}
        <div className="space-y-6 lg:col-span-2">
          <PriceChart symbol={symbol} symbols={SYMBOLS} onSymbolChange={setSymbol} />

          <PriceViewPanel
            symbol={symbol}
            ticker={ticker}
            wsStatus={wsStatus}
          />
        </div>

        {/* ── Sidebar ── */}
        <div className="space-y-6">
          {/* Manual quick trade */}
          <Card>
            <CardHeader title="Quick Trade" />
            <CardBody className="space-y-4 pt-3">
              <Segmented
                options={[
                  { value: "BUY", label: "Buy" },
                  { value: "SELL", label: "Sell" },
                ]}
                value={side}
                onChange={(v) => {
                  setSide(v);
                  setAmount("");
                }}
              />

              <div className="flex items-center justify-between rounded-lg bg-bg-elevated px-3 py-2">
                <div>
                  <span className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
                    {baseAsset(symbol)} Price
                  </span>
                  <p className="font-mono text-[9px] text-text-muted/60" suppressHydrationWarning>
                    {isMounted ? timeStr : "—"}
                  </p>
                </div>
                <span
                  className={`font-mono text-sm tabular-nums transition-colors duration-200 ${
                    priceFlash === "up"
                      ? "text-success"
                      : priceFlash === "down"
                        ? "text-error"
                        : ""
                  }`}
                >
                  {formatPrice(livePrice)}
                </span>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label
                    htmlFor="amt"
                    className="font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted"
                  >
                    Amount ({baseAsset(symbol)})
                  </label>
                  <span className="font-mono text-[10px] text-text-muted">
                    Max {formatNumber(maxAmount)}
                  </span>
                </div>
                <input
                  id="amt"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-xl border border-border bg-bg-elevated px-3.5 py-2.5 font-mono text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
                <div className="mt-2 flex gap-2">
                  {[0.25, 0.5, 0.75, 1].map((pct) => (
                    <button
                      key={pct}
                      onClick={() =>
                        setAmount(
                          maxAmount > 0 ? String(Number((maxAmount * pct).toFixed(6))) : ""
                        )
                      }
                      className="flex-1 rounded-lg border border-border bg-bg-elevated py-1.5 font-mono text-[11px] text-text-secondary transition-colors hover:border-accent/40 hover:text-accent"
                    >
                      {pct * 100}%
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">Est. {side === "BUY" ? "cost" : "proceeds"}</span>
                <span className="font-mono tabular-nums">{formatUsd(estCost)}</span>
              </div>

              <button
                onClick={handleManualTrade}
                disabled={amountNum <= 0 || amountNum > maxAmount + 1e-9 || livePrice <= 0}
                className={`w-full rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  side === "BUY"
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {side} {baseAsset(symbol)}
              </button>

              <div className="flex items-center justify-between border-t border-border pt-3 text-xs">
                <span className="text-text-muted">Cash balance</span>
                <span className="font-mono tabular-nums">{formatUsd(balance)}</span>
              </div>
              {heldPosition && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">Holding</span>
                  <span className="font-mono tabular-nums">
                    {formatNumber(heldPosition.amount)} {baseAsset(symbol)}
                  </span>
                </div>
              )}
            </CardBody>
          </Card>

          <DelegationKit />

          {/* Position Snapshot */}
          {heldPosition && (
            <Card>
              <CardHeader title={baseAsset(symbol)} />
              <CardBody className="space-y-3 pt-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
                    Amount
                  </span>
                  <span className="font-mono text-sm tabular-nums">
                    {formatNumber(heldPosition.amount)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
                    Entry
                  </span>
                  <span className="font-mono text-sm tabular-nums">
                    {formatPrice(heldPosition.entryPrice)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
                    Market
                  </span>
                  <span className="font-mono text-sm tabular-nums">
                    {formatPrice(heldPosition.currentPrice ?? livePrice)}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-2">
                  <span className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
                    P&L
                  </span>
                  <span
                    className={`font-mono text-sm tabular-nums ${
                      (heldPosition.pnl ?? 0) >= 0 ? "text-success" : "text-error"
                    }`}
                  >
                    {formatUsd(heldPosition.pnl ?? 0)} ({(heldPosition.pnlPct ?? 0) >= 0 ? "+" : ""}
                    {(heldPosition.pnlPct ?? 0).toFixed(2)}%)
                  </span>
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TradePage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-bg-card" />}>
      <TradeInner />
    </Suspense>
  );
}
