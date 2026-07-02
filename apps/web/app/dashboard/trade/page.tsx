"use client";

import { Suspense, useMemo, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import DelegationKit from "@/app/components/DelegationKit";
import { PriceChart } from "@/app/components/charts/PriceChart";
import { Card, CardBody, CardHeader } from "@/app/components/ui/Card";
import { Badge } from "@/app/components/ui/Badge";
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

type AutomationMode = "AI_MANAGED" | "STRATEGY_MANAGED" | "AUTONOMOUS_AI";
type Side = "BUY" | "SELL";

interface Indicators {
  ema20: number;
  ema50: number;
  sma20: number;
  rsi: number;
  macd: { MACD: number; signal: number; histogram: number };
  atr: number;
}

interface Proposal {
  action: "BUY" | "SELL" | "HOLD";
  symbol: string;
  amount: number;
  confidence: number;
  reasoning: string;
  stopLoss?: number;
  takeProfit?: number;
  timestamp: number;
  market?: { price: number; change24h: number; volume24h: number; indicators: Indicators };
}

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "XLMUSDT", "SOLUSDT", "ADAUSDT"];

const MODES: { value: AutomationMode; label: string }[] = [
  { value: "AI_MANAGED", label: "AI Managed" },
  { value: "STRATEGY_MANAGED", label: "Strategy" },
  { value: "AUTONOMOUS_AI", label: "Autonomous" },
];

