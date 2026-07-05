"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { CardHeader, CardBody } from "@/app/components/ui/Card";
import { Badge } from "@/app/components/ui/Badge";
import { Segmented } from "@/app/components/ui/Segmented";
import { useWalletContext } from "@/app/contexts/WalletContext";
import { useSmartWalletBalances } from "@/app/hooks/useSmartWalletBalances";
import { fetchOrderBookQuote, TESTNET_USDC_ISSUER } from "@/app/lib/stellar";

function shortAddress(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

const PANEL_CLS =
  "rounded-3xl border border-white/8 bg-[#111113] shadow-[0_20px_60px_-30px_rgba(0,0,0,0.8)] transition-colors duration-300 hover:border-accent-hover/25";

function Panel({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn(PANEL_CLS, className)}>{children}</div>;
}

const RANGE_OPTIONS = [
  { value: "1D", label: "1D" },
  { value: "1W", label: "1W" },
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "1Y", label: "1Y" },
  { value: "ALL", label: "ALL" },
] as const;

type Range = (typeof RANGE_OPTIONS)[number]["value"];

const CHART_DATA = [
  { t: "Jun 08", v: 10820 },
  { t: "Jun 11", v: 11040 },
  { t: "Jun 14", v: 10910 },
  { t: "Jun 17", v: 11280 },
  { t: "Jun 20", v: 11190 },
  { t: "Jun 23", v: 11540 },
  { t: "Jun 26", v: 11430 },
  { t: "Jun 29", v: 11780 },
  { t: "Jul 01", v: 11960 },
  { t: "Jul 02", v: 12080 },
  { t: "Jul 03", v: 11930 },
  { t: "Jul 04", v: 12210 },
  { t: "Jul 05", v: 12128 },
  { t: "Jul 05", v: 12480 },
];

const ALLOCATION = [
  { label: "Spot", pct: 35 },
  { label: "Perpetuals", pct: 42 },
  { label: "Blend", pct: 18 },
  { label: "Idle Cash", pct: 5 },
];

const PORTFOLIO_VALUE = 12480;

const AGENTS = [
  { name: "Portfolio Manager", status: "ACTIVE", tone: "success" as const },
  { name: "Spot Agent", status: "MONITORING", tone: "neutral" as const },
  { name: "Perps Agent", status: "TRADING", tone: "buy" as const },
  { name: "Yield Agent", status: "DEPLOYING", tone: "warning" as const },
  { name: "Risk Agent", status: "WATCHING", tone: "neutral" as const },
];

const ACTIVITY = [
  { label: "Recent execution — Bought BTC", time: "5m ago" },
  { label: "Portfolio rebalance", time: "22m ago" },
  { label: "Blend deposit", time: "1h ago" },
  { label: "Risk update", time: "3h ago" },
  { label: "Asset rotation", time: "6h ago" },
];

function chartGeometry(points: number[], width: number, height: number) {
  const max = Math.max(...points);
  const min = Math.min(...points);
  const step = width / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = i * step;
    const y = height - ((p - min) / (max - min || 1)) * height;
    return [x, y] as const;
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  return { line, area, coords, min, max };
}

