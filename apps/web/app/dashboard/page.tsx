"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrices } from "@/app/hooks/usePrices";
import { usePaperTrading } from "@/app/hooks/usePaperTrading";
import { connectWallet, tryCheckConnection, type WalletState } from "@/app/lib/stellar";
import { Badge } from "@/app/components/ui/Badge";
import { Card } from "@/app/components/ui/Card";
import {
  baseAsset,
  formatPrice,
  formatNumber,
  formatSignedUsd,
  formatTime,
  formatUsd,
  formatPct,
  pnlColor,
} from "@/app/lib/format";

const MARKET_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "XLMUSDT",
  "SOLUSDT",
  "ADAUSDT",
  "XRPUSDT",
  "DOGEUSDT",
];

const QUICK_ACTIONS = [
  {
    href: "/dashboard/trade",
    title: "New Trade",
    desc: "Set intent, analyze, execute",
  },
  {
    href: "/dashboard/portfolio",
    title: "Portfolio",
    desc: "Track positions, PnL & allocation",
  },
  {
    href: "/dashboard/delegations",
    title: "Delegations",
    desc: "Manage smart wallets & policies",
  },
];

const MODE_LABELS: Record<string, string> = {
  AI_MANAGED: "AI Managed",
  STRATEGY_MANAGED: "Strategy",
  AUTONOMOUS_AI: "Autonomous",
};

function shortAddress(addr: string) {
  return `${addr.slice(0, 4)}\u2026${addr.slice(-4)}`;
}

