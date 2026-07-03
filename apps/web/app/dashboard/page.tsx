"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useWalletContext } from "@/app/contexts/WalletContext";
import { Badge } from "@/app/components/ui/Badge";
import { Card } from "@/app/components/ui/Card";

const QUICK_ACTIONS = [
  {
    href: "/dashboard/trade",
    title: "New Trade",
    desc: "Trade XLM/USDC on Stellar testnet",
  },
  {
    href: "/dashboard/delegations-v2",
    title: "Delegations",
    desc: "Manage smart wallets & policies",
  },
  {
    href: "/dashboard/portfolio",
    title: "Portfolio",
    desc: "Track positions & portfolio",
  },
];

function shortAddress(addr: string) {
  return `${addr.slice(0, 4)}\u2026${addr.slice(-4)}`;
}

export default function DashboardOverview() {
  const { wallet, connected, connecting, connect, checked } = useWalletContext();

  // `localStorage` doesn't exist during SSR — this component is a client component, but
  // Next.js still server-renders it for the initial HTML, so reading it in a useState
  // initializer (which runs on that first render) crashed the whole page with a 500.
  const [onboardingDismissed, setOnboardingDismissed] = useState(
    typeof window !== "undefined" ? localStorage.getItem("kairos:onboarding-dismissed") === "1" : false
  );
  const dismissOnboarding = () => {
    localStorage.setItem("kairos:onboarding-dismissed", "1");
    setOnboardingDismissed(true);
  };

  return (
    <div className="space-y-5">
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

      {/* Wallet + Quick actions */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Wallet */}
        <Card className="p-6 lg:col-span-2">
          <div className="flex items-start justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
                  Wallet
                </p>
                {wallet && (
                  <Badge tone={wallet.isTestnet ? "warning" : "success"} dot>
                    {wallet.network}
                  </Badge>
                )}
              </div>
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
                    {checked ? "No wallet connected" : "Checking connection\u2026"}
                  </p>
                </>
              )}
            </div>
          </div>

          {!wallet ? (
            <button
              onClick={connect}
              disabled={connecting}
              aria-busy={connecting}
              className="mt-4 inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg bg-accent/80 px-3 py-1.5 text-xs font-semibold text-white transition-all duration-300 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {connecting ? "Connecting\u2026" : "Connect Wallet"}
            </button>
          ) : (
            <div className="mt-4 flex flex-wrap gap-4">
              <Link
                href="/dashboard/trade"
                className="rounded-lg bg-accent/80 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent"
              >
                Trade XLM/USDC
              </Link>
              <Link
                href="/dashboard/delegations-v2"
                className="rounded-lg border border-white/5 bg-white/[0.02] px-4 py-2 text-xs text-text-secondary transition-colors hover:text-text-primary"
              >
                Manage Delegations
              </Link>
            </div>
          )}
        </Card>

        {/* Quick Stats */}
        <div className="space-y-3">
          {QUICK_ACTIONS.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="block rounded-xl border border-white/5 bg-white/[0.02] p-4 transition-all duration-200 hover:border-accent/15 hover:bg-white/[0.03]"
            >
              <p className="text-xs font-medium text-text-primary">{a.title}</p>
              <p className="mt-0.5 text-[11px] text-text-muted">{a.desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
