"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRightLeft,
  Bot,
  ChevronDown,
  ExternalLink,
  Link2,
  PieChart,
  RefreshCw,
  ShieldCheck,
  Users,
  Wallet as WalletIcon,
} from "lucide-react";
import { useWalletContext } from "@/app/contexts/WalletContext";
import { useStellarBalances } from "@/app/hooks/useStellarBalances";
import { useDelegations } from "@/app/dashboard/delegations-v2/hooks/useDelegations";
import { listAgentWallets, getAgentTrades, type AgentSummary, type PnlSummary } from "@/app/lib/agentsBackend";
import { Badge } from "@/app/components/ui/Badge";
import { Card } from "@/app/components/ui/Card";
import { cn } from "@/lib/utils";

function shortAddress(addr: string) {
  return addr.length > 10 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

function Sparkline({ positive, seed = 1 }: { positive: boolean; seed?: number }) {
  const base = positive
    ? [4, 10, 8, 16, 14, 22, 20, 28]
    : [28, 22, 24, 16, 18, 10, 12, 4];
  const points = base
    .map((y, i) => `${i * 12},${32 - y - (seed % 3)}`)
    .join(" ");
  return (
    <svg viewBox="0 0 84 32" className="h-8 w-full" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke={positive ? "var(--color-success)" : "var(--color-error)"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AssetStatCard({
  label,
  code,
  value,
  changePct,
  positive,
  iconClass,
  icon: Icon,
}: {
  label: string;
  code: string;
  value: string;
  changePct: string | null;
  positive: boolean;
  iconClass: string;
  icon: React.ElementType;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className={cn("flex h-9 w-9 items-center justify-center rounded-full", iconClass)}>
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[13px] font-medium text-text-primary">{label}</p>
            <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted">{code}</p>
          </div>
        </div>
        <ExternalLink className="h-3.5 w-3.5 text-text-muted" />
      </div>

      <p className="mt-4 font-display text-[26px] font-bold leading-none tracking-tight text-text-primary tabular-nums">
        {value}
      </p>

      <div className="mt-3 flex items-end justify-between gap-3">
        {changePct !== null ? (
          <Badge tone={positive ? "success" : "error"} dot>
            {positive ? "+" : ""}
            {changePct}%
          </Badge>
        ) : (
          <Badge tone="neutral">No data</Badge>
        )}
        <div className="w-20">
          <Sparkline positive={positive} />
        </div>
      </div>
    </Card>
  );
}

const STATUS_TONE: Record<AgentSummary["status"], "success" | "warning" | "error" | "neutral"> = {
  running: "success",
  new: "neutral",
  stopped: "warning",
  error: "error",
};

export default function DashboardOverview() {
  const { wallet, walletOwner, smartWalletAddress, connected, connecting, connect, checked } = useWalletContext();
  const { xlmBalance, usdcBalance } = useStellarBalances(
    wallet?.address ?? null,
    wallet?.isTestnet ? "Test SDF Network ; September 2015" : null,
  );
  const { stats: delegationStats } = useDelegations(
    walletOwner,
    smartWalletAddress,
    "Test SDF Network ; September 2015",
  );

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [primaryPnl, setPrimaryPnl] = useState<PnlSummary | null>(null);

  useEffect(() => {
    if (!walletOwner) return;
    let cancelled = false;
    setAgentsLoading(true);
    listAgentWallets(walletOwner)
      .then((list) => {
        if (cancelled) return;
        setAgents(list);
        const primary = list[0];
        if (primary) {
          getAgentTrades(primary.id)
            .then((r) => !cancelled && setPrimaryPnl(r.pnl))
            .catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => !cancelled && setAgentsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [walletOwner]);

  const [onboardingDismissed, setOnboardingDismissed] = useState(
    typeof window !== "undefined" ? localStorage.getItem("kairos:onboarding-dismissed") === "1" : false
  );
  const dismissOnboarding = () => {
    localStorage.setItem("kairos:onboarding-dismissed", "1");
    setOnboardingDismissed(true);
  };

  const primaryAgent = agents[0];
  const portfolioValue = xlmBalance * 0.12 + usdcBalance;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-text-primary">
            Overview
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Your Stellar testnet portfolio, delegations & agents at a glance
          </p>
        </div>
        {!wallet ? (
          <button
            onClick={connect}
            disabled={connecting}
            aria-busy={connecting}
            className="inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <WalletIcon className="h-4 w-4" />
            {connecting ? "Connecting…" : "Connect Wallet"}
          </button>
        ) : (
          <Badge tone={wallet.isTestnet ? "warning" : "success"} dot>
            {wallet.network} · {shortAddress(wallet.address)}
          </Badge>
        )}
      </div>

      {/* First-run onboarding */}
      {!onboardingDismissed && (
        <div className="rounded-2xl border border-accent/15 bg-accent-muted/20 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-sm font-medium text-text-primary">
                Welcome to Kairos on Stellar Testnet
              </h2>
              <p className="mt-1 text-xs text-text-secondary">
                Connect Freighter and start trading XLM/USDC on the Stellar testnet using
                Soroban smart contracts. Deploy a smart wallet, create delegations, and
                let agents trade autonomously.
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
              <p className="mt-1 text-xs font-medium text-text-primary">Trade XLM/USDC</p>
              <p className="mt-0.5 text-[11px] text-text-muted">Manual mode on Stellar DEX</p>
            </Link>
            <Link
              href="/dashboard/delegations-v2"
              className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            >
              <p className="font-mono text-[10px] uppercase tracking-widest text-accent">Step 2</p>
              <p className="mt-1 text-xs font-medium text-text-primary">Deploy Smart Wallet</p>
              <p className="mt-0.5 text-[11px] text-text-muted">Create a delegation</p>
            </Link>
            <Link
              href="/dashboard/agents"
              className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            >
              <p className="font-mono text-[10px] uppercase tracking-widest text-accent">Step 3</p>
              <p className="mt-1 text-xs font-medium text-text-primary">Configure Agent</p>
              <p className="mt-0.5 text-[11px] text-text-muted">Set automation defaults</p>
            </Link>
          </div>
        </div>
      )}

      {/* ── Row 1: Recommended assets + Agent promo ── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        <div className="xl:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted">
                Stellar Testnet Assets
              </p>
              <h2 className="mt-0.5 font-display text-lg font-semibold text-text-primary">
                Your Balances
              </h2>
            </div>
            <button className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-1.5 text-xs text-text-secondary transition-colors hover:text-text-primary">
              24H <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <AssetStatCard
              label="Stellar Lumens"
              code="XLM"
              value={wallet ? `${xlmBalance.toFixed(2)} XLM` : "—"}
              changePct={wallet ? "2.14" : null}
              positive
              icon={WalletIcon}
              iconClass="bg-accent/15 text-accent"
            />
            <AssetStatCard
              label="USD Coin"
              code="USDC"
              value={wallet ? `${usdcBalance.toFixed(2)} USDC` : "—"}
              changePct={wallet ? "0.04" : null}
              positive
              icon={PieChart}
              iconClass="bg-emerald-500/15 text-emerald-400"
            />
            <AssetStatCard
              label="Portfolio Value"
              code="EST. USD"
              value={wallet ? `$${portfolioValue.toFixed(2)}` : "—"}
              changePct={wallet ? "1.08" : null}
              positive={false}
              icon={ArrowRightLeft}
              iconClass="bg-amber-500/15 text-amber-400"
            />
          </div>
        </div>

        {/* Agent promo */}
        <Card className="relative flex flex-col overflow-hidden p-6">
          <div
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{ background: "radial-gradient(ellipse at 30% 0%, rgba(124,92,255,0.25) 0%, transparent 65%)" }}
          />
          <div className="relative flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/20 text-accent">
              <Bot className="h-4 w-4" />
            </span>
            <Badge tone="accent">New</Badge>
          </div>
          <h3 className="relative mt-4 font-display text-xl font-semibold text-text-primary">
            Kairos Autonomous Agent
          </h3>
          <p className="relative mt-2 text-xs leading-relaxed text-text-secondary">
            Delegate spend authority with policy caveats and let an agent execute your
            DCA or quant strategy on Stellar — hands-free.
          </p>
          <div className="relative mt-auto flex flex-col gap-2 pt-6">
            <Link
              href="/dashboard/agents"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-accent-hover"
            >
              <WalletIcon className="h-3.5 w-3.5" />
              Configure Agent
            </Link>
            <Link
              href="/dashboard/delegations-v2"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
            >
              Manage Delegation
            </Link>
          </div>
        </Card>
      </div>

      {/* ── Row 2: Delegation summary strip ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Active Delegations", value: delegationStats.activeCount, icon: ShieldCheck, tone: "text-accent bg-accent/15" },
          { label: "Policies Attached", value: delegationStats.policiesAttached, icon: Link2, tone: "text-emerald-400 bg-emerald-500/15" },
          { label: "Agents", value: agents.length, icon: Bot, tone: "text-amber-400 bg-amber-500/15" },
          { label: "Revoked", value: delegationStats.revokedCount, icon: Users, tone: "text-error bg-error/15" },
        ].map((s) => (
          <Card key={s.label} className="flex items-center gap-3 p-4">
            <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", s.tone)}>
              <s.icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="font-display text-lg font-bold leading-none text-text-primary tabular-nums">
                {s.value}
              </p>
              <p className="mt-1 truncate text-[11px] text-text-muted">{s.label}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* ── Row 3: Active agent (Stakent-style stake card) + wallet card ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          {agentsLoading ? (
            <div className="flex h-40 items-center justify-center text-xs text-text-muted">
              Loading agents…
            </div>
          ) : primaryAgent ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] text-text-muted">
                      Agent · {primaryAgent.strategy?.type === "dca" ? "DCA Strategy" : primaryAgent.strategy?.type === "quant" ? "Quant Strategy" : "No strategy set"}
                    </p>
                    <Badge tone={STATUS_TONE[primaryAgent.status]} dot>
                      {primaryAgent.status}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <h3 className="font-display text-base font-semibold text-text-primary">
                      {shortAddress(primaryAgent.publicKey)}
                    </h3>
                    <Link2 className="h-3.5 w-3.5 text-text-muted" />
                    <RefreshCw className="h-3.5 w-3.5 text-text-muted" />
                    <Link
                      href="/dashboard/agents"
                      className="text-[11px] font-medium text-accent hover:text-accent-hover"
                    >
                      View Agent →
                    </Link>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link
                    href="/dashboard/agents"
                    className="rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent-hover"
                  >
                    Manage
                  </Link>
                  <button className="rounded-lg border border-white/10 bg-white/[0.03] px-3.5 py-2 text-xs text-text-secondary transition-colors hover:text-text-primary">
                    Stop
                  </button>
                </div>
              </div>

              <div className="mt-6">
                <p className="text-[11px] text-text-muted">Realized PnL</p>
                <p className="mt-1 font-display text-4xl font-bold tracking-tight text-text-primary tabular-nums">
                  {primaryPnl ? primaryPnl.realizedPnl : "0.00"}
                  <span className="ml-2 text-base font-medium text-text-muted">USDC</span>
                </p>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Status", value: primaryAgent.status, tone: "24H" },
                  { label: "Pair", value: primaryAgent.strategy && "pair" in primaryAgent.strategy ? primaryAgent.strategy.pair : "XLM/USDC", tone: "24H" },
                  { label: "Unrealized PnL", value: primaryPnl?.unrealizedPnl ?? "0.00", tone: "24H" },
                  { label: "Open Position", value: primaryPnl?.openPosition ?? "0.00", tone: "24H" },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] text-text-muted">{s.label}</p>
                      <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted/70">
                        {s.tone}
                      </span>
                    </div>
                    <p className="mt-1.5 font-mono text-sm font-medium text-text-primary tabular-nums">
                      {s.value}
                    </p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex h-40 flex-col items-center justify-center gap-3 text-center">
              <Bot className="h-8 w-8 text-text-muted" />
              <p className="text-xs text-text-muted">
                {connected ? "No agents deployed yet." : "Connect your wallet to view agents."}
              </p>
              {connected && (
                <Link
                  href="/dashboard/agents"
                  className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent-hover"
                >
                  Deploy Agent
                </Link>
              )}
            </div>
          )}
        </Card>

        <Card className="p-6">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
            Wallet
          </p>
          {wallet ? (
            <>
              <p className="mt-1.5 font-display text-3xl font-bold tracking-tight text-text-primary tabular-nums">
                {parseFloat(wallet.balance).toFixed(2)}{" "}
                <span className="text-base font-medium text-text-muted">XLM</span>
              </p>
              <p className="mt-1 font-mono text-xs text-text-secondary">
                {shortAddress(wallet.address)}
              </p>
              <div className="mt-4 flex flex-col gap-2">
                <Link
                  href="/dashboard/trade"
                  className="rounded-xl bg-accent px-4 py-2.5 text-center text-xs font-semibold text-white transition-colors hover:bg-accent-hover"
                >
                  Trade XLM/USDC
                </Link>
                <Link
                  href="/dashboard/delegations-v2"
                  className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2.5 text-center text-xs text-text-secondary transition-colors hover:text-text-primary"
                >
                  Manage Delegations
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className="mt-1.5 font-display text-3xl font-bold tracking-tight text-text-muted">—</p>
              <p className="mt-1 text-xs text-text-muted">
                {checked ? "No wallet connected" : "Checking connection…"}
              </p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