function PerformanceChart({ range, onRangeChange }: { range: Range; onRangeChange: (r: Range) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const values = CHART_DATA.map((d) => d.v);
  const { line, area, min, max } = chartGeometry(values, 1000, 300);
  const n = values.length;

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(frac * (n - 1)));
  };

  const hoverPoint = hover !== null ? CHART_DATA[hover] : null;
  const hoverXPct = hover !== null ? (hover / (n - 1)) * 100 : 0;
  const hoverYPct = hoverPoint ? (1 - (hoverPoint.v - min) / (max - min || 1)) * 100 : 0;

  return (
    <Panel>
      <CardHeader
        title="Portfolio Performance"
        className="flex-wrap gap-y-3"
        action={
          <Segmented
            options={RANGE_OPTIONS as unknown as { value: Range; label: string }[]}
            value={range}
            onChange={onRangeChange}
            size="sm"
          />
        }
      />
      <CardBody className="pt-4">
        <div
          ref={wrapRef}
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
          className="relative h-[320px] w-full sm:h-[360px]"
        >
          <svg viewBox="0 0 1000 300" className="h-full w-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="perf-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent-hover)" stopOpacity="0.28" />
                <stop offset="100%" stopColor="var(--accent-hover)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map((f) => (
              <line
                key={f}
                x1="0"
                x2="1000"
                y1={300 * f}
                y2={300 * f}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="1"
              />
            ))}
            <path d={area} fill="url(#perf-fill)" />
            <path
              d={line}
              fill="none"
              stroke="var(--accent-hover)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {hover !== null && (
              <line
                x1={(hoverXPct / 100) * 1000}
                x2={(hoverXPct / 100) * 1000}
                y1="0"
                y2="300"
                stroke="rgba(255,255,255,0.14)"
                strokeWidth="1"
              />
            )}
          </svg>

          {hoverPoint && (
            <>
              <div
                className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-hover shadow-[0_0_0_4px_rgba(139,110,240,0.2)]"
                style={{ left: `${hoverXPct}%`, top: `${hoverYPct}%` }}
              />
              <div
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-[calc(100%+12px)] whitespace-nowrap rounded-xl border border-white/10 bg-[#0a0a0c] px-3 py-2 text-xs shadow-[0_12px_30px_-10px_rgba(0,0,0,0.7)]"
                style={{ left: `${hoverXPct}%`, top: `${hoverYPct}%` }}
              >
                <div className="font-mono tabular-nums text-text-primary">${hoverPoint.v.toLocaleString()}</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wider text-text-muted">{hoverPoint.t}</div>
              </div>
            </>
          )}
        </div>
      </CardBody>
    </Panel>
  );
}

