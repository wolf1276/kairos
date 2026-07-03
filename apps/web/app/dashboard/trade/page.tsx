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
import {
  fetchAccountBalances,
  fetchOrderBookQuote,
  executeSwap,
  executeSwapStrictReceive,
  addTrustline,
  TESTNET_USDC_ISSUER,
  type WalletState,
  type SwapAsset,
  type AccountBalance,
  type OrderBookQuote,
} from "@/app/lib/stellar";

type Side = "BUY" | "SELL";
type TradeMode = "manual" | "strategy" | "intent" | "agent";

const MODES: { value: TradeMode; label: string; preview?: boolean }[] = [
  { value: "manual", label: "Manual" },
  { value: "strategy", label: "Strategy", preview: true },
  { value: "intent", label: "Intent", preview: true },
  { value: "agent", label: "Agent Auto", preview: true },
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

  // ── Real on-chain trading — XLM is the only asset in this list that actually exists on
  // Stellar, so it's the only symbol that can execute a real swap. Everything else stays on
  // the simulated paper engine above until a bridge/synthetic layer makes it real too.
  const isRealPair = symbol === "XLMUSDT";
  const XLM_ASSET: SwapAsset = useMemo(() => ({ code: "XLM" }), []);
  const USDC_ASSET: SwapAsset = useMemo(() => ({ code: "USDC", issuer: TESTNET_USDC_ISSUER }), []);

  const [connectedWallet, setConnectedWallet] = useState<WalletState | null>(null);
  const [realBalances, setRealBalances] = useState<AccountBalance[]>([]);
  const [realQuote, setRealQuote] = useState<OrderBookQuote>({ hasLiquidity: false, price: null });
  const [swapping, setSwapping] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [addingTrustline, setAddingTrustline] = useState(false);

  const refreshRealBalances = useCallback(async () => {
    if (!connectedWallet) { setRealBalances([]); return; }
    try {
      setRealBalances(await fetchAccountBalances(connectedWallet.address, connectedWallet.networkPassphrase));
    } catch {
      setRealBalances([]);
    }
  }, [connectedWallet]);

  const connectEventSubscribed = useRef(false);

  useSyncExternalStore(
    (onStoreChange) => {
      if (connectEventSubscribed.current || !connectedWallet) return () => { connectEventSubscribed.current = false; };
      connectEventSubscribed.current = true;
      (async () => {
        await refreshRealBalances();
        onStoreChange();
      })();
      return () => { connectEventSubscribed.current = false; };
    },
    () => realBalances,
    () => [],
  );

  useEffect(() => {
    if (!isRealPair) return;
    const networkPassphrase = connectedWallet?.networkPassphrase ?? "Test SDF Network ; September 2015";
    let cancelled = false;
    const load = async () => {
      try {
        const q = side === "BUY"
          ? await fetchOrderBookQuote(USDC_ASSET, XLM_ASSET, networkPassphrase)
          : await fetchOrderBookQuote(XLM_ASSET, USDC_ASSET, networkPassphrase);
        if (!cancelled) setRealQuote(q);
      } catch {
        if (!cancelled) setRealQuote({ hasLiquidity: false, price: null });
      }
    };
    load();
    const id = setInterval(load, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, [isRealPair, side, connectedWallet, USDC_ASSET, XLM_ASSET]);

  const usdcEntry = realBalances.find((b) => b.code === "USDC" && b.issuer === TESTNET_USDC_ISSUER);
  const hasUsdcTrustline = usdcEntry !== undefined;
  const realXlmBalance = parseFloat(
    realBalances.find((b) => b.code === "XLM")?.balance || "0"
  );
  const realUsdcBalance = parseFloat(usdcEntry?.balance || "0");
  // BUY spends USDC to receive XLM, so the cap on "how much XLM can I buy" is priced in USDC
  // balance / quote price; SELL spends XLM directly, so the cap is the XLM balance itself.
  const realMaxAmount = side === "BUY"
    ? (realQuote.price ? realUsdcBalance / realQuote.price : 0)
    : realXlmBalance;

  const SLIPPAGE = 0.01; // 1% tolerance on top of the last quoted price

  const handleAddUsdcTrustline = async () => {
    if (!connectedWallet) return;
    setAddingTrustline(true);
    setSwapError(null);
    try {
      await addTrustline(connectedWallet.address, USDC_ASSET, connectedWallet.networkPassphrase);
      flash("ok", "USDC trustline added");
      await refreshRealBalances();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSwapError(msg);
      flash("err", msg);
    } finally {
      setAddingTrustline(false);
    }
  };

  const handleRealSwap = async () => {
    if (!connectedWallet || amountNum <= 0 || !realQuote.price) return;
    setSwapping(true);
    setSwapError(null);
    try {
      if (side === "BUY") {
        // Buying exactly `amountNum` XLM, paying up to quote price + slippage in USDC.
        const sendMax = (amountNum * realQuote.price * (1 + SLIPPAGE)).toFixed(7);
        const result = await executeSwapStrictReceive({
          sourceAddress: connectedWallet.address,
          sendAsset: USDC_ASSET,
          sendMax,
          destAsset: XLM_ASSET,
          destAmount: amountNum.toFixed(7),
          networkPassphrase: connectedWallet.networkPassphrase,
        });
        flash("ok", `Bought ${formatNumber(amountNum)} XLM — tx ${result.hash.slice(0, 8)}…`);
      } else {
        // Selling exactly `amountNum` XLM, accepting at least price - slippage in USDC.
        const destMin = (amountNum * realQuote.price * (1 - SLIPPAGE)).toFixed(7);
        const result = await executeSwap({
          sourceAddress: connectedWallet.address,
          sendAsset: XLM_ASSET,
          sendAmount: amountNum.toFixed(7),
          destAsset: USDC_ASSET,
          destMin,
          networkPassphrase: connectedWallet.networkPassphrase,
        });
        flash("ok", `Sold ${formatNumber(amountNum)} XLM — tx ${result.hash.slice(0, 8)}…`);
      }
      setAmount("");
      await refreshRealBalances();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSwapError(msg);
      flash("err", msg);
    } finally {
      setSwapping(false);
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
    flash("ok", `Preview only — not deployed: ${strategyTemplate} ${formatNumber(amt)} ${baseAsset(symbol)} TP ${tpPercent}% SL ${slPercent}%`);
    setStratAmount("");
  };

  // ── Intent trade ──
  const [intentText, setIntentText] = useState("");
  const [intentPlan, setIntentPlan] = useState<string | null>(null);

  const handleParseIntent = () => {
    if (!intentText.trim()) { flash("err", "Describe what you want to do"); return; }
    setIntentPlan(`Preview — this is not a real AI parse yet: "${intentText}" for ${baseAsset(symbol)}`);
  };

  const handleConfirmIntent = () => {
    flash("ok", "Preview dismissed — no trade was placed");
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
      flash("ok", `Preview only — no agent deployed (risk ${riskLevel}/10, capital $${agentCapital})`);
    } else {
      flash("ok", "Preview stopped");
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
              "flex cursor-pointer items-center gap-1.5 rounded-[7px] px-4 py-1.5 font-mono text-xs font-medium transition-all duration-300",
              mode === m.value
                ? "bg-white/8 text-text-primary shadow-[0_0_20px_-8px_rgba(120,81,233,0.12)]"
                : "text-text-muted hover:text-text-secondary",
            )}
          >
            {m.label}
            {m.preview && (
              <span className="rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-amber-400/80">
                Preview
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Preview-mode disclosure — these modes don&apos;t execute anything yet */}
      {MODES.find((m) => m.value === mode)?.preview && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-400/15 bg-amber-400/[0.05] px-4 py-2.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
          <p className="text-xs text-amber-300/85">
            Preview mode &mdash; shows what this flow will look like, but nothing here executes a
            real trade yet. Use <span className="font-medium text-amber-200">Manual</span> for
            actual paper trading.
          </p>
        </div>
      )}

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
                  <div className="flex items-center justify-between">
                    <Segmented
                      options={[
                        { value: "BUY", label: "Buy" },
                        { value: "SELL", label: "Sell" },
                      ]}
                      value={side}
                      onChange={(v) => { setSide(v); setAmount(""); setSwapError(null); }}
                      className="flex-1"
                    />
                    <span
                      className={`ml-3 rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider ${
                        isRealPair
                          ? "bg-emerald-500/10 text-emerald-400/85"
                          : "bg-amber-400/10 text-amber-400/80"
                      }`}
                    >
                      {isRealPair ? "Real" : "Paper"}
                    </span>
                  </div>

                  {isRealPair ? (
                    <>
                      {!connectedWallet ? (
                        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5 text-center">
                          <p className="text-xs text-text-secondary">
                            Connect Freighter below to trade real XLM.
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3.5 py-2.5">
                            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                              DEX Price (XLM/USDC)
                            </span>
                            <span className="font-mono text-sm tabular-nums text-text-primary">
                              {realQuote.price ? realQuote.price.toFixed(4) : "No liquidity"}
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-[11px] text-text-muted">
                            <span>Balance</span>
                            <span className="font-mono tabular-nums text-text-secondary">
                              {formatNumber(realXlmBalance)} XLM · {hasUsdcTrustline ? `${formatNumber(realUsdcBalance)} USDC` : "no USDC trustline"}
                            </span>
                          </div>

                          {!hasUsdcTrustline && (
                            <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.05] p-3.5">
                              <p className="text-xs text-amber-300/85">
                                You need a USDC trustline to {side === "BUY" ? "spend USDC" : "receive USDC"} on this swap.
                              </p>
                              <button
                                onClick={handleAddUsdcTrustline}
                                disabled={addingTrustline}
                                className="mt-2.5 w-full rounded-lg bg-amber-400/15 px-3 py-2 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {addingTrustline ? "Adding trustline…" : "Add USDC Trustline"}
                              </button>
                            </div>
                          )}

                          <div>
                            <div className="mb-1.5 flex items-center justify-between">
                              <label className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
                                Amount (XLM)
                              </label>
                              <span className="font-mono text-[10px] text-text-muted">
                                Max {formatNumber(realMaxAmount)}
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
                                  onClick={() => setAmount(realMaxAmount > 0 ? String(Number((realMaxAmount * pct).toFixed(6))) : "")}
                                  className="flex-1 rounded-lg border border-white/5 bg-white/[0.02] py-1.5 font-mono text-[11px] text-text-muted transition-all duration-200 hover:bg-white/[0.05] hover:text-text-secondary"
                                >
                                  {pct * 100}%
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="flex items-center justify-between text-xs">
                            <span className="text-text-muted">
                              Est. {side === "BUY" ? "cost" : "proceeds"} (1% slippage tolerance)
                            </span>
                            <span className="font-mono tabular-nums text-text-secondary">
                              {realQuote.price ? formatUsd(amountNum * realQuote.price) : "—"}
                            </span>
                          </div>

                          {swapError && (
                            <p className="text-xs text-error/90">{swapError}</p>
                          )}

                          <button
                            onClick={handleRealSwap}
                            disabled={
                              swapping ||
                              !hasUsdcTrustline ||
                              !realQuote.hasLiquidity ||
                              amountNum <= 0 ||
                              amountNum > realMaxAmount + 1e-9
                            }
                            className={`w-full rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-30 ${
                              side === "BUY"
                                ? "bg-emerald-600/80 shadow-[0_0_25px_-10px_rgba(52,211,153,0.15)] hover:bg-emerald-600"
                                : "bg-red-600/80 shadow-[0_0_25px_-10px_rgba(239,68,68,0.15)] hover:bg-red-600"
                            }`}
                          >
                            {swapping ? "Submitting…" : `${side} XLM (real)`}
                          </button>
                        </>
                      )}
                    </>
                  ) : (
                    <>
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

                      <p className="text-[11px] text-text-muted">
                        {baseAsset(symbol)} isn&apos;t a Stellar asset, so this trades against
                        your simulated paper balance, not a real venue.
                      </p>

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
                        {side} {baseAsset(symbol)} (paper)
                      </button>
                    </>
                  )}
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
                    Preview Strategy
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
                      Preview Intent
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
                    {agentRunning ? "Stop Preview" : "Start Preview"}
                  </button>
                </>
              )}
            </CardBody>
          </Card>

          <DelegationKit onWalletChange={setConnectedWallet} />

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
