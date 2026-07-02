"use client";

import { useState, useCallback } from "react";
import DelegationKit from "@/app/components/DelegationKit";

type AutomationMode = "AI_MANAGED" | "STRATEGY_MANAGED" | "AUTONOMOUS_AI";

interface TradingProfile {
  goal?: string;
  riskTolerance?: string;
  investmentHorizon?: string;
  allowedAssets?: string[];
  dailyTradeLimit?: number;
}

interface Proposal {
  action: string;
  symbol: string;
  amount: number;
  confidence: number;
  reasoning: string;
  stopLoss?: number;
  takeProfit?: number;
  timestamp: number;
}

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "XLMUSDT", "SOLUSDT", "ADAUSDT"];

export default function TradePage() {
  const [symbol, setSymbol] = useState("XLMUSDT");
  const [automationMode, setAutomationMode] =
    useState<AutomationMode>("AI_MANAGED");
  const [intentText, setIntentText] = useState("");
  const [parsedIntent, setParsedIntent] = useState<TradingProfile | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [execResult, setExecResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // TODO: add on-chain state (smartWalletAddress, etc.)

  const handleParseIntent = useCallback(async () => {
    if (!intentText.trim()) return;
    try {
      const res = await fetch("/api/intent/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: intentText }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.profile) setParsedIntent(d.profile);
      }
    } catch {
      // silently fail
    }
  }, [intentText]);

  const handleAnalyze = async () => {
    setProposalLoading(true);
    setError(null);
    setProposal(null);

    if (intentText.trim()) await handleParseIntent();

    const body: Record<string, unknown> = { symbol, automationMode };
    if (parsedIntent) body.tradingProfile = parsedIntent;
    else if (intentText.trim()) body.tradingProfile = { intentText };

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok)
        throw new Error(
          (await res.json().catch(() => ({}))).error || "Analysis failed"
        );
      setProposal(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProposalLoading(false);
    }
  };

  const handleExecute = async () => {
    if (!proposal || proposal.action === "HOLD") return;
    setExecuting(true);
    setExecResult(null);
    setError(null);

    const tradeAmount = Math.abs(proposal.amount);
    try {
      // TODO: add on-chain mode check and delegation execution
      const res = await fetch("/api/paper-trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: proposal.action,
          symbol: proposal.symbol,
          amount: tradeAmount,
        }),
      });
      if (!res.ok)
        throw new Error(
          (await res.json().catch(() => ({}))).error || "Execution failed"
        );
      const data = await res.json();
      setExecResult(
        `${proposal.action} ${tradeAmount.toFixed(4)} ${proposal.symbol} at $${data.trade?.price?.toFixed(4) || "market"}`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* ── Sidebar: Freighter wallet ── */}
      <div className="lg:col-span-1">
        <DelegationKit />
      </div>

      {/* ── Main: Trading controls ── */}
      <div className="lg:col-span-2 space-y-5">
        {/* Symbol selector */}
        <div className="rounded-2xl border border-border bg-bg-card p-5">
          <h3 className="mb-4 font-display text-base font-semibold">
            Trading Terminal
          </h3>

          {/* TODO: on-chain mode toggle */}

          <div className="mb-4 flex flex-wrap gap-2">
            {SYMBOLS.map((s) => (
              <button
                key={s}
                onClick={() => setSymbol(s)}
                className={`rounded-lg px-3 py-1.5 font-mono text-xs font-medium transition-colors ${
                  symbol === s
                    ? "bg-accent text-white"
                    : "border border-border bg-bg-elevated text-text-secondary hover:border-accent/40"
                }`}
              >
                {s.replace("USDT", "")}
              </button>
            ))}
          </div>

          {/* Automation mode */}
          <div className="mb-4">
            <label className="mb-1.5 block font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">
              Mode
            </label>
            <div className="flex gap-2">
              {(
                [
                  { value: "AI_MANAGED", label: "AI Managed" },
                  { value: "STRATEGY_MANAGED", label: "Strategy" },
                  { value: "AUTONOMOUS_AI", label: "Autonomous" },
                ] as { value: AutomationMode; label: string }[]
              ).map((m) => (
                <button
                  key={m.value}
                  onClick={() => setAutomationMode(m.value)}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                    automationMode === m.value
                      ? "bg-accent text-white"
                      : "border border-border bg-bg-elevated text-text-secondary hover:border-accent/40"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Intent input */}
          <div className="mb-4">
            <label className="mb-1.5 block font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">
              Trading Intent
            </label>
            <textarea
              value={intentText}
              onChange={(e) => setIntentText(e.target.value)}
              onBlur={handleParseIntent}
              placeholder="e.g., Grow funds with moderate risk, trade XLM and BTC..."
              rows={3}
              className="w-full resize-none rounded-xl border border-border bg-bg-elevated p-3 font-mono text-xs text-text-primary placeholder-text-muted transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            {parsedIntent && (
              <div className="mt-2 rounded-lg bg-bg-elevated px-3 py-2">
                <p className="text-[10px] text-text-muted">
                  Profile: {parsedIntent.riskTolerance} risk,{" "}
                  {parsedIntent.investmentHorizon} horizon
                  {parsedIntent.allowedAssets?.length
                    ? `, assets: ${parsedIntent.allowedAssets.join(", ")}`
                    : ""}
                </p>
              </div>
            )}
          </div>

          <button
            onClick={handleAnalyze}
            disabled={proposalLoading}
            className="w-full rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {proposalLoading ? "Analyzing..." : "Analyze Market"}
          </button>
        </div>

        {/* ── Price chart placeholder ── */}
        <div className="rounded-2xl border border-border bg-bg-card p-5">
          <h3 className="mb-4 font-display text-base font-semibold">
            Price Chart
          </h3>
          {/* TODO: render PriceChart component (recharts) */}
          <div className="flex h-64 items-center justify-center rounded-xl bg-bg-elevated">
            <p className="text-sm text-text-muted">
              Chart area — drop in a recharts{" "}
              <code className="text-accent">&lt;CandlestickChart /&gt;</code> or{" "}
              <code className="text-accent">&lt;AreaChart /&gt;</code> here
            </p>
          </div>
        </div>

        {/* ── Proposal ── */}
        {proposal && (
          <div className="rounded-2xl border border-border bg-bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-base font-semibold">
                {proposal.action === "BUY"
                  ? "🟢 Buy Signal"
                  : proposal.action === "SELL"
                    ? "🔴 Sell Signal"
                    : "⚪ Hold"}
              </h3>
              <span className="font-mono text-xs text-text-muted">
                Confidence: {(proposal.confidence * 100).toFixed(0)}%
              </span>
            </div>
            <div className="mb-3 space-y-2 rounded-xl bg-bg-elevated p-4">
              <div className="flex justify-between">
                <span className="text-xs text-text-muted">Symbol</span>
                <span className="font-mono text-xs font-medium">
                  {proposal.symbol}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-text-muted">Amount</span>
                <span className="font-mono text-xs font-medium">
                  {proposal.amount.toFixed(4)}
                </span>
              </div>
              {proposal.stopLoss && (
                <div className="flex justify-between">
                  <span className="text-xs text-text-muted">Stop Loss</span>
                  <span className="font-mono text-xs font-medium text-error">
                    ${proposal.stopLoss.toFixed(2)}
                  </span>
                </div>
              )}
              {proposal.takeProfit && (
                <div className="flex justify-between">
                  <span className="text-xs text-text-muted">Take Profit</span>
                  <span className="font-mono text-xs font-medium text-success">
                    ${proposal.takeProfit.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
            <p className="mb-4 text-xs leading-relaxed text-text-secondary">
              {proposal.reasoning}
            </p>
            {proposal.action !== "HOLD" && (
              <button
                onClick={handleExecute}
                disabled={executing}
                className={`w-full rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
                  proposal.action === "BUY"
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {executing
                  ? "Executing..."
                  : `Execute ${proposal.action}`}
              </button>
            )}
            {execResult && (
              <div className="mt-3 animate-fade-in-up rounded-xl border border-success/20 bg-success/10 px-4 py-3">
                <p className="text-xs text-success">{execResult}</p>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-error/20 bg-error/10 p-4">
            <p className="text-xs text-error">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
