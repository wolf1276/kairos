"use client";

import { Suspense, useMemo, useState, useCallback, useRef, useEffect, startTransition, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import DelegationKit from "@/app/components/DelegationKit";
import { AdvancedChart } from "@/app/components/charts/AdvancedChart";
import { PriceViewPanel } from "@/app/components/panels/PriceViewPanel";
import { Card, CardBody } from "@/app/components/ui/Card";
import { Segmented } from "@/app/components/ui/Segmented";
import { usePrices } from "@/app/hooks/usePrices";
import { usePaperTrading } from "@/app/hooks/usePaperTrading";
import {
  baseAsset,
  formatNumber,
  formatPrice,
  formatUsd,
} from "@/app/lib/format";
import { cn } from "@/lib/utils";

type Side = "BUY" | "SELL";
type TradeMode = "manual" | "strategy" | "intent" | "agent";

const MODES: { value: TradeMode; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "strategy", label: "Strategy" },
  { value: "intent", label: "Intent" },
  { value: "agent", label: "Agent Auto" },
];

function TradeInner() {
  const searchParams = useSearchParams();
  const initialSymbol = (searchParams.get("symbol") || "XLMUSDT").toUpperCase();
  const initialMode = (searchParams.get("mode") || "manual") as TradeMode;

  const [symbol, setSymbol] = useState(initialSymbol);

  const { tickers, priceMap, wsStatus, getLatestPrice } = usePrices([symbol], 10000);
  const { balance, positions, buy, sell } = usePaperTrading(priceMap);

  const ticker = tickers[symbol];
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

  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const flash = useCallback((kind: "ok" | "err", msg: string) => {
    setToast({ kind, msg });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  // ── Mode ──
  const [mode, setMode] = useState<TradeMode>(
    MODES.map((m) => m.value).includes(initialMode) ? initialMode : "manual",
  );

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
      flash("ok", `${side} ${formatNumber(amountNum)} ${baseAsset(symbol)} @ ${formatPrice(execPrice)}`);
      setAmount("");
    } catch (e) {
      flash("err", e instanceof Error ? e.message : String(e));
    }
  };

  // ── Strategy trade ──
  const [strategyTemplate, setStrategyTemplate] = useState("grid");
  const [tpPercent, setTpPercent] = useState("5");
  const [slPercent, setSlPercent] = useState("2");
  const [stratAmount, setStratAmount] = useState("");

  const handleDeployStrategy = () => {
    const amt = parseFloat(stratAmount) || 0;
    if (amt <= 0) { flash("err", "Enter a valid amount"); return; }
    flash("ok", `Strategy deployed: ${strategyTemplate} ${formatNumber(amt)} ${baseAsset(symbol)} TP ${tpPercent}% SL ${slPercent}%`);
    setStratAmount("");
  };

  // ── Intent trade ──
  const [intentText, setIntentText] = useState("");
  const [intentPlan, setIntentPlan] = useState<string | null>(null);

  const handleParseIntent = () => {
    if (!intentText.trim()) { flash("err", "Describe what you want to do"); return; }
    setIntentPlan(`AI would execute: ${intentText} for ${baseAsset(symbol)}`);
  };

  const handleConfirmIntent = () => {
    flash("ok", `Intent confirmed: ${intentText}`);
    setIntentText("");
    setIntentPlan(null);
  };

  // ── Agent auto ──
  const [riskLevel, setRiskLevel] = useState(5);
  const [agentCapital, setAgentCapital] = useState("1000");
  const [agentRunning, setAgentRunning] = useState(false);

  const handleToggleAgent = () => {
    setAgentRunning((r) => !r);
    if (!agentRunning) {
      flash("ok", `Agent started — risk ${riskLevel}/10, capital $${agentCapital}`);
    } else {
      flash("ok", "Agent stopped");
    }
  };

  const topSymbols = useMemo(() => ["BTCUSDT", "ETHUSDT", "XRPUSDT", "SOLUSDT", "ADAUSDT"], []);

  return (
    <div className="space-y-5">
      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`animate-fade-in-up rounded-xl border px-4 py-3 text-xs ${
            toast.kind === "ok"
              ? "border-success/15 bg-success/6 text-success/85"
              : "border-error/15 bg-error/6 text-error/85"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Mode tabs */}
      <div className="inline-flex gap-1 rounded-xl border border-white/5 bg-bg-elevated/50 p-1">
        {MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => setMode(m.value)}
            className={cn(
              "cursor-pointer rounded-[7px] px-4 py-1.5 font-mono text-xs font-medium transition-all duration-300",
              mode === m.value
                ? "bg-white/8 text-text-primary shadow-[0_0_20px_-8px_rgba(120,81,233,0.12)]"
                : "text-text-muted hover:text-text-secondary",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Main layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Chart column */}
        <div className="space-y-6 lg:col-span-2">
          <AdvancedChart symbol={symbol} symbols={topSymbols} onSymbolChange={setSymbol} />
          <PriceViewPanel symbol={symbol} ticker={ticker} wsStatus={wsStatus} />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Mode-specific form */}
          <Card>
            <CardBody className="space-y-4">
              {/* ── MANUAL ── */}
              {mode === "manual" && (
                <>
                  <Segmented
                    options={[
                      { value: "BUY", label: "Buy" },
                      { value: "SELL", label: "Sell" },
                    ]}
                    value={side}
                    onChange={(v) => { setSide(v); setAmount(""); }}
                  />

                  <div className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3.5 py-2.5">
                    <div>
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                        {baseAsset(symbol)} Price
                      </span>
                      <p className="mt-0.5 font-mono text-[9px] text-text-muted/50" suppressHydrationWarning>
                        {isMounted ? timeStr : "—"}
                      </p>
                    </div>
                    <span
                      className={`font-mono text-sm tabular-nums transition-colors duration-200 ${
                        priceFlash === "up" ? "text-success" : priceFlash === "down" ? "text-error" : "text-text-primary"
                      }`}
                    >
                      {formatPrice(livePrice)}
                    </span>
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
                        Amount ({baseAsset(symbol)})
                      </label>
                      <span className="font-mono text-[10px] text-text-muted">
                        Max {formatNumber(maxAmount)}
                      </span>
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-2.5 font-mono text-sm text-text-primary placeholder:text-text-muted/50 transition-all duration-300 focus:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/15"
                    />
                    <div className="mt-2 flex gap-2">
                      {[0.25, 0.5, 0.75, 1].map((pct) => (
                        <button
                          key={pct}
                          onClick={() => setAmount(maxAmount > 0 ? String(Number((maxAmount * pct).toFixed(6))) : "")}
                          className="flex-1 rounded-lg border border-white/5 bg-white/[0.02] py-1.5 font-mono text-[11px] text-text-muted transition-all duration-200 hover:bg-white/[0.05] hover:text-text-secondary"
                        >
                          {pct * 100}%
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-muted">Est. {side === "BUY" ? "cost" : "proceeds"}</span>
                    <span className="font-mono tabular-nums text-text-secondary">{formatUsd(estCost)}</span>
                  </div>

                  <button
                    onClick={handleManualTrade}
                    disabled={amountNum <= 0 || amountNum > maxAmount + 1e-9 || livePrice <= 0}
                    className={`w-full rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-30 ${
                      side === "BUY"
                        ? "bg-emerald-600/80 shadow-[0_0_25px_-10px_rgba(52,211,153,0.15)] hover:bg-emerald-600"
                        : "bg-red-600/80 shadow-[0_0_25px_-10px_rgba(239,68,68,0.15)] hover:bg-red-600"
                    }`}
                  >
                    {side} {baseAsset(symbol)}
                  </button>
                </>
              )}

              {/* ── STRATEGY ── */}
              {mode === "strategy" && (
                <>
                  <div>
                    <label className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
                      Strategy
                    </label>
                    <select
                      value={strategyTemplate}
                      onChange={(e) => setStrategyTemplate(e.target.value)}
                      className="w-full rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5 font-mono text-sm text-text-primary outline-none transition-all duration-300 focus:border-accent/30 focus:ring-2 focus:ring-accent/15"
                    >
                      <option value="grid">Grid Trading</option>
                      <option value="dca">DCA (Dollar Cost Avg)</option>
                      <option value="momentum">Momentum Breakout</option>
                      <option value="mean">Mean Reversion</option>
                    </select>
                  </div>

                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                        TP %
                      </label>
                      <input
                        type="number"
                        value={tpPercent}
                        onChange={(e) => setTpPercent(e.target.value)}
                        className="w-full rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5 font-mono text-xs text-text-primary outline-none transition-all duration-200 focus:border-accent/30 focus:ring-2 focus:ring-accent/15"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                        SL %
                      </label>
                      <input
                        type="number"
                        value={slPercent}
                        onChange={(e) => setSlPercent(e.target.value)}
                        className="w-full rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5 font-mono text-xs text-text-primary outline-none transition-all duration-200 focus:border-accent/30 focus:ring-2 focus:ring-accent/15"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
                      Amount ({baseAsset(symbol)})
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={stratAmount}
                      onChange={(e) => setStratAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-2.5 font-mono text-sm text-text-primary placeholder:text-text-muted/50 transition-all duration-300 focus:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/15"
                    />
                  </div>

                  <button
                    onClick={handleDeployStrategy}
                    className="w-full rounded-xl bg-white/8 px-5 py-2.5 text-sm font-semibold text-text-primary transition-all duration-300 hover:bg-white/10 hover:shadow-[0_0_25px_-8px_rgba(120,81,233,0.1)]"
                  >
                    Deploy Strategy
                  </button>
                </>
              )}

              {/* ── INTENT ── */}
              {mode === "intent" && (
                <>
                  <div>
                    <label className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
                      What do you want to do?
                    </label>
                    <textarea
                      value={intentText}
                      onChange={(e) => setIntentText(e.target.value)}
                      placeholder='e.g. "buy XLM if it drops to $0.11"'
                      rows={3}
                      className="w-full resize-none rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-2.5 font-mono text-sm text-text-primary placeholder:text-text-muted/50 transition-all duration-300 focus:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/15"
                    />
                  </div>

                  {!intentPlan ? (
                    <button
                      onClick={handleParseIntent}
                      className="w-full rounded-xl bg-white/8 px-5 py-2.5 text-sm font-semibold text-text-primary transition-all duration-300 hover:bg-white/10 hover:shadow-[0_0_25px_-8px_rgba(120,81,233,0.1)]"
                    >
                      Parse Intent
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-accent/10 bg-accent-muted/50 p-3.5">
                        <p className="font-mono text-xs text-accent/90">{intentPlan}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setIntentPlan(null); setIntentText(""); }}
                          className="flex-1 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-text-muted transition-all duration-200 hover:bg-white/[0.05] hover:text-text-secondary"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleConfirmIntent}
                          className="flex-1 rounded-xl bg-accent/70 px-3 py-2 text-xs font-semibold text-white transition-all duration-300 hover:bg-accent hover:shadow-[0_0_25px_-8px_rgba(120,81,233,0.2)]"
                        >
                          Confirm
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ── AGENT AUTO ── */}
              {mode === "agent" && (
                <>
                  <div>
                    <label className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
                      Risk Level
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="1"
                        max="10"
                        value={riskLevel}
                        onChange={(e) => setRiskLevel(Number(e.target.value))}
                        className="flex-1 accent-accent"
                      />
                      <span className="w-6 text-center font-mono text-sm text-text-primary">{riskLevel}</span>
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-text-muted">
                      {riskLevel <= 3 ? "Conservative" : riskLevel <= 7 ? "Moderate" : "Aggressive"}
                    </p>
                  </div>

                  <div>
                    <label className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
                      Allocated Capital (USD)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={agentCapital}
                      onChange={(e) => setAgentCapital(e.target.value)}
                      className="w-full rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-2.5 font-mono text-sm text-text-primary outline-none transition-all duration-300 focus:border-accent/30 focus:ring-2 focus:ring-accent/15"
                    />
                  </div>

                  <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-text-muted">Status</span>
                      <span className={`font-mono text-[10px] font-medium ${agentRunning ? "text-success" : "text-text-muted"}`}>
                        {agentRunning ? "Running" : "Stopped"}
                      </span>
                    </div>
                    {agentRunning && (
                      <p className="mt-1 font-mono text-[9px] text-text-muted/60">
                        Monitoring market conditions...
                      </p>
                    )}
                  </div>

                  <button
                    onClick={handleToggleAgent}
                    className={`w-full rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all duration-300 ${
                      agentRunning
                        ? "bg-red-600/80 shadow-[0_0_25px_-10px_rgba(239,68,68,0.15)] hover:bg-red-600"
                        : "bg-emerald-600/80 shadow-[0_0_25px_-10px_rgba(52,211,153,0.15)] hover:bg-emerald-600"
                    }`}
                  >
                    {agentRunning ? "Stop Agent" : "Start Agent"}
                  </button>
                </>
              )}
            </CardBody>
          </Card>

          <DelegationKit />

          {/* Position snapshot */}
          {heldPosition && (
            <Card>
              <CardBody className="space-y-3">
                <p className="font-display text-sm font-medium text-text-primary">{baseAsset(symbol)}</p>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Amount</span>
                  <span className="font-mono text-sm tabular-nums text-text-secondary">{formatNumber(heldPosition.amount)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Entry</span>
                  <span className="font-mono text-sm tabular-nums text-text-secondary">{formatPrice(heldPosition.entryPrice)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Mark</span>
                  <span className="font-mono text-sm tabular-nums text-text-secondary">{formatPrice(heldPosition.currentPrice ?? livePrice)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-white/5 pt-2.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">P&amp;L</span>
                  <span className={`font-mono text-sm tabular-nums ${(heldPosition.pnl ?? 0) >= 0 ? "text-success" : "text-error"}`}>
                    {formatUsd(heldPosition.pnl ?? 0)} ({(heldPosition.pnlPct ?? 0) >= 0 ? "+" : ""}{(heldPosition.pnlPct ?? 0).toFixed(2)}%)
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
