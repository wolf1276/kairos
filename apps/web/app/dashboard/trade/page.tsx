"use client";

import { Suspense, useState, useCallback, useEffect, useRef } from "react";
import { Asset } from "@stellar/stellar-sdk";
import { AdvancedChart } from "@/app/components/charts/AdvancedChart";
import { PriceViewPanel } from "@/app/components/panels/PriceViewPanel";
import { Card, CardBody } from "@/app/components/ui/Card";
import { usePrices } from "@/app/hooks/usePrices";
import { useSmartWallet } from "@/app/hooks/useSmartWallet";
import { useStellarBalances } from "@/app/hooks/useStellarBalances";
import {
  formatNumber,
} from "@/app/lib/format";
import { cn } from "@/lib/utils";
import {
  fetchOrderBookQuote,
  executeSwap,
  addTrustline,
  signDelegationHashWithFreighter,
  signAuthEntryWithFreighter,
  delegateXLM,
  TESTNET_USDC_ISSUER,
  type SwapAsset,
  type OrderBookQuote,
} from "@/app/lib/stellar";
import { TokenSearchSelect } from "./components/TokenSearchSelect";
import { TickerTape } from "./components/TickerTape";

type TradeMode = "manual" | "strategy" | "intent" | "agent";

const CHART_SYMBOLS = ["XLMUSDT", "BTCUSDT", "ETHUSDT", "SOLUSDT"];
const TICKER_SYMBOLS = ["XLMUSDT", "BTCUSDT", "ETHUSDT", "SOLUSDT", "USDCUSDT"];

const MODES: { value: TradeMode; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "strategy", label: "Strategy" },
  { value: "intent", label: "Intent" },
  { value: "agent", label: "Agent Auto" },
];

