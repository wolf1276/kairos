"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePaperTrading } from "@/app/hooks/usePaperTrading";
import { Card, CardBody, CardHeader } from "@/app/components/ui/Card";
import { Segmented } from "@/app/components/ui/Segmented";

type AutomationMode = "AI_MANAGED" | "STRATEGY_MANAGED" | "AUTONOMOUS_AI";

interface Settings {
  defaultMode: AutomationMode;
  defaultSymbol: string;
  emaFast: number;
  emaSlow: number;
  rsiOversold: number;
  rsiOverbought: number;
  initialBalance: number;
}

const SETTINGS_KEY = "kairos_settings";
const DEFAULTS: Settings = {
  defaultMode: "AI_MANAGED",
  defaultSymbol: "XLMUSDT",
  emaFast: 20,
  emaSlow: 50,
  rsiOversold: 30,
  rsiOverbought: 70,
  initialBalance: 10000,
};

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "XLMUSDT", "SOLUSDT", "ADAUSDT"];
const MODES: { value: AutomationMode; label: string }[] = [
  { value: "AI_MANAGED", label: "AI Managed" },
  { value: "STRATEGY_MANAGED", label: "Strategy" },
  { value: "AUTONOMOUS_AI", label: "Autonomous" },
];

function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULTS;
}

export default function SettingsPage() {
  const { reset } = usePaperTrading();
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  useEffect(() => {
    // Hydrate persisted prefs from localStorage after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setS(loadSettings());
  }, []);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setS((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  };

  const handleReset = () => {
    reset(s.initialBalance);
    setConfirmReset(false);
    setResetDone(true);
    window.setTimeout(() => setResetDone(false), 3000);
  };

  const numberField = (
    label: string,
    key: keyof Settings,
    step = 1
  ) => (
    <div>
      <label className="mb-1.5 block font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">
        {label}
      </label>
      <input
        type="number"
        step={step}
        value={s[key] as number}
        onChange={(e) => update(key, Number(e.target.value) as Settings[typeof key])}
        className="w-full rounded-xl border border-border bg-bg-elevated px-4 py-2.5 font-mono text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <header className="sticky top-0 z-50 border-b border-border bg-bg-primary/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
          >
            <span aria-hidden>←</span> Dashboard
          </Link>
          <span className="font-display text-sm font-semibold">Settings</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-6 py-6">
        {/* Automation defaults */}
        <Card>
          <CardHeader title="Automation Defaults" />
          <CardBody className="space-y-4 pt-3">
            <div>
              <label className="mb-1.5 block font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">
                Default Mode
              </label>
              <Segmented
                options={MODES}
                value={s.defaultMode}
                onChange={(v) => update("defaultMode", v)}
              />
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[11px] font-medium uppercase tracking-widest text-text-muted">
                Default Symbol
              </label>
              <select
                value={s.defaultSymbol}
                onChange={(e) => update("defaultSymbol", e.target.value)}
                className="w-full rounded-xl border border-border bg-bg-elevated px-4 py-2.5 font-mono text-sm text-text-primary focus:border-accent focus:outline-none"
              >
                {SYMBOLS.map((sym) => (
                  <option key={sym} value={sym}>
                    {sym}
                  </option>
                ))}
              </select>
            </div>
          </CardBody>
        </Card>

        {/* Strategy params */}
        <Card>
          <CardHeader title="Strategy Parameters" />
          <CardBody className="grid grid-cols-2 gap-4 pt-3">
            {numberField("EMA Fast", "emaFast")}
            {numberField("EMA Slow", "emaSlow")}
            {numberField("RSI Oversold", "rsiOversold")}
            {numberField("RSI Overbought", "rsiOverbought")}
          </CardBody>
        </Card>

        {/* Paper trading */}
        <Card>
          <CardHeader title="Paper Trading" />
          <CardBody className="space-y-4 pt-3">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="mb-1.5 font-mono text-[11px] uppercase tracking-widest text-text-muted">
                  Fee (modeled)
                </p>
                <p className="rounded-xl border border-border bg-bg-elevated px-4 py-2.5 font-mono text-sm text-text-secondary">
                  0.10%
                </p>
              </div>
              <div>
                <p className="mb-1.5 font-mono text-[11px] uppercase tracking-widest text-text-muted">
                  Slippage (modeled)
                </p>
                <p className="rounded-xl border border-border bg-bg-elevated px-4 py-2.5 font-mono text-sm text-text-secondary">
                  0.05%
                </p>
              </div>
              {numberField("Initial Balance ($)", "initialBalance", 100)}
            </div>

            <div className="rounded-xl border border-error/20 bg-error/5 p-4">
              <p className="text-xs text-text-secondary">
                Resetting clears all paper positions and trade history, restoring your
                balance to{" "}
                <span className="font-mono text-text-primary">
                  ${s.initialBalance.toLocaleString()}
                </span>
                . This cannot be undone.
              </p>
              {!confirmReset ? (
                <button
                  onClick={() => setConfirmReset(true)}
                  className="mt-3 cursor-pointer rounded-xl border border-error/30 bg-error/10 px-4 py-2 text-xs font-medium text-error transition-colors hover:bg-error/20"
                >
                  Reset Paper Wallet
                </button>
              ) : (
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={handleReset}
                    className="cursor-pointer rounded-xl bg-error px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-error/90"
                  >
                    Confirm Reset
                  </button>
                  <button
                    onClick={() => setConfirmReset(false)}
                    className="cursor-pointer rounded-xl border border-border bg-bg-elevated px-4 py-2 text-xs text-text-secondary transition-colors hover:text-text-primary"
                  >
                    Cancel
                  </button>
                </div>
              )}
              {resetDone && (
                <p className="mt-2 animate-fade-in-up text-xs text-success">
                  Paper wallet reset.
                </p>
              )}
            </div>
          </CardBody>
        </Card>

        {/* Save */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            className="cursor-pointer rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            Save Settings
          </button>
          {saved && (
            <span className="animate-fade-in-up text-sm text-success">Settings saved</span>
          )}
        </div>
      </main>
    </div>
  );
}