export default function DashboardOverview() {
  const [range, setRange] = useState<Range>("1M");
  const { connected, wallet, smartWalletAddress } = useWalletContext();
  const { xlmBalance, usdcBalance, loading: balanceLoading } = useSmartWalletBalances(
    smartWalletAddress,
    wallet?.networkPassphrase ?? null,
    wallet?.sorobanRpcUrl
  );

  // Real XLM→USDC spot price from the testnet DEX (liquidity pool, falling back to the order
  // book) — used to value the XLM portion of the smart wallet in USD terms alongside USDC,
  // which is already ~1:1 USD.
  const [xlmUsdPrice, setXlmUsdPrice] = useState<number | null>(null);
  useEffect(() => {
    if (!wallet?.networkPassphrase) return;
    let cancelled = false;
    fetchOrderBookQuote({ code: "XLM" }, { code: "USDC", issuer: TESTNET_USDC_ISSUER }, wallet.networkPassphrase)
      .then((quote) => {
        if (!cancelled) setXlmUsdPrice(quote.price);
      })
      .catch(() => {
        if (!cancelled) setXlmUsdPrice(null);
      });
    return () => {
      cancelled = true;
    };
  }, [wallet?.networkPassphrase]);

  const portfolioValue = usdcBalance + xlmBalance * (xlmUsdPrice ?? 0);

  return (
    <div className="flex flex-col gap-10 pb-4 sm:gap-12">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
          Autonomous Capital Overview
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Portfolio managed autonomously according to your investment policy.
        </p>
      </div>

      {/* Main row: 3 stacked stat cards left, Performance chart right */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5">
          <Panel className="flex h-full flex-col p-6">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
              Portfolio Value
            </p>
            {!connected || !smartWalletAddress ? (
              <p className="mt-2 font-display text-3xl font-bold tabular-nums text-text-primary">$0.00</p>
            ) : (
              <p className="mt-2 font-display text-3xl font-bold tabular-nums text-text-primary">
                {balanceLoading && xlmUsdPrice === null
                  ? "…"
                  : `$${portfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </p>
            )}
            <div className="mt-auto flex items-center justify-between pt-4 text-xs">
              <span className="text-text-secondary">
                {xlmBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} XLM
              </span>
              <span className="font-mono tabular-nums text-text-secondary">
                {usdcBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC
              </span>
            </div>
          </Panel>

          <Panel className="flex h-full flex-col p-6">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
              Wallet Balance
            </p>
            {!connected ? (
              <p className="mt-2 font-display text-2xl font-bold text-text-primary">Connect Wallet</p>
            ) : !smartWalletAddress ? (
              <>
                <p className="mt-2 font-display text-2xl font-bold text-text-primary">—</p>
                <div className="mt-auto pt-4 text-xs text-text-muted">Smart wallet not deployed yet</div>
              </>
            ) : (
              <>
                <p className="mt-2 font-display text-3xl font-bold tabular-nums text-text-primary">
                  {balanceLoading && xlmBalance === 0 ? "…" : `${xlmBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} XLM`}
                </p>
                <div className="mt-auto flex items-center justify-between pt-4 text-xs">
                  <span className="font-mono text-text-secondary">{shortAddress(smartWalletAddress)}</span>
                  <Badge tone="accent">{wallet?.isTestnet ? "Testnet" : "Mainnet"}</Badge>
                </div>
              </>
            )}
          </Panel>

          <Panel className="flex h-full flex-col p-6">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
              Today&apos;s Performance
            </p>
            <p className="mt-2 font-display text-3xl font-bold tabular-nums text-success/90">+$352</p>
            <div className="mt-auto flex items-center justify-between pt-4 text-xs">
              <span className="font-mono tabular-nums text-text-secondary">+2.84%</span>
              <span className="text-text-muted">Best: BTC +5.2%</span>
            </div>
          </Panel>
        </div>

        <div className="lg:col-span-2">
          <PerformanceChart range={range} onRangeChange={setRange} />
        </div>
      </div>

      {/* AI Status */}
      <Panel className="flex flex-col p-6 sm:flex-row sm:items-center sm:gap-8">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 rounded-full bg-success shadow-[0_0_10px_rgba(45,212,160,0.6)]" />
          <div>
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">AI Status</p>
            <p className="font-display text-xl font-bold text-text-primary">Active</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 sm:mt-0 sm:ml-auto">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-text-muted">Strategy</span>
            <span className="font-mono tabular-nums text-text-secondary">Momentum</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-text-muted">Confidence</span>
            <span className="font-mono tabular-nums text-text-primary">91%</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-text-muted">Last decision</span>
            <span className="text-text-secondary">5m ago</span>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel>
          <CardHeader title="Capital Allocation" />
          <CardBody className="space-y-4 pt-3">
            {ALLOCATION.map((a) => (
              <div key={a.label}>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="text-text-secondary">{a.label}</span>
                  <span className="font-mono tabular-nums text-text-primary">
                    {a.pct}%
                    <span className="ml-2 text-text-muted">
                      ${Math.round((PORTFOLIO_VALUE * a.pct) / 100).toLocaleString()}
                    </span>
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full bg-accent-hover" style={{ width: `${a.pct}%` }} />
                </div>
              </div>
            ))}
          </CardBody>
        </Panel>

        <Panel>
          <CardHeader title="Latest AI Decision" action={<Badge tone="buy">Buy BTC</Badge>} />
          <CardBody className="space-y-3 pt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">Confidence</span>
              <span className="font-mono text-xs tabular-nums text-text-primary">91%</span>
            </div>
            <p className="text-sm text-text-secondary">
              Momentum breakout detected across the 4H and 1D timeframes, with volume confirmation above the
              20-period average.
            </p>
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-muted">Expected holding period</span>
              <span className="text-text-secondary">3–7 days</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-muted">Timestamp</span>
              <span className="text-text-secondary">5 minutes ago</span>
            </div>
          </CardBody>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel>
          <CardHeader title="Active Agents" />
          <CardBody className="space-y-1 pt-3">
            {AGENTS.map((a) => (
              <div
                key={a.name}
                className="flex items-center justify-between border-b border-white/[0.05] py-2.5 last:border-b-0"
              >
                <span className="text-sm text-text-secondary">{a.name}</span>
                <Badge tone={a.tone}>{a.status}</Badge>
              </div>
            ))}
          </CardBody>
        </Panel>

        <Panel>
          <CardHeader title="Recent Activity" />
          <CardBody className="pt-3">
            <div className="space-y-0">
              {ACTIVITY.map((item, i) => (
                <div key={item.label} className="relative flex gap-3 pb-5 last:pb-0">
                  <div className="flex flex-col items-center">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent-hover" />
                    {i < ACTIVITY.length - 1 && <span className="w-px flex-1 bg-white/[0.08]" />}
                  </div>
                  <div className="flex flex-1 items-center justify-between pt-0.5">
                    <span className="text-sm text-text-secondary">{item.label}</span>
                    <span className="text-xs text-text-muted">{item.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Panel>
      </div>
    </div>
  );
}
