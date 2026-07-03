"use client";

import { useEffect, useState } from "react";
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
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
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

  const numberField = (label: string, key: keyof Settings, step = 1) => (
    <div>
      <label className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
        {label}
      </label>
      <input
        type="number"
        step={step}
        value={s[key] as number}
        onChange={(e) => update(key, Number(e.target.value) as Settings[typeof key])}
        className="w-full rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2.5 font-mono text-sm text-text-primary transition-all duration-300 focus:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/15"
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-lg font-medium text-text-primary">Settings</h1>
      </div>

      {/* Automation defaults */}
      <Card>
        <CardHeader title="Automation Defaults" />
        <CardBody className="space-y-4">
          <div>
            <label className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
              Default Mode
            </label>
            <Segmented
              options={MODES}
              value={s.defaultMode}
              onChange={(v) => update("defaultMode", v)}
            />
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
              Default Symbol
            </label>
            <select
              value={s.defaultSymbol}
              onChange={(e) => update("defaultSymbol", e.target.value)}
              className="w-full rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2.5 font-mono text-sm text-text-primary outline-none transition-all duration-300 focus:border-accent/30 focus:ring-2 focus:ring-accent/15"
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
        <CardBody className="grid grid-cols-2 gap-4">
          {numberField("EMA Fast", "emaFast")}
          {numberField("EMA Slow", "emaSlow")}
          {numberField("RSI Oversold", "rsiOversold")}
          {numberField("RSI Overbought", "rsiOverbought")}
        </CardBody>
      </Card>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          className="cursor-pointer rounded-xl bg-white/8 px-6 py-2.5 text-sm font-semibold text-text-primary transition-all duration-300 hover:bg-white/10 hover:shadow-[0_0_25px_-8px_rgba(120,81,233,0.1)]"
        >
          Save Settings
        </button>
        {saved && (
          <span className="animate-fade-in-up text-sm text-success">Settings saved</span>
        )}
      </div>
    </div>
  );
}