function TradeInner() {
  const [chartSymbol, setChartSymbol] = useState("XLMUSDT");
  const { tickers, wsStatus } = usePrices(TICKER_SYMBOLS, 10000);
  const ticker = tickers[chartSymbol];

  const { wallet, connected, connecting, connect, disconnect, smartWalletAddress, deploying, deployError } = useSmartWallet();
  const { xlmBalance, usdcBalance, hasUsdcTrustline, allBalances, loading: balancesLoading, refresh: refreshBalances } = useStellarBalances(
    wallet?.address ?? null,
    wallet?.networkPassphrase ?? null,
  );
  // The delegation-based modes (Strategy/Intent/Agent) spend from the smart wallet, not the
  // connected EOA — a separate balance poll is needed since that's a different account.
  const { xlmBalance: swXlmBalance, loading: swBalanceLoading, refresh: refreshSwBalance } = useStellarBalances(
    smartWalletAddress,
    wallet?.networkPassphrase ?? null,
  );

  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const flash = useCallback((kind: "ok" | "err", msg: string) => {
    setToast({ kind, msg });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  // ── Mode ──
  const [mode, setMode] = useState<TradeMode>("manual");

  // ── Manual trade ──
  const [sendAsset, setSendAsset] = useState<SwapAsset>({ code: "USDC", issuer: TESTNET_USDC_ISSUER });
  const [destAsset, setDestAsset] = useState<SwapAsset>({ code: "XLM" });
  const [amount, setAmount] = useState("");
  const amountNum = parseFloat(amount) || 0;

  const [dexQuote, setDexQuote] = useState<OrderBookQuote>({ hasLiquidity: false, price: null });
  const [quoteUpdated, setQuoteUpdated] = useState<number>(0);
  const [quoteAge, setQuoteAge] = useState(0);
  const [swapping, setSwapping] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [addingTrustline, setAddingTrustline] = useState(false);

  const networkPassphrase = wallet?.networkPassphrase ?? "Test SDF Network ; September 2015";

  const getBalance = useCallback(
    (asset: SwapAsset): number => {
      if (asset.code === "XLM" && !asset.issuer) return xlmBalance;
      const entry = allBalances.find((b) => b.code === asset.code && b.issuer === asset.issuer);
      return entry ? parseFloat(entry.balance) : 0;
    },
    [allBalances, xlmBalance],
  );

  const sendBalance = getBalance(sendAsset);
  const destBalance = getBalance(destAsset);

  const needsTrustline = useCallback(
    (asset: SwapAsset): boolean => {
      if (!asset.issuer) return false;
      return !allBalances.some((b) => b.code === asset.code && b.issuer === asset.issuer);
    },
    [allBalances],
  );

  const sendNeedsTrustline = needsTrustline(sendAsset);
  const destNeedsTrustline = needsTrustline(destAsset);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const q = await fetchOrderBookQuote(sendAsset, destAsset, networkPassphrase);
        if (!cancelled) { setDexQuote(q); setQuoteUpdated(Date.now()); setQuoteAge(0); }
      } catch {
        if (!cancelled) setDexQuote({ hasLiquidity: false, price: null });
      }
    };
    load();
    const id = setInterval(load, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [sendAsset, destAsset, networkPassphrase]);

  useEffect(() => {
    if (quoteUpdated === 0) return;
    const id = setInterval(() => setQuoteAge((a) => a + 1), 1000);
    return () => clearInterval(id);
  }, [quoteUpdated]);

  const maxAmount = sendBalance;

  const SLIPPAGE = 0.01;

  const flipPair = useCallback(() => {
    setSendAsset(destAsset);
    setDestAsset(sendAsset);
    setAmount("");
    setSwapError(null);
  }, [destAsset, sendAsset]);

  const handleAddTrustline = async (asset: SwapAsset) => {
    if (!wallet || !asset.issuer) return;
    setAddingTrustline(true);
    setSwapError(null);
    try {
      await addTrustline(wallet.address, asset, wallet.networkPassphrase);
      flash("ok", `${asset.code} trustline added`);
      await refreshBalances();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSwapError(msg);
      flash("err", msg);
    } finally {
      setAddingTrustline(false);
    }
  };

  const handleSwap = async () => {
    if (!wallet || amountNum <= 0 || !dexQuote.price) return;
    setSwapping(true);
    setSwapError(null);
    try {
      const destMin = (amountNum * dexQuote.price * (1 - SLIPPAGE)).toFixed(7);
      const result = await executeSwap({
        sourceAddress: wallet.address,
        sendAsset,
        sendAmount: amountNum.toFixed(7),
        destAsset,
        destMin,
        networkPassphrase: wallet.networkPassphrase,
      });
      flash("ok", `Swapped ${formatNumber(amountNum)} ${sendAsset.code} — tx ${result.hash.slice(0, 8)}…`);
      setAmount("");
      await refreshBalances();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSwapError(msg);
      flash("err", msg);
    } finally {
      setSwapping(false);
    }
  };

  // ── Shared delegation creation ──
  const walletOwner = wallet?.address ?? null;
  const [delegating, setDelegating] = useState<string | null>(null);

  // Converts a USD amount into native-XLM stroops using the live ticker price, for building
  // spend-limit caveats from the USD-denominated inputs these modes collect (agentCapital,
  // parsed dailyTradeLimit). Falls back to a conservative $0.10/XLM if no live price yet,
  // rather than silently creating an unlimited-spend delegation.
  const usdToXlmStroops = useCallback((usd: number): bigint => {
    const price = ticker?.price && ticker.price > 0 ? ticker.price : 0.1;
    return BigInt(Math.max(0, Math.round((usd / price) * 10_000_000)));
  }, [ticker]);

  const createTradeDelegation = useCallback(async (
    delegate: string, policies: Record<string, unknown>[]
  ): Promise<{ hash: string; delegation: Record<string, unknown> } | null> => {
    if (!wallet || !smartWalletAddress || !walletOwner) {
      flash("err", "Connect wallet and deploy a smart wallet first.");
      return null;
    }
    try {
      setDelegating("preparing");
      const prepareRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "PREPARE_DELEGATION", delegate, delegator: smartWalletAddress, policies }),
      });
      const prepared = await prepareRes.json();
      if (!prepareRes.ok) throw new Error(prepared.error);

      setDelegating("signing");
      const signatureHex = await signDelegationHashWithFreighter(prepared.hashHex, networkPassphrase, walletOwner);

      setDelegating("submitting");
      const submitRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SUBMIT_DELEGATION", unsignedDelegation: prepared.unsignedDelegation, signatureHex }),
      });
      const data = await submitRes.json();
      if (!submitRes.ok) throw new Error(data.error);

      return { hash: data.hash as string, delegation: data.delegation as Record<string, unknown> };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      flash("err", msg);
      return null;
    } finally {
      setDelegating(null);
    }
  }, [wallet, smartWalletAddress, walletOwner, networkPassphrase, flash]);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flash("ok", "Copied to clipboard");
    } catch {
      flash("err", "Failed to copy");
    }
  }, [flash]);

  // ── Strategy trade ──
  const [strategyTemplate, setStrategyTemplate] = useState("grid");
  const [tpPercent, setTpPercent] = useState("5");
  const [slPercent, setSlPercent] = useState("2");
  const [stratAmount, setStratAmount] = useState("");
  const [strategyResult, setStrategyResult] = useState<{ hash: string } | null>(null);

  const handleDeployStrategy = async () => {
    const amt = parseFloat(stratAmount) || 0;
    if (amt <= 0) { flash("err", "Enter a valid amount"); return; }
    if (!walletOwner) { flash("err", "Connect your wallet first"); return; }
    if (!smartWalletAddress) { flash("err", "Deploy a smart wallet first"); return; }

    const result = await createTradeDelegation(walletOwner, [
      {
        type: "spend-limit",
        token: Asset.native().contractId(networkPassphrase),
        spendLimit: (BigInt(Math.round(amt * 10_000_000))).toString(),
        period: "86400",
      },
      {
        type: "time-restriction",
        start: Math.floor(Date.now() / 1000),
        expiry: Math.floor(Date.now() / 1000) + 30 * 86400,
      },
    ]);

    if (result) {
      setStrategyResult({ hash: result.hash });
      flash("ok", `Strategy deployed — delegation ${result.hash.slice(0, 8)}…`);
    }
  };

  const STRATEGY_LABELS: Record<string, string> = {
    grid: "Grid Trading",
    dca: "DCA",
    momentum: "Momentum Breakout",
    mean: "Mean Reversion",
  };

  // ── Intent trade ──
  const PROFILE_LABELS: Record<string, string> = {
    goal: "Goal",
    riskTolerance: "Risk Tolerance",
    investmentHorizon: "Horizon",
    allowedAssets: "Assets",
    dailyTradeLimit: "Daily Limit",
    maxPositionSize: "Max Size",
    stopLossPreference: "Stop Loss",
    takeProfitPreference: "Take Profit",
  };

  const [intentText, setIntentText] = useState("");
  const [intentProfile, setIntentProfile] = useState<Record<string, unknown> | null>(null);
  const [intentResult, setIntentResult] = useState<{ hash: string } | null>(null);
  const [parsing, setParsing] = useState(false);

  const handleParseIntent = async () => {
    if (!intentText.trim()) { flash("err", "Describe what you want to do"); return; }
    setParsing(true);
    setIntentResult(null);
    try {
      const res = await fetch("/api/intent/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: intentText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setIntentProfile(data.profile ?? data.extracted);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  };

  const handleConfirmIntent = async () => {
    if (!walletOwner || !smartWalletAddress) { flash("err", "Connect your wallet first"); return; }
    if (!intentProfile) { flash("err", "Parse an intent first"); return; }

    const dailyLimitUsd = Number(intentProfile.dailyTradeLimit ?? intentProfile.dailyLimit ?? 0) || 0;
    const result = await createTradeDelegation(walletOwner, [
      {
        type: "spend-limit",
        token: Asset.native().contractId(networkPassphrase),
        spendLimit: usdToXlmStroops(dailyLimitUsd || 100).toString(),
        period: "86400",
      },
      {
        type: "time-restriction",
        start: Math.floor(Date.now() / 1000),
        expiry: Math.floor(Date.now() / 1000) + 30 * 86400,
      },
    ]);

    if (result) {
      setIntentResult({ hash: result.hash });
      flash("ok", `Intent delegation created: ${result.hash.slice(0, 8)}…`);
    }
  };

  // ── Agent auto ──
  const [riskLevel, setRiskLevel] = useState(5);
  const [agentCapital, setAgentCapital] = useState("1000");
  const [agentPubkey, setAgentPubkey] = useState("");
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentDelegationData, setAgentDelegationData] = useState<{ hash: string; delegation: Record<string, unknown> } | null>(null);

  const [stoppingAgent, setStoppingAgent] = useState(false);

  const handleStopAgent = async () => {
    if (!agentDelegationData || !walletOwner) {
      setAgentRunning(false);
      return;
    }
    setStoppingAgent(true);
    try {
      // "Stop" must actually revoke the on-chain delegation — otherwise the agent's key
      // still has live spend authority regardless of what this page's local state says.
      const prepareRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "PREPARE_REVOKE_DELEGATION", delegation: agentDelegationData.delegation }),
      });
      const prepared = await prepareRes.json();
      if (!prepareRes.ok) throw new Error(prepared.error);

      const signedEntryXdr = await signAuthEntryWithFreighter(
        prepared.unsignedEntryXdr,
        prepared.validUntilLedgerSeq,
        networkPassphrase,
        walletOwner
      );

      const submitRes = await fetch("/api/delegate-sdk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SUBMIT_REVOKE_DELEGATION", delegation: agentDelegationData.delegation, signedEntryXdr }),
      });
      const data = await submitRes.json();
      if (!submitRes.ok) throw new Error(data.error);

      flash("ok", "Agent stopped — delegation revoked on-chain");
      setAgentRunning(false);
      setAgentDelegationData(null);
    } catch (e) {
      flash("err", `Failed to revoke delegation: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setStoppingAgent(false);
    }
  };

  const handleToggleAgent = async () => {
    if (agentRunning) {
      await handleStopAgent();
      return;
    }
    if (!walletOwner) { flash("err", "Connect your wallet first"); return; }
    if (!smartWalletAddress) { flash("err", "Deploy a smart wallet first"); return; }
    if (!agentPubkey.trim()) { flash("err", "Enter the agent's public key"); return; }

    const durationDays = riskLevel <= 3 ? 7 : riskLevel <= 7 ? 30 : 90;
    const capitalUsd = parseFloat(agentCapital) || 0;
    const result = await createTradeDelegation(agentPubkey.trim(), [
      {
        type: "spend-limit",
        token: Asset.native().contractId(networkPassphrase),
        spendLimit: usdToXlmStroops(capitalUsd).toString(),
        period: "86400",
      },
      {
        type: "time-restriction",
        start: Math.floor(Date.now() / 1000),
        expiry: Math.floor(Date.now() / 1000) + durationDays * 86400,
      },
    ]);

    if (result) {
      setAgentDelegationData(result);
      setAgentRunning(true);
      flash("ok", `Agent delegation created: ${result.hash.slice(0, 8)}…`);
    }
  };

  // ── Fund smart wallet (delegation-based modes spend from here, not the connected EOA) ──
  const [fundAmount, setFundAmount] = useState("");
  const [funding, setFunding] = useState(false);

  const handleFundSmartWallet = async () => {
    if (!wallet || !smartWalletAddress) return;
    const amt = parseFloat(fundAmount) || 0;
    if (amt <= 0) { flash("err", "Enter a valid amount"); return; }
    setFunding(true);
    try {
      await delegateXLM(fundAmount, smartWalletAddress, wallet.networkPassphrase, wallet.sorobanRpcUrl);
      flash("ok", `Sent ${fundAmount} XLM to smart wallet`);
      setFundAmount("");
      await refreshSwBalance();
    } catch (e) {
      flash("err", e instanceof Error ? e.message : String(e));
    } finally {
      setFunding(false);
    }
  };

  const downloadDelegationJson = useCallback(() => {
    if (!agentDelegationData) return;
    const blob = new Blob([JSON.stringify(agentDelegationData.delegation, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `delegation-${agentDelegationData.hash.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [agentDelegationData]);

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

      {/* Ticker tape */}
      <TickerTape tickers={tickers} />

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
          </button>
        ))}
      </div>

      {/* Main layout — bento grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Chart + Price panel column */}
        <div className="space-y-6 lg:col-span-2">
          <AdvancedChart
            symbol={chartSymbol}
            symbols={CHART_SYMBOLS}
            onSymbolChange={setChartSymbol}
          />
          <PriceViewPanel symbol={chartSymbol} ticker={ticker} wsStatus={wsStatus} />
        </div>

        {/* Sidebar — form + wallet */}
        <div className="space-y-6 lg:col-span-1">
          {/* Mode-specific form */}
          <Card>
            <CardBody className="space-y-4">
              {/* ── MANUAL ── */}
              {mode === "manual" && (
                <>
                  <span className="mb-2 rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-emerald-400/85 self-start">
                    Real
                  </span>

                  {!connected ? (
                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5 text-center">
                      <p className="text-xs text-text-secondary">
                        Connect Freighter to trade on Stellar testnet.
                      </p>
                      <button
                        onClick={connect}
                        disabled={connecting}
                        className="mt-3 w-full rounded-xl bg-accent/70 px-4 py-2 text-xs font-semibold text-white transition-all duration-300 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {connecting ? "Connecting…" : "Connect Freighter"}
                      </button>
                    </div>
                  ) : (
                    <>
                      <TokenSearchSelect
                        balances={allBalances}
                        value={sendAsset}
                        onChange={setSendAsset}
                        label="You Pay"
                        otherAsset={destAsset}
                      />

                      <div className="flex justify-center">
                        <button
                          type="button"
                          onClick={flipPair}
                          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/5 bg-white/[0.02] text-text-muted hover:border-accent/30 hover:text-accent transition-all duration-200 cursor-pointer"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <polyline points="17 1 21 5 17 9" />
                            <polyline points="7 15 3 19 7 23" />
                            <line x1="21" y1="5" x2="3" y2="5" />
                            <line x1="15" y1="19" x2="3" y2="19" />
                          </svg>
                        </button>
                      </div>

                      <TokenSearchSelect
                        balances={allBalances}
                        value={destAsset}
                        onChange={setDestAsset}
                        label="You Receive"
                        otherAsset={sendAsset}
                      />

                      <div className="rounded-lg bg-white/[0.02] px-3.5 py-2.5">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                            DEX Price
                          </span>
                          <span className="font-mono text-sm tabular-nums text-text-primary">
                            {dexQuote.price
                              ? `1 ${sendAsset.code} ≈ ${dexQuote.price.toFixed(4)} ${destAsset.code}`
                              : "No liquidity"}
                          </span>
                        </div>
                        {quoteUpdated > 0 && (
                          <p className="mt-0.5 text-right font-mono text-[9px] text-text-muted">
                            {quoteAge}s ago
                          </p>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-text-muted">
                        <span>Balances</span>
                        <span className="font-mono tabular-nums text-text-secondary">
                          {balancesLoading
                            ? "Loading…"
                            : `${formatNumber(sendBalance)} ${sendAsset.code} | ${formatNumber(destBalance)} ${destAsset.code}`}
                        </span>
                      </div>

                      {(sendNeedsTrustline || destNeedsTrustline) && (
                        <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.05] p-3.5">
                          <p className="text-xs text-amber-300/85">
                            Need trustline{destNeedsTrustline && sendNeedsTrustline ? "s" : ""}:
                            {sendNeedsTrustline && ` ${sendAsset.code}`}
                            {destNeedsTrustline && ` ${destAsset.code}`}
                          </p>
                          {sendNeedsTrustline && (
                            <button
                              onClick={() => handleAddTrustline(sendAsset)}
                              disabled={addingTrustline}
                              className="mt-2 w-full rounded-lg bg-amber-400/15 px-3 py-2 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {addingTrustline ? "Adding…" : `Add ${sendAsset.code} Trustline`}
                            </button>
                          )}
                          {destNeedsTrustline && (
                            <button
                              onClick={() => handleAddTrustline(destAsset)}
                              disabled={addingTrustline}
                              className="mt-2 w-full rounded-lg bg-amber-400/15 px-3 py-2 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {addingTrustline ? "Adding…" : `Add ${destAsset.code} Trustline`}
                            </button>
                          )}
                        </div>
                      )}

                      <div>
                        <div className="mb-1.5 flex items-center justify-between">
                          <label className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
                            Amount ({sendAsset.code})
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
                        <span className="text-text-muted">
                          Est. proceeds (1% slippage tolerance)
                        </span>
                        <span className="font-mono tabular-nums text-text-secondary">
                          {dexQuote.price ? `${formatNumber(amountNum * dexQuote.price)} ${destAsset.code}` : "—"}
                        </span>
                      </div>

                      {swapError && (
                        <p className="text-xs text-error/90">{swapError}</p>
                      )}

                      <button
                        onClick={handleSwap}
                        disabled={
                          swapping ||
                          sendNeedsTrustline ||
                          destNeedsTrustline ||
                          !dexQuote.hasLiquidity ||
                          amountNum <= 0 ||
                          amountNum > maxAmount + 1e-9
                        }
                        className="w-full rounded-xl bg-emerald-600/80 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_25px_-10px_rgba(52,211,153,0.15)] transition-all duration-300 hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        {swapping ? "Submitting…" : `Swap ${sendAsset.code} → ${destAsset.code}`}
                      </button>
                    </>
                  )}
                </>
              )}

              {/* ── STRATEGY ── */}
              {mode === "strategy" && (
                strategyResult ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 rounded-xl border border-success/15 bg-success/6 px-4 py-3">
                      <span className="text-sm text-success">✓</span>
                      <p className="text-xs font-medium text-success/85">Strategy deployed</p>
                    </div>
                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Strategy</span>
                        <span className="font-mono text-xs text-text-secondary">{STRATEGY_LABELS[strategyTemplate] ?? strategyTemplate}</span>
                      </div>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Amount</span>
                        <span className="font-mono text-xs text-text-secondary">{formatNumber(parseFloat(stratAmount) || 0)} XLM</span>
                      </div>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">TP / SL</span>
                        <span className="font-mono text-xs text-text-secondary">{tpPercent}% / {slPercent}%</span>
                      </div>
                      <div className="flex items-center justify-between border-t border-white/5 pt-2">
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Delegation</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-text-secondary">{strategyResult.hash.slice(0, 8)}…</span>
                          <button onClick={() => copyToClipboard(strategyResult.hash)} className="text-[10px] text-accent/70 hover:text-accent">Copy</button>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <a href="/dashboard/delegations-v2" className="flex-1 rounded-xl bg-accent/70 px-3 py-2 text-center text-xs font-semibold text-white transition-all duration-300 hover:bg-accent">View Delegations →</a>
                      <button onClick={() => setStrategyResult(null)} className="flex-1 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-text-muted transition-all duration-200 hover:bg-white/[0.05] hover:text-text-secondary">Deploy Another</button>
                    </div>
                  </div>
                ) : (
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
                        Amount (XLM)
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
                      disabled={delegating !== null}
                      className="w-full rounded-xl bg-white/8 px-5 py-2.5 text-sm font-semibold text-text-primary transition-all duration-300 hover:bg-white/10 hover:shadow-[0_0_25px_-8px_rgba(120,81,233,0.1)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {delegating ? `Delegation ${delegating}…` : "Deploy Strategy"}
                    </button>
                  </>
                )
              )}

              {/* ── INTENT ── */}
              {mode === "intent" && (
                intentResult ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 rounded-xl border border-success/15 bg-success/6 px-4 py-3">
                      <span className="text-sm text-success">✓</span>
                      <p className="text-xs font-medium text-success/85">Delegation created</p>
                    </div>
                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
                      {intentProfile && Object.entries(intentProfile).map(([key, val]) => (
                        <div key={key} className="flex items-center justify-between py-0.5">
                          <span className="font-mono text-[10px] text-text-muted">{PROFILE_LABELS[key] ?? key}</span>
                          <span className="font-mono text-xs text-text-secondary">{Array.isArray(val) ? val.join(", ") : String(val)}</span>
                        </div>
                      ))}
                      <div className="mt-2 flex items-center justify-between border-t border-white/5 pt-2">
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Delegation</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-text-secondary">{intentResult.hash.slice(0, 8)}…</span>
                          <button onClick={() => copyToClipboard(intentResult.hash)} className="text-[10px] text-accent/70 hover:text-accent">Copy</button>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <a href="/dashboard/delegations-v2" className="flex-1 rounded-xl bg-accent/70 px-3 py-2 text-center text-xs font-semibold text-white transition-all duration-300 hover:bg-accent">View Delegations →</a>
                      <button onClick={() => { setIntentResult(null); setIntentProfile(null); setIntentText(""); }} className="flex-1 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-text-muted transition-all duration-200 hover:bg-white/[0.05] hover:text-text-secondary">Create Another</button>
                    </div>
                  </div>
                ) : (
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

                    {!intentProfile ? (
                      <button
                        onClick={handleParseIntent}
                        disabled={parsing || delegating !== null}
                        className="w-full rounded-xl bg-white/8 px-5 py-2.5 text-sm font-semibold text-text-primary transition-all duration-300 hover:bg-white/10 hover:shadow-[0_0_25px_-8px_rgba(120,81,233,0.1)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {parsing ? "Parsing…" : "Parse Intent"}
                      </button>
                    ) : (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-accent/10 bg-accent-muted/50 p-3.5">
                          <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-accent/70">Trading Profile</p>
                          {Object.entries(intentProfile).map(([key, val]) => (
                            <div key={key} className="flex items-center justify-between py-0.5">
                              <span className="font-mono text-[10px] text-text-muted">{PROFILE_LABELS[key] ?? key}</span>
                              <span className="font-mono text-xs text-text-secondary">{Array.isArray(val) ? val.join(", ") : String(val)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => { setIntentProfile(null); setIntentText(""); }}
                            disabled={delegating !== null}
                            className="flex-1 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-text-muted transition-all duration-200 hover:bg-white/[0.05] hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleConfirmIntent}
                            disabled={delegating !== null}
                            className="flex-1 rounded-xl bg-accent/70 px-3 py-2 text-xs font-semibold text-white transition-all duration-300 hover:bg-accent hover:shadow-[0_0_25px_-8px_rgba(120,81,233,0.2)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {delegating ? `Delegation ${delegating}…` : "Confirm & Deploy"}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )
              )}

              {/* ── AGENT AUTO ── */}
              {mode === "agent" && (
                agentDelegationData ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 rounded-xl border border-success/15 bg-success/6 px-4 py-3">
                      <span className="text-sm text-success">✓</span>
                      <p className="text-xs font-medium text-success/85">Agent started</p>
                    </div>
                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Delegate</span>
                        <span className="font-mono text-xs text-text-secondary">{agentPubkey.slice(0, 6)}…{agentPubkey.slice(-4)}</span>
                      </div>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Risk</span>
                        <span className="font-mono text-xs capitalize text-text-secondary">{riskLevel <= 3 ? "Conservative" : riskLevel <= 7 ? "Moderate" : "Aggressive"}</span>
                      </div>
                      <div className="flex items-center justify-between border-t border-white/5 pt-2">
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Delegation</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-text-secondary">{agentDelegationData.hash.slice(0, 8)}…</span>
                          <button onClick={() => copyToClipboard(agentDelegationData.hash)} className="text-[10px] text-accent/70 hover:text-accent">Copy</button>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.05] p-3.5">
                      <p className="text-xs text-amber-300/85">
                        Save this delegation to <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-[10px]">~/.kairos/delegations/</code> for the MCP agent to pick it up.
                      </p>
                      <button
                        onClick={downloadDelegationJson}
                        className="mt-2.5 w-full rounded-lg bg-amber-400/15 px-3 py-2 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-400/20"
                      >
                        Download Delegation JSON
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <a href="/dashboard/delegations-v2" className="flex-1 rounded-xl bg-accent/70 px-3 py-2 text-center text-xs font-semibold text-white transition-all duration-300 hover:bg-accent">View Delegations →</a>
                      <button
                        onClick={handleStopAgent}
                        disabled={stoppingAgent}
                        className="flex-1 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-text-muted transition-all duration-200 hover:bg-white/[0.05] hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {stoppingAgent ? "Revoking…" : "Stop (Revoke)"}
                      </button>
                    </div>
                  </div>
                ) : (
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
                        {riskLevel <= 3 ? "Conservative (7d)" : riskLevel <= 7 ? "Moderate (30d)" : "Aggressive (90d)"}
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

                    <div>
                      <label className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
                        Agent Public Key
                      </label>
                      <input
                        type="text"
                        value={agentPubkey}
                        onChange={(e) => setAgentPubkey(e.target.value)}
                        placeholder="G…"
                        className="w-full rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-2.5 font-mono text-xs text-text-primary placeholder:text-text-muted/50 transition-all duration-300 focus:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/15"
                      />
                    </div>

                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] text-text-muted">Status</span>
                        <span className="font-mono text-[10px] font-medium text-text-muted">Stopped</span>
                      </div>
                    </div>

                    <button
                      onClick={handleToggleAgent}
                      disabled={delegating !== null}
                      className="w-full rounded-xl bg-emerald-600/80 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_25px_-10px_rgba(52,211,153,0.15)] transition-all duration-300 hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      {delegating ? `Delegation ${delegating}…` : "Start Agent"}
                    </button>
                  </>
                )
              )}
            </CardBody>
          </Card>

          {/* Wallet status */}
          <Card>
            <CardBody className="space-y-3">
              <p className="font-display text-sm font-medium text-text-primary">Wallet</p>
              {!connected ? (
                <div className="text-center">
                  <p className="mb-3 text-xs text-text-muted">Connect Freighter to trade and manage your smart wallet.</p>
                  <button
                    onClick={connect}
                    disabled={connecting}
                    className="w-full rounded-xl bg-accent/70 px-4 py-2 text-xs font-semibold text-white transition-all duration-300 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {connecting ? "Connecting…" : "Connect Freighter"}
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Wallet</span>
                    <span className="font-mono text-xs text-text-secondary">
                      {wallet?.address.slice(0, 6)}...{wallet?.address.slice(-4)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Smart Wallet</span>
                    <span className="font-mono text-xs text-text-secondary">
                      {smartWalletAddress
                        ? `${smartWalletAddress.slice(0, 6)}...${smartWalletAddress.slice(-4)}`
                        : deploying
                          ? "Deploying…"
                          : "Not deployed"}
                    </span>
                  </div>
                  {deployError && (
                    <p className="text-xs text-error/90">{deployError}</p>
                  )}

                  {smartWalletAddress && (
                    <div className="space-y-2 rounded-xl border border-white/5 bg-white/[0.02] p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                          Smart Wallet Balance
                        </span>
                        <span className="font-mono text-xs text-text-secondary">
                          {swBalanceLoading ? "Loading…" : `${formatNumber(swXlmBalance)} XLM`}
                        </span>
                      </div>
                      <p className="text-[10px] text-text-muted">
                        Strategy/Intent/Agent modes spend from here, not your connected wallet —
                        fund it before creating a delegation.
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={fundAmount}
                          onChange={(e) => setFundAmount(e.target.value)}
                          placeholder="Amount (XLM)"
                          className="w-full rounded-lg border border-white/5 bg-bg-elevated px-2.5 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-muted/50 transition-all duration-200 focus:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/15"
                        />
                        <button
                          onClick={handleFundSmartWallet}
                          disabled={funding || !fundAmount}
                          className="shrink-0 rounded-lg bg-white/8 px-3 py-1.5 text-[11px] font-semibold text-text-primary transition-all duration-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {funding ? "Sending…" : "Fund"}
                        </button>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={disconnect}
                    className="w-full rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2 text-xs text-text-muted transition-all duration-200 hover:bg-white/[0.05] hover:text-text-secondary"
                  >
                    Disconnect
                  </button>
                </>
              )}
            </CardBody>
          </Card>
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
