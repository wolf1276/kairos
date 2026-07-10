"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { CardHeader, CardBody } from "@/app/components/ui/Card";
import { Badge } from "@/app/components/ui/Badge";
import { Segmented } from "@/app/components/ui/Segmented";
import { useWalletContext } from "@/app/contexts/WalletContext";
import { useStellarBalances } from "@/app/hooks/useStellarBalances";
import { useSmartWalletBalances } from "@/app/hooks/useSmartWalletBalances";
import { useProtocolAllocations } from "@/app/hooks/useProtocolAllocations";
import { usePortfolioSnapshots, type PortfolioSnapshot } from "@/app/hooks/usePortfolioSnapshots";
import { fetchOrderBookQuote, usdcIssuerForNetwork } from "@/app/lib/stellar";
import { SmartWalletPanel } from "@/app/components/SmartWalletPanel";

const PANEL_CLS =
  "rounded-3xl border border-white/8 bg-[#111113] shadow-[0_20px_60px_-30px_rgba(0,0,0,0.8)] transition-colors duration-300 hover:border-accent-hover/25";

function Panel({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn(PANEL_CLS, className)}>{children}</div>;
}

function shortAddress(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function explorerUrl(address: string, isTestnet: boolean) {
  return `https://stellar.expert/explorer/${isTestnet ? "testnet" : "public"}/account/${address}`;
}

const RANGE_OPTIONS = [
  { value: "1D", label: "1D" },
  { value: "1W", label: "1W" },
  { value: "1M", label: "1M" },
  { value: "ALL", label: "ALL" },
] as const;

type Range = (typeof RANGE_OPTIONS)[number]["value"];

function formatChartLabel(timestampMs: number): string {
  return new Date(timestampMs).toLocaleDateString(undefined, { month: "short", day: "2-digit" });
}

function relativeTime(timestampMs: number): string {
  const diffMs = Date.now() - timestampMs;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

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

/** Portfolio hero: value, daily PnL, and the real portfolio history chart — the "how much
 *  capital do I have / how is it performing" half of dashboard.md's Investor Dashboard brief. */
function PortfolioHero({
  range,
  onRangeChange,
  history,
  portfolioValue,
  changePct,
  valueKnown,
}: {
  range: Range;
  onRangeChange: (r: Range) => void;
  history: PortfolioSnapshot[];
  portfolioValue: number;
  changePct: number | null;
  valueKnown: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const pnlTone = changePct == null ? "text-text-muted" : changePct >= 0 ? "text-success" : "text-red-400";
  const pnlLabel = changePct == null ? "—" : `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`;

  return (
    <Panel>
      <CardHeader
        title="Portfolio"
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
        <div className="mb-6 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
              Portfolio Value
            </p>
            <p className="mt-2 font-display text-4xl font-bold tabular-nums text-text-primary">
              {valueKnown ? `$${portfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "…"}
            </p>
          </div>
          <div>
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
              Daily PnL
            </p>
            <p className={`mt-2 font-display text-2xl font-bold tabular-nums ${pnlTone}`}>{pnlLabel}</p>
          </div>
        </div>

        {history.length < 2 ? (
          <div className="flex h-[280px] w-full items-center justify-center text-sm text-text-muted sm:h-[320px]">
            Not enough portfolio history yet — check back soon.
          </div>
        ) : (
          <PortfolioChart wrapRef={wrapRef} hover={hover} setHover={setHover} history={history} />
        )}
      </CardBody>
    </Panel>
  );
}

function PortfolioChart({
  wrapRef,
  hover,
  setHover,
  history,
}: {
  wrapRef: React.RefObject<HTMLDivElement | null>;
  hover: number | null;
  setHover: (n: number | null) => void;
  history: PortfolioSnapshot[];
}) {
  const values = history.map((d) => d.v);
  const { line, area, min, max } = chartGeometry(values, 1000, 300);
  const n = values.length;

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(frac * (n - 1)));
  };

  const hoverPoint = hover !== null ? history[hover] : null;
  const hoverXPct = hover !== null ? (hover / (n - 1)) * 100 : 0;
  const hoverYPct = hoverPoint ? (1 - (hoverPoint.v - min) / (max - min || 1)) * 100 : 0;

  return (
    <div
      ref={wrapRef}
      onMouseMove={handleMove}
      onMouseLeave={() => setHover(null)}
      className="relative h-[280px] w-full sm:h-[320px]"
    >
      <svg viewBox="0 0 1000 300" className="h-full w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="perf-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-hover)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent-hover)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2="1000" y1={300 * f} y2={300 * f} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
        ))}
        <path d={area} fill="url(#perf-fill)" />
        <path d={line} fill="none" stroke="var(--accent-hover)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
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
            <div className="mt-0.5 text-[10px] uppercase tracking-wider text-text-muted">{formatChartLabel(hoverPoint.t)}</div>
          </div>
        </>
      )}
    </div>
  );
}

/** Connected (Freighter) wallet card — display-only per dashboard.md: no deposit/withdraw,
 *  just Copy Address + View Explorer against the owner's own G-address. */
function ConnectedWalletCard() {
  const { connected, wallet } = useWalletContext();
  const { xlmBalance, usdcBalance, loading, error, refresh } = useStellarBalances(
    wallet?.address ?? null,
    wallet?.networkPassphrase ?? null
  );
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    if (!wallet) return;
    await navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!connected || !wallet) {
    return (
      <Panel className="flex h-full flex-col p-6">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
          Connected Wallet
        </p>
        <p className="mt-2 font-display text-2xl font-bold text-text-primary">Connect Wallet</p>
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel className="flex h-full flex-col p-6">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
          Connected Wallet
        </p>
        <p className="mt-2 text-sm text-red-400">Failed to load wallet balance.</p>
        <button
          onClick={() => refresh()}
          className="mt-auto rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-white/[0.04]"
        >
          Retry
        </button>
      </Panel>
    );
  }

  return (
    <Panel className="flex h-full flex-col p-6">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
          Connected Wallet
        </p>
        <Badge tone="success">Connected</Badge>
      </div>

      {loading && xlmBalance === 0 && usdcBalance === 0 ? (
        <div className="mt-2 flex flex-col gap-2">
          <div className="h-8 w-32 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-3 w-20 animate-pulse rounded bg-white/[0.06]" />
        </div>
      ) : (
        <>
          <p className="mt-2 font-display text-3xl font-bold tabular-nums text-text-primary">
            {`${xlmBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} XLM`}
          </p>
          <p className="text-xs text-text-muted">
            {`${usdcBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`}
          </p>
        </>
      )}

      <div className="mt-3 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="font-mono text-text-secondary">{shortAddress(wallet.address)}</span>
          <button onClick={copyAddress} className="text-text-muted transition-colors hover:text-text-primary" aria-label="Copy address">
            {copied ? "Copied" : "Copy"}
          </button>
          <a
            href={explorerUrl(wallet.address, !!wallet.isTestnet)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-muted transition-colors hover:text-text-primary"
          >
            Explorer
          </a>
        </div>
        <Badge tone="accent">{wallet.isTestnet ? "Testnet" : "Mainnet"}</Badge>
      </div>
    </Panel>
  );
}

export default function DashboardOverview() {
  const [range, setRange] = useState<Range>("1M");
  const { connected, wallet, smartWalletAddress } = useWalletContext();
  const {
    xlmBalance: freighterXlmBalance,
    usdcBalance: freighterUsdcBalance,
    loading: freighterBalanceLoading,
  } = useStellarBalances(wallet?.address ?? null, wallet?.networkPassphrase ?? null);
  const {
    xlmBalance: smartXlmBalance,
    usdcBalance: smartUsdcBalance,
    loading: smartBalanceLoading,
  } = useSmartWalletBalances(smartWalletAddress, wallet?.networkPassphrase ?? null, wallet?.sorobanRpcUrl);

  // Real XLM→USDC spot price from the testnet DEX (liquidity pool, falling back to the order
  // book) — used to value the XLM portion of both wallets in USD terms alongside USDC, which
  // is already ~1:1 USD.
  const [xlmUsdPrice, setXlmUsdPrice] = useState<number | null>(null);
  useEffect(() => {
    if (!wallet?.networkPassphrase) return;
    let cancelled = false;
    try {
      fetchOrderBookQuote(
        { code: "XLM" },
        { code: "USDC", issuer: usdcIssuerForNetwork(wallet.networkPassphrase) },
        wallet.networkPassphrase
      )
        .then((quote) => {
          if (!cancelled) setXlmUsdPrice(quote.price);
        })
        .catch(() => {
          if (!cancelled) setXlmUsdPrice(null);
        });
    } catch {
      setXlmUsdPrice(null);
    }
    return () => {
      cancelled = true;
    };
  }, [wallet?.networkPassphrase]);

  const totalXlm = freighterXlmBalance + smartXlmBalance;
  const totalUsdc = freighterUsdcBalance + smartUsdcBalance;
  const portfolioValue = totalUsdc + totalXlm * (xlmUsdPrice ?? 0);
  const balancesLoading = freighterBalanceLoading || (!!smartWalletAddress && smartBalanceLoading);
  const valueKnown = connected && !balancesLoading && xlmUsdPrice !== null;

  const { history: portfolioHistory, changePct } = usePortfolioSnapshots(
    wallet?.address ?? null,
    valueKnown ? portfolioValue : null
  );

  // No backend endpoint reports true per-asset (XLM/USDC/AQUA/...) portfolio allocation —
  // /api/allocations (useProtocolAllocations) only reports per-protocol venue exposure
  // (Spot/Blend/Soroswap), which is a different axis than "what assets do I hold" and must
  // not be substituted here (see dashboard.md's Portfolio Allocation section). Until a real
  // asset-allocation endpoint exists, this section renders a loading skeleton then an
  // explicit "unavailable" empty state — never protocol data.

  const { activity, loading: activityLoading, error: activityError, refresh: refreshActivity } =
    useProtocolAllocations(connected);

  const activityRows = activity.slice(0, 5).map((a) => ({ label: a.label, time: relativeTime(a.time) }));

  return (
    <div className="flex flex-col gap-10 pb-4 sm:gap-12">
      <PortfolioHero
        range={range}
        onRangeChange={setRange}
        history={portfolioHistory}
        portfolioValue={portfolioValue}
        changePct={changePct}
        valueKnown={valueKnown}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ConnectedWalletCard />
        <Panel className="flex h-full flex-col">
          <SmartWalletPanel />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel>
          <CardHeader title="Portfolio Allocation" />
          <CardBody className="space-y-4 pt-3">
            {!connected ? (
              <p className="py-4 text-sm text-text-muted">Connect a wallet to see your allocation.</p>
            ) : balancesLoading ? (
              <div className="space-y-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="h-3 w-24 animate-pulse rounded bg-white/[0.06]" />
                    <div className="h-1.5 w-full animate-pulse rounded-full bg-white/[0.06]" />
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-4 text-sm text-text-muted">
                Asset allocation is unavailable — no asset-level allocation data source exists yet.
              </p>
            )}
          </CardBody>
        </Panel>

        <Panel>
          <CardHeader
            title="Recent Activity"
            action={
              <span className="text-xs text-text-muted/40" aria-disabled="true">
                View All →
              </span>
            }
          />
          <CardBody className="pt-3">
            {!connected ? (
              <p className="py-4 text-sm text-text-muted">Connect a wallet to see recent activity.</p>
            ) : activityLoading && activity.length === 0 ? (
              <div className="space-y-5">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-4 w-full animate-pulse rounded bg-white/[0.06]" />
                ))}
              </div>
            ) : activityError ? (
              <div className="flex flex-col items-start gap-3 py-4">
                <p className="text-sm text-red-400">Failed to load recent activity.</p>
                <button
                  onClick={() => refreshActivity()}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-white/[0.04]"
                >
                  Retry
                </button>
              </div>
            ) : activityRows.length === 0 ? (
              <p className="py-4 text-sm text-text-muted">No activity yet.</p>
            ) : (
              <div className="space-y-0">
                {activityRows.map((item, i) => (
                  <div key={`${item.label}-${i}`} className="relative flex gap-3 pb-5 last:pb-0">
                    <div className="flex flex-col items-center">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent-hover" />
                      {i < activityRows.length - 1 && <span className="w-px flex-1 bg-white/[0.08]" />}
                    </div>
                    <div className="flex flex-1 items-center justify-between pt-0.5">
                      <span className="text-sm text-text-secondary">{item.label}</span>
                      <span className="text-xs text-text-muted">{item.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Panel>
      </div>
    </div>
  );
}
