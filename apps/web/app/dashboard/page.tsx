"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRightLeft, PieChart, Users, ArrowUpRight, Wallet as WalletIcon } from "lucide-react";
import { useWalletContext } from "@/app/contexts/WalletContext";
import { useStellarBalances } from "@/app/hooks/useStellarBalances";
import { Badge } from "@/app/components/ui/Badge";
import { Card } from "@/app/components/ui/Card";
import { cn } from "@/lib/utils";

const QUICK_ACTIONS = [
  {
    href: "/dashboard/trade",
    title: "New Trade",
    desc: "Trade XLM/USDC on Stellar testnet",
    icon: ArrowRightLeft,
    iconClass: "bg-accent/15 text-accent",
  },
  {
    href: "/dashboard/delegations-v2",
    title: "Delegations",
    desc: "Manage smart wallets & policies",
    icon: Users,
    iconClass: "bg-amber-500/15 text-amber-400",
  },
  {
    href: "/dashboard/portfolio",
    title: "Portfolio",
    desc: "Track positions & portfolio",
    icon: PieChart,
    iconClass: "bg-emerald-500/15 text-emerald-400",
  },
];

function shortAddress(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function Sparkline({ positive }: { positive: boolean }) {
  const points = positive
    ? "0,28 12,24 24,26 36,18 48,20 60,10 72,14 84,4"
    : "0,6 12,10 24,8 36,16 48,14 60,22 72,18 84,28";
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

function StatCard({
  label,
  value,
  unit,
  changePct,
  positive,
  iconClass,
  icon: Icon,
}: {
  label: string;
  value: string;
  unit: string;
  changePct: string;
  positive: boolean;
  iconClass: string;
  icon: React.ElementType;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className={cn("flex h-8 w-8 items-center justify-center rounded-full", iconClass)}>
            <Icon className="h-4 w-4" />
          </span>
          <p className="text-[13px] font-medium text-text-secondary">{label}</p>
        </div>
        <ArrowUpRight className="h-3.5 w-3.5 text-text-muted" />
      </div>

      <p className="mt-4 font-display text-[26px] font-bold leading-none tracking-tight text-text-primary tabular-nums">
        {value}
        <span className="ml-1 text-sm font-medium text-text-muted">{unit}</span>
      </p>

      <div className="mt-3 flex items-end justify-between gap-3">
        <Badge tone={positive ? "success" : "error"} dot>
          {positive ? "+" : ""}
          {changePct}%
        </Badge>
        <div className="w-20">
          <Sparkline positive={positive} />
        </div>
      </div>
    </Card>
  );
}

export default function DashboardOverview() {
  const { wallet, connected, connecting, connect, checked } = useWalletContext();
  const { xlmBalance, usdcBalance } = useStellarBalances(
    wallet?.address ?? null,
    wallet?.isTestnet ? "Test SDF Network ; September 2015" : null,
  );

  const [onboardingDismissed, setOnboardingDismissed] = useState(
    typeof window !== "undefined" ? localStorage.getItem("kairos:onboarding-dismissed") === "1" : false
  );
  const dismissOnboarding = () => {
    localStorage.setItem("kairos:onboarding-dismissed", "1");
    setOnboardingDismissed(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-text-primary">
            Overview
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Your Stellar testnet portfolio at a glance
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
              href="/dashboard/settings"
              className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            >
              <p className="font-mono text-[10px] uppercase tracking-widest text-accent">Step 3</p>
              <p className="mt-1 text-xs font-medium text-text-primary">Configure Agent</p>
              <p className="mt-0.5 text-[11px] text-text-muted">Set automation defaults</p>
            </Link>
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="XLM Balance"
          value={wallet ? xlmBalance.toFixed(2) : "—"}
          unit="XLM"
          changePct="2.14"
          positive
          icon={WalletIcon}
          iconClass="bg-accent/15 text-accent"
        />
        <StatCard
          label="USDC Balance"
          value={wallet ? usdcBalance.toFixed(2) : "—"}
          unit="USDC"
          changePct="0.42"
          positive
          icon={PieChart}
          iconClass="bg-emerald-500/15 text-emerald-400"
        />
        <StatCard
          label="Est. Portfolio Value"
          value={wallet ? (xlmBalance * 0.12 + usdcBalance).toFixed(2) : "—"}
          unit="USD"
          changePct="1.08"
          positive={false}
          icon={ArrowRightLeft}
          iconClass="bg-amber-500/15 text-amber-400"
        />
      </div>

      {/* Wallet + Quick actions */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <div className="flex items-start justify-between">
            <div className="space-y-1.5">
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
                Wallet
              </p>
              {wallet ? (
                <>
                  <p className="font-display text-4xl font-bold tracking-tight text-text-primary tabular-nums">
                    {parseFloat(wallet.balance).toFixed(2)}{" "}
                    <span className="text-lg font-medium text-text-muted">XLM</span>
                  </p>
                  <p className="mt-1 font-mono text-xs text-text-secondary">
                    {shortAddress(wallet.address)}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-display text-4xl font-bold tracking-tight text-text-muted">
                    —
                  </p>
                  <p className="mt-1 text-xs text-text-muted">
                    {checked ? "No wallet connected" : "Checking connection…"}
                  </p>
                </>
              )}
            </div>
          </div>

          {wallet && (
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href="/dashboard/trade"
                className="rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent-hover"
              >
                Trade XLM/USDC
              </Link>
              <Link
                href="/dashboard/delegations-v2"
                className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2 text-xs text-text-secondary transition-colors hover:text-text-primary"
              >
                Manage Delegations
              </Link>
            </div>
          )}
        </Card>

        <div className="space-y-3">
          {QUICK_ACTIONS.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-4 transition-all duration-200 hover:border-accent/15 hover:bg-white/[0.04]"
            >
              <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", a.iconClass)}>
                <a.icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-text-primary">{a.title}</p>
                <p className="mt-0.5 truncate text-[11px] text-text-muted">{a.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