function TradeInner() {
  const searchParams = useSearchParams();
  const initialSymbol = (searchParams.get("symbol") || "XLMUSDT").toUpperCase();

  const [symbol, setSymbol] = useState(
    SYMBOLS.includes(initialSymbol) ? initialSymbol : "XLMUSDT"
  );
  const { tickers, priceMap } = usePrices(SYMBOLS, 10000);
  const { balance, positions, buy, sell } = usePaperTrading(priceMap);

  const ticker = tickers[symbol];
  const livePrice = priceMap[symbol] ?? ticker?.price ?? 0;
  const heldPosition = positions.find((p) => p.symbol === symbol);

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
    if (amountNum <= 0 || livePrice <= 0) return;
    try {
      if (side === "BUY") buy(symbol, amountNum, livePrice);
      else sell(symbol, amountNum, livePrice);
      flash(
        "ok",
        `${side} ${formatNumber(amountNum)} ${baseAsset(symbol)} @ ${formatPrice(livePrice)}`
      );
      setAmount("");
    } catch (e) {
      flash("err", e instanceof Error ? e.message : String(e));
    }
  };

  // ── AI analysis ──
  const [mode, setMode] = useState<AutomationMode>("AI_MANAGED");
  const [intentText, setIntentText] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [executing, setExecuting] = useState(false);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setProposal(null);
    setToast(null);
    try {
      const body: Record<string, unknown> = {
        symbol,
        automationMode: mode,
        balance,
      };
      if (intentText.trim()) body.tradingProfile = { intentText };
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      setProposal(data);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  };

  const handleExecuteProposal = () => {
    if (!proposal || proposal.action === "HOLD") return;
    const price = proposal.market?.price ?? livePrice;
    const qty = Math.abs(proposal.amount);
    if (qty <= 0 || price <= 0) {
      flash("err", "Invalid proposal amount or price");
      return;
    }
    setExecuting(true);
    try {
      if (proposal.action === "BUY") buy(proposal.symbol, qty, price);
      else sell(proposal.symbol, qty, price);
      flash(
        "ok",
        `${proposal.action} ${formatNumber(qty)} ${baseAsset(proposal.symbol)} @ ${formatPrice(price)}`
      );
      setProposal(null);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : String(e));
    } finally {
      setExecuting(false);
    }
  };

  const ind = proposal?.market?.indicators;

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
          <Card>
            <CardBody>
              <PriceChart symbol={symbol} />
            </CardBody>
          </Card>

          {/* Live market stats */}
          <Card>
            <CardHeader
              title="Market Stats"
              action={<Badge tone="success" dot>Live</Badge>}
            />
            <CardBody className="pt-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Price" value={ticker ? formatPrice(ticker.price) : "—"} />
                <Stat
                  label="24h Change"
                  value={ticker ? formatPct(ticker.change24h) : "—"}
                  className={
                    ticker ? (ticker.change24h >= 0 ? "text-success" : "text-error") : ""
                  }
                />
                <Stat label="24h High" value={ticker ? formatPrice(ticker.high24h) : "—"} />
                <Stat label="24h Low" value={ticker ? formatPrice(ticker.low24h) : "—"} />
              </div>
              {ind && (
                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
                  <Stat label="RSI (14)" value={ind.rsi.toFixed(1)} />
                  <Stat label="EMA 20" value={formatPrice(ind.ema20)} />
                  <Stat label="EMA 50" value={formatPrice(ind.ema50)} />
                  <Stat
                    label="MACD Hist"
                    value={ind.macd.histogram.toFixed(4)}
                    className={ind.macd.histogram >= 0 ? "text-success" : "text-error"}
                  />
                </div>
              )}
            </CardBody>
          </Card>

          {/* AI analysis */}
          <Card>
            <CardHeader title="AI Analysis" />
            <CardBody className="space-y-4 pt-3">
              <div>
                <label className="mb-1.5 block font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">
                  Automation Mode
                </label>
                <Segmented options={MODES} value={mode} onChange={setMode} />
              </div>
              <div>
                <label
                  htmlFor="intent"
                  className="mb-1.5 block font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted"
                >
                  Trading Intent{" "}
                  <span className="text-text-muted/60 normal-case">(optional)</span>
                </label>
                <textarea
                  id="intent"
                  value={intentText}
                  onChange={(e) => setIntentText(e.target.value)}
                  placeholder="e.g., Grow funds with moderate risk, prefer XLM and BTC…"
                  rows={2}
                  className="w-full resize-none rounded-xl border border-border bg-bg-elevated p-3 font-mono text-xs text-text-primary placeholder-text-muted transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>
              <button
                onClick={handleAnalyze}
                disabled={analyzing}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                {analyzing && (
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                )}
                {analyzing ? "Analyzing market…" : `Analyze ${baseAsset(symbol)}`}
              </button>

              {proposal && (
                <div className="animate-fade-in-up space-y-3 rounded-xl border border-border bg-bg-elevated p-4">
                  <div className="flex items-center justify-between">
                    <Badge
                      tone={
                        proposal.action === "BUY"
                          ? "buy"
                          : proposal.action === "SELL"
                            ? "sell"
                            : "neutral"
                      }
                      dot
                    >
                      {proposal.action} Signal
                    </Badge>
                    <span className="font-mono text-xs text-text-muted">
                      Confidence {(proposal.confidence * 100).toFixed(0)}%
                    </span>
                  </div>

                  {/* Confidence meter */}
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-card">
                    <div
                      className="h-full rounded-full bg-accent transition-all"
                      style={{ width: `${Math.min(100, proposal.confidence * 100)}%` }}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Stat label="Amount" value={formatNumber(Math.abs(proposal.amount))} />
                    <Stat
                      label="Ref Price"
                      value={formatPrice(proposal.market?.price ?? livePrice)}
                    />
                    {proposal.stopLoss ? (
                      <Stat
                        label="Stop Loss"
                        value={formatPrice(proposal.stopLoss)}
                        className="text-error"
                      />
                    ) : null}
                    {proposal.takeProfit ? (
                      <Stat
                        label="Take Profit"
                        value={formatPrice(proposal.takeProfit)}
                        className="text-success"
                      />
                    ) : null}
                  </div>

                  <p className="text-xs leading-relaxed text-text-secondary">
                    {proposal.reasoning}
                  </p>

                  {proposal.action !== "HOLD" && (
                    <button
                      onClick={handleExecuteProposal}
                      disabled={executing}
                      className={`w-full rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
                        proposal.action === "BUY"
                          ? "bg-emerald-600 hover:bg-emerald-700"
                          : "bg-red-600 hover:bg-red-700"
                      }`}
                    >
                      {executing ? "Executing…" : `Execute ${proposal.action}`}
                    </button>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
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
                <span className="font-mono text-[11px] uppercase tracking-widest text-text-muted">
                  {baseAsset(symbol)} Price
                </span>
                <span className="font-mono text-sm tabular-nums">
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
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-text-muted">
        {label}
      </p>
      <p className={`mt-0.5 font-mono text-sm font-medium tabular-nums ${className}`}>
        {value}
      </p>
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
