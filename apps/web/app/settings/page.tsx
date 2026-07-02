"use client";

import { useState } from "react";

type AutomationMode = "AI_MANAGED" | "STRATEGY_MANAGED" | "AUTONOMOUS_AI";

export default function SettingsPage() {
  const [defaultMode, setDefaultMode] =
    useState<AutomationMode>("AI_MANAGED");
  const [defaultSymbol, setDefaultSymbol] = useState("XLMUSDT");
  const [emaFast, setEmaFast] = useState(20);
  const [emaSlow, setEmaSlow] = useState(50);
  const [rsiOversold, setRsiOversold] = useState(30);
  const [rsiOverbought, setRsiOverbought] = useState(70);
  const [fee, setFee] = useState(0.1);
  const [slippage, setSlippage] = useState(0.05);
  const [initialBalance, setInitialBalance] = useState(10000);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    // TODO: persist to localStorage or API
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleResetPaper = async () => {
    try {
      await fetch("/api/paper-trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RESET" }),
      });
      setSaved(true);
    } catch {
      // noop
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="font-display text-xl font-semibold">Settings</h1>

      {/* ── Automation defaults ── */}
      <div className="rounded-2xl border border-border bg-bg-card p-5">
        <h2 className="mb-4 font-display text-base font-semibold">
          Automation Defaults
        </h2>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">
              Default Mode
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
                  onClick={() => setDefaultMode(m.value)}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                    defaultMode === m.value
                      ? "bg-accent text-white"
                      : "border border-border bg-bg-elevated text-text-secondary hover:border-accent/40"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">
              Default Symbol
            </label>
            <select
              value={defaultSymbol}
              onChange={(e) => setDefaultSymbol(e.target.value)}
              className="w-full rounded-xl border border-border bg-bg-elevated px-4 py-2.5 font-mono text-sm text-text-primary focus:border-accent focus:outline-none"
            >
              {["BTCUSDT", "ETHUSDT", "XLMUSDT", "SOLUSDT", "ADAUSDT"].map(
                (s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                )
              )}
            </select>
          </div>
        </div>
      </div>

      {/* ── Strategy parameters ── */}
      <div className="rounded-2xl border border-border bg-bg-card p-5">
        <h2 className="mb-4 font-display text-base font-semibold">
          Strategy Parameters
        </h2>
        {/* TODO: this section is only relevant when default mode is STRATEGY_MANAGED — consider conditional rendering */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">
              EMA Crossover — Fast
            </label>
            <input
              type="number"
              value={emaFast}
              onChange={(e) => setEmaFast(Number(e.target.value))}
              className="w-full rounded-xl border border-border bg-bg-elevated px-4 py-2.5 font-mono text-sm text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">
              EMA Crossover — Slow
            </label>
            <input
              type="number"
              value={emaSlow}
              onChange={(e) => setEmaSlow(Number(e.target.value))}
              className="w-full rounded-xl border border-border bg-bg-elevated px-4 py-2.5 font-mono text-sm text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">
              Mean Reversion — Oversold RSI
            </label>
            <input
              type="number"
              value={rsiOversold}
              onChange={(e) => setRsiOversold(Number(e.target.value))}
              className="w-full rounded-xl border border-border bg-bg-elevated px-4 py-2.5 font-mono text-sm text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">
              Mean Reversion — Overbought RSI
            </label>
            <input
              type="number"
              value={rsiOverbought}
              onChange={(e) => setRsiOverbought(Number(e.target.value))}
              className="w-full rounded-xl border border-border bg-bg-elevated px-4 py-2.5 font-mono text-sm text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* ── Paper trading config ── */}
      <div className="rounded-2xl border border-border bg-bg-card p-5">
        <h2 className="mb-4 font-display text-base font-semibold">
          Paper Trading
        </h2>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="mb-1.5 block font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">
              Fee (%)
            </label>
            <input
              type="number"
              step="0.01"
              value={fee}
              onChange={(e) => setFee(Number(e.target.value))}
              className="w-full rounded-xl border border-border bg-bg-elevated px-4 py-2.5 font-mono text-sm text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">
              Slippage (%)
            </label>
            <input
              type="number"
              step="0.01"
              value={slippage}
              onChange={(e) => setSlippage(Number(e.target.value))}
              className="w-full rounded-xl border border-border bg-bg-elevated px-4 py-2.5 font-mono text-sm text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">
              Initial Balance ($)
            </label>
            <input
              type="number"
              value={initialBalance}
              onChange={(e) => setInitialBalance(Number(e.target.value))}
              className="w-full rounded-xl border border-border bg-bg-elevated px-4 py-2.5 font-mono text-sm text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
        </div>
        <button
          onClick={handleResetPaper}
          className="mt-4 rounded-xl border border-error/30 bg-error/10 px-4 py-2 text-xs font-medium text-error transition-colors hover:bg-error/20"
        >
          Reset Paper Wallet
        </button>
      </div>

      {/* ── Save ── */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          className="rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          Save Settings
        </button>
        {saved && (
          <span className="animate-fade-in-up text-sm text-success">
            Settings saved
          </span>
        )}
      </div>
    </div>
  );
}