function EquitySparkline({
  trades,
  startValue,
}: {
  trades: { timestamp: number; pnl?: number }[];
  startValue: number;
}) {
  const pathData = useMemo(() => {
    const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
    if (sorted.length < 2) return null;
    const equity = sorted.reduce<number[]>((acc, t) => {
      acc.push((acc[acc.length - 1] ?? startValue) + (t.pnl ?? 0));
      return acc;
    }, []);
    const min = Math.min(...equity);
    const max = Math.max(...equity);
    const range = max - min || 1;
    const w = 200;
    const h = 48;
    const pad = 2;
    const coords = equity.map((v, i) => {
      const x = pad + (i / (equity.length - 1)) * (w - 2 * pad);
      const y = pad + ((max - v) / range) * (h - 2 * pad);
      return `${x},${y}`;
    });
    const up = equity[equity.length - 1] >= equity[0];
    return { points: coords.join(" "), w, h, up };
  }, [trades, startValue]);

  if (!pathData) return null;

  return (
    <svg width={pathData.w} height={pathData.h} className="shrink-0 opacity-25">
      <polyline
        points={pathData.points}
        fill="none"
        stroke={pathData.up ? "var(--color-success)" : "var(--color-error)"}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function DashboardOverview() {
  const { tickers, priceMap, loading: pricesLoading } = usePrices(MARKET_SYMBOLS);
  const { ready, balance, positions, trades, totalValue, unrealizedPnL, reset } =
    usePaperTrading(priceMap);

  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [checked, setChecked] = useState(false);
  const [initialValue, setInitialValue] = useState(0);
  const [defaultMode, setDefaultMode] = useState("AI_MANAGED");

  const connect = useCallback(async () => {
    setConnecting(true);
    const result = await connectWallet();
    if (result.success && result.wallet) setWallet(result.wallet);
    setConnecting(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    tryCheckConnection().then(async (ok) => {
      if (ok && !cancelled) await connect();
      if (!cancelled) setChecked(true);
    });
    return () => { cancelled = true; };
  }, [connect]);

  useEffect(() => {
    const raw = localStorage.getItem("kairos_settings");
    if (raw) {
      try {
        const s = JSON.parse(raw);
        if (s.defaultMode) setDefaultMode(s.defaultMode);
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (wallet && tickers["XLMUSDT"] && ready) {
      const xlmBalance = parseFloat(wallet.balance);
      const xlmPrice = tickers["XLMUSDT"].price;
      const usdBalance = Number((xlmBalance * xlmPrice).toFixed(2));
      if (usdBalance > 0 && totalValue === 0 && trades.length === 0) {
        reset(usdBalance);
        setInitialValue(usdBalance);
      } else if (initialValue === 0) {
        setInitialValue(totalValue - trades.reduce((s, t) => s + (t.pnl ?? 0), 0));
      }
    }
  }, [wallet, tickers, ready, totalValue, trades, reset, initialValue]);

  const loading = !ready;
  const movers = MARKET_SYMBOLS.map((s) => tickers[s]).filter(Boolean);
  const recentTrades = trades.slice(0, 5);

  const startRef = initialValue || (trades.length > 0
    ? totalValue - trades.reduce((s, t) => s + (t.pnl ?? 0), 0)
    : 0);

  const totalReturn = startRef > 0 ? totalValue - startRef : 0;
  const totalReturnPct = startRef > 0 ? (totalReturn / startRef) * 100 : 0;

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  const todayTrades = useMemo(
    () => trades.filter((t) => t.timestamp >= todayStart && t.pnl !== undefined),
    [trades, todayStart]
  );
  const todayEarnings = todayTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const hasWallet = wallet !== null;

  const [onboardingDismissed, setOnboardingDismissed] = useState(true);
  useEffect(() => {
    setOnboardingDismissed(localStorage.getItem("kairos:onboarding-dismissed") === "1");
  }, []);
  const dismissOnboarding = () => {
    localStorage.setItem("kairos:onboarding-dismissed", "1");
    setOnboardingDismissed(true);
  };

  return (
    <div className="space-y-5">
      {/* ── First-run onboarding ── */}
      {!onboardingDismissed && (
        <div className="rounded-2xl border border-accent/15 bg-accent-muted/20 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-sm font-medium text-text-primary">
                New here? Start with the real flow.
              </h2>
              <p className="mt-1 text-xs text-text-secondary">
                Most of what you can do in Kairos today is paper trading (real prices, simulated
                funds) and on-chain delegation (real Soroban contracts on testnet). Everything
                under &ldquo;Autonomous Layer&rdquo; below is still in development.
              </p>
            </div>
            <button
              onClick={dismissOnboarding}
              aria-label="Dismiss"
              className="shrink-0 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-white/5 hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Link
              href="/dashboard/trade"
              className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            >
              <p className="font-mono text-[10px] uppercase tracking-widest text-accent">Step 1</p>
              <p className="mt-1 text-xs font-medium text-text-primary">Place a paper trade</p>
              <p className="mt-0.5 text-[11px] text-text-muted">Manual mode, live prices</p>
            </Link>
            <Link
              href="/dashboard/delegations"
              className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            >
              <p className="font-mono text-[10px] uppercase tracking-widest text-accent">Step 2</p>
              <p className="mt-1 text-xs font-medium text-text-primary">Connect Freighter</p>
              <p className="mt-0.5 text-[11px] text-text-muted">Deploy a smart wallet</p>
            </Link>
            <Link
              href="/docs"
              className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            >
              <p className="font-mono text-[10px] uppercase tracking-widest text-accent">Step 3</p>
              <p className="mt-1 text-xs font-medium text-text-primary">Create a delegation</p>
              <p className="mt-0.5 text-[11px] text-text-muted">Set policies, read the guide</p>
            </Link>
          </div>
        </div>
      )}

      {/* ── Row: Portfolio Value + Wallet ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Portfolio Value */}
        <div className="rounded-2xl card-glass card-glow p-7 transition-shadow duration-300 lg:col-span-2">
          <div className="flex items-start justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
                  Portfolio Value
                </p>
                <span className="rounded-full border border-amber-400/20 bg-amber-400/[0.06] px-2 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wider text-amber-300/85">
                  Paper Trading
                </span>
              </div>
              {loading ? (
                <div className="h-10 w-44 animate-pulse rounded-md bg-bg-elevated/60" />
              ) : !hasWallet ? (
                <p className="font-display text-4xl font-bold tracking-tight text-text-muted">
                  —
                </p>
              ) : (
                <p className="font-display text-4xl font-bold tracking-tight text-text-primary tabular-nums transition-all duration-500">
                  {formatUsd(totalValue)}
                </p>
              )}
              {!loading && hasWallet && startRef > 0 && (
                <p className={`font-mono text-xs font-medium tabular-nums ${pnlColor(totalReturn)}`}>
                  {formatSignedUsd(totalReturn)} ({formatPct(totalReturnPct)})
                </p>
              )}
            </div>

            {hasWallet && !loading && (
              <div className="flex items-center gap-6 pt-1">
                <div className="text-right">
                  <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Cash</p>
                  <p className="mt-0.5 font-mono text-sm tabular-nums text-text-secondary">{formatUsd(balance)}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Positions</p>
                  <p className="mt-0.5 font-mono text-sm tabular-nums text-text-secondary">{positions.length}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">Unreal. PnL</p>
                  <p className={`mt-0.5 font-mono text-sm tabular-nums ${pnlColor(unrealizedPnL)}`}>{formatSignedUsd(unrealizedPnL)}</p>
                </div>
              </div>
            )}
          </div>

          {hasWallet && trades.length >= 2 && (
            <div className="relative mt-5 flex justify-end">
              <EquitySparkline trades={trades} startValue={startRef} />
            </div>
          )}
        </div>

        {/* Wallet / Connect */}
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
              Wallet
            </p>
            {wallet ? (
              <Badge tone={wallet.isTestnet ? "warning" : "success"} dot>
                {wallet.network}
              </Badge>
            ) : (
              <Badge tone="neutral" dot={false}>
                Disconnected
              </Badge>
            )}
          </div>
          {wallet ? (
            <>
              <p className="mt-2 font-display text-2xl font-bold tracking-tight text-text-primary">
                {parseFloat(wallet.balance).toFixed(2)}{" "}
                <span className="text-sm font-medium text-text-muted">XLM</span>
              </p>
              <p className="mt-1.5 font-mono text-xs text-text-secondary">{shortAddress(wallet.address)}</p>
              <Link
                href="/dashboard/delegations"
                className="mt-4 inline-block rounded text-xs text-accent transition-colors hover:text-accent-hover"
              >
                Manage delegation →
              </Link>
            </>
          ) : (
            <>
              <p className="mt-2 font-display text-2xl font-bold tracking-tight text-text-primary">—</p>
              <p className="mt-1.5 text-xs text-text-muted">
                {checked ? "No wallet connected" : "Checking connection\u2026"}
              </p>
              <button
                onClick={connect}
                disabled={connecting}
                aria-busy={connecting}
                className="mt-4 inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg bg-accent/80 px-3 py-1.5 text-xs font-semibold text-white transition-all duration-300 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                {connecting ? "Connecting\u2026" : "Connect Wallet"}
              </button>
            </>
          )}
        </Card>
      </div>

      {/* ── Row: Delegation Wallet / Active Agent / Today's Earnings ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-6">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
            Delegation Wallet
          </p>
          {wallet ? (
            <>
              <p className="mt-2 font-display text-2xl font-bold tracking-tight text-text-primary">
                {parseFloat(wallet.balance).toFixed(2)}{" "}
                <span className="text-sm font-medium text-text-muted">XLM</span>
              </p>
              <p className="mt-1.5 font-mono text-xs text-text-secondary">{shortAddress(wallet.address)}</p>
              <Link
                href="/dashboard/delegations"
                className="mt-4 inline-block rounded text-xs text-accent transition-colors hover:text-accent-hover"
              >
                Manage →
              </Link>
            </>
          ) : (
            <>
              <p className="mt-2 font-display text-2xl font-bold tracking-tight text-text-primary">—</p>
              <p className="mt-1.5 text-xs text-text-muted">Connect wallet to view</p>
            </>
          )}
        </Card>

        <Card className="p-6">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
            Active Agent
          </p>
          <p className="mt-2 font-display text-2xl font-bold tracking-tight text-text-primary">
            {MODE_LABELS[defaultMode] ?? "AI Managed"}
          </p>
          <p className="mt-1.5 text-xs text-text-muted">
            {defaultMode === "AUTONOMOUS_AI" ? "Fully autonomous trading" :
             defaultMode === "STRATEGY_MANAGED" ? "Rule-based execution" :
             "AI-assisted decision making"}
          </p>
          <Link
            href="/dashboard/settings"
            className="mt-4 inline-block rounded text-xs text-accent transition-colors hover:text-accent-hover"
          >
            Settings →
          </Link>
        </Card>

        <Card className="p-6">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
            Today's Earnings
          </p>
          {!hasWallet ? (
            <>
              <p className="mt-2 font-display text-2xl font-bold tracking-tight text-text-primary">—</p>
              <p className="mt-1.5 text-xs text-text-muted">Connect wallet to track</p>
            </>
          ) : (
            <>
              <p className={`mt-2 font-display text-2xl font-bold tracking-tight tabular-nums ${pnlColor(todayEarnings)}`}>
                {formatSignedUsd(todayEarnings)}
              </p>
              <p className="mt-1.5 text-xs text-text-muted">
                {todayTrades.length > 0
                  ? `${todayTrades.length} trade${todayTrades.length > 1 ? "s" : ""} today`
                  : "No trades today"}
              </p>
              <Link
                href="/dashboard/history"
                className="mt-4 inline-block rounded text-xs text-accent transition-colors hover:text-accent-hover"
              >
                History →
              </Link>
            </>
          )}
        </Card>
      </div>

      {/* ── Quick Actions ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {QUICK_ACTIONS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="rounded-xl card-glass p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_40px_-8px_rgba(0,0,0,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          >
            <div className="flex items-center justify-between">
              <span className="font-display text-sm font-medium text-text-primary">{a.title}</span>
              <span className="text-xs text-text-muted transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-accent">→</span>
            </div>
            <p className="mt-0.5 text-xs text-text-muted/70">{a.desc}</p>
          </Link>
        ))}
      </div>

      {/* ── Data Panels ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Markets */}
        <div className="rounded-2xl card-glass p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-sm font-medium text-text-primary">Markets</h3>
            <Badge tone="success" dot>Live</Badge>
          </div>
          {pricesLoading && movers.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-bg-elevated/50" />
              ))}
            </div>
          ) : (
            <div className="space-y-0.5">
              {movers.map((m) => {
                const up = m.change24h >= 0;
                return (
                  <Link
                    key={m.symbol}
                    href={`/dashboard/trade?symbol=${m.symbol}`}
                    className="flex items-center justify-between rounded-lg px-3 py-2.5 transition-all duration-200 hover:bg-white/[0.03]"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-semibold text-text-primary">{baseAsset(m.symbol)}</span>
                      <span className="font-mono text-[10px] text-text-muted">/USDT</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="font-mono text-xs tabular-nums text-text-secondary">{formatPrice(m.price)}</span>
                      <span className={`w-16 text-right font-mono text-xs font-medium tabular-nums ${up ? "text-success" : "text-error"}`}>
                        {formatPct(m.change24h)}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Trades */}
        <div className="rounded-2xl card-glass p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-sm font-medium text-text-primary">Recent Trades</h3>
            {trades.length > 0 && (
              <Link href="/dashboard/history" className="text-xs text-text-muted transition-colors duration-200 hover:text-text-secondary">
                View all
              </Link>
            )}
          </div>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-bg-elevated/50" />
              ))}
            </div>
          ) : !hasWallet ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <p className="text-sm text-text-muted">Connect wallet to start trading</p>
            </div>
          ) : recentTrades.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <p className="text-sm text-text-muted">No trades yet</p>
              <Link href="/dashboard/trade" className="text-sm text-text-secondary underline underline-offset-2 transition-colors hover:text-text-primary">
                Start trading →
              </Link>
            </div>
          ) : (
            <div className="space-y-0.5">
              {recentTrades.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2.5 transition-colors duration-200 hover:bg-white/[0.04]"
                >
                  <div className="flex items-center gap-2">
                    <Badge tone={t.action === "BUY" ? "buy" : "sell"}>{t.action}</Badge>
                    <span className="font-mono text-xs font-medium text-text-primary">{baseAsset(t.symbol)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs tabular-nums text-text-secondary">
                      {formatNumber(t.amount)} @ {formatPrice(t.price)}
                    </span>
                    {t.pnl !== undefined && (
                      <span className={`w-14 text-right font-mono text-xs font-medium tabular-nums ${pnlColor(t.pnl)}`}>
                        {formatSignedUsd(t.pnl)}
                      </span>
                    )}
                    <span className="hidden font-mono text-[10px] text-text-muted sm:inline">{formatTime(t.timestamp)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
