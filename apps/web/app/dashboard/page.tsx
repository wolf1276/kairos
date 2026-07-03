"use client";

import Link from "next/link";
import { useEffect, useState, useMemo } from "react";
import { useWalletContext } from "@/app/contexts/WalletContext";
import { useSmartWalletBalances } from "@/app/hooks/useSmartWalletBalances";
import { useDelegations } from "@/app/dashboard/delegations/hooks/useDelegations";
import {
  listAgentWallets,
  getAgentTrades,
  getAgentsSummary,
  getPortfolioOverview,
  getBackendHealth,
  type AgentSummary,
  type TradeRow,
  type AgentDashboard,
  type PortfolioOverview,
} from "@/app/lib/agentsBackend";
import { usePrices } from "@/app/hooks/usePrices";
import { usePortfolioSnapshots } from "@/app/hooks/usePortfolioSnapshots";
import type { Time } from "lightweight-charts";
import { cn } from "@/lib/utils";

import { PortfolioHero } from "@/app/components/dashboard/PortfolioHero";
import { PerformanceChart } from "@/app/components/dashboard/PerformanceChart";
import { AIControlCenter } from "@/app/components/dashboard/AIControlCenter";
import { AllocationChart } from "@/app/components/dashboard/AllocationChart";
import { AgentStatusCard } from "@/app/components/dashboard/AgentStatusCard";
import { ExecutionTimeline } from "@/app/components/dashboard/ExecutionTimeline";
import { InsightCard } from "@/app/components/dashboard/InsightCard";

function shortAddress(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function toRiskLevel(riskLevel: string | null | undefined): "Low" | "Medium" | "High" {
  const normalized = riskLevel?.toLowerCase();
  if (normalized === "low") return "Low";
  if (normalized === "high") return "High";
  return "Medium";
}

function toRiskProfile(riskLevel: string | null | undefined): "Conservative" | "Moderate" | "Aggressive" | "Medium" {
  const normalized = riskLevel?.toLowerCase();
  if (normalized === "low") return "Conservative";
  if (normalized === "high") return "Aggressive";
  if (normalized === "medium") return "Moderate";
  return "Medium";
}

export default function DashboardOverview() {
  const {
    wallet,
    connected,
    connecting,
    connect,
    checked,
    walletOwner,
    smartWalletAddress,
  } = useWalletContext();
  const networkPassphrase = wallet?.networkPassphrase ?? "Test SDF Network ; September 2015";

  const {
    xlmBalance,
    usdcBalance,
  } = useSmartWalletBalances(smartWalletAddress, wallet?.networkPassphrase ?? null, wallet?.sorobanRpcUrl);

  const { priceMap } = usePrices(["XLMUSDT", "USDCUSDT"]);
  const xlmPrice = priceMap["XLMUSDT"];
  const usdcPrice = priceMap["USDCUSDT"];
  const pricesReady = xlmPrice != null && usdcPrice != null;
  const portfolioUsd = pricesReady ? xlmBalance * xlmPrice + usdcBalance * usdcPrice : null;

  const growth = usePortfolioSnapshots(walletOwner, smartWalletAddress ? portfolioUsd : null);

  const { stats: delegationStats } = useDelegations(
    walletOwner,
    smartWalletAddress,
    networkPassphrase
  );

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [, setTradesLoading] = useState(false);
  const [dashboards, setDashboards] = useState<AgentDashboard[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioOverview | null>(null);
  const [backendHealthy, setBackendHealthy] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = () => getBackendHealth().then((ok) => !cancelled && setBackendHealthy(ok)).catch(() => !cancelled && setBackendHealthy(false));
    check();
    const interval = setInterval(check, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!walletOwner) return;
    setAgentsLoading(true);
    listAgentWallets(walletOwner)
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setAgentsLoading(false));
  }, [walletOwner]);

  useEffect(() => {
    if (agents.length === 0) {
      setTrades([]);
      return;
    }
    setTradesLoading(true);
    Promise.all(agents.map((a) => getAgentTrades(a.id).catch(() => ({ trades: [], pnl: null }))))
      .then((results) => {
        const all = results.flatMap((r) => r.trades);
        all.sort((a, b) => b.created_at - a.created_at);
        setTrades(all.slice(0, 8));
      })
      .finally(() => setTradesLoading(false));
  }, [agents]);

  useEffect(() => {
    if (!walletOwner || agents.length === 0) {
      setDashboards([]);
      return;
    }
    getAgentsSummary()
      .then(setDashboards)
      .catch(() => setDashboards([]));
  }, [walletOwner, agents]);

  useEffect(() => {
    if (!walletOwner) return;
    getPortfolioOverview()
      .then(setPortfolio)
      .catch(() => setPortfolio(null));
  }, [walletOwner, portfolioUsd]);

  const insights = useMemo(
    () => agents.filter((a) => a.lastResult || a.lastError).slice(0, 4),
    [agents]
  );

  const activeAgentCount = agents.filter((a) => a.status === "running").length;

  const avgConfidence = useMemo(() => {
    const withConfidence = dashboards.filter((d) => d.currentConfidence != null);
    if (withConfidence.length === 0) return null;
    return withConfidence.reduce((acc, d) => acc + (d.currentConfidence ?? 0), 0) / withConfidence.length;
  }, [dashboards]);

  const idleUsd = portfolio?.allocation.idleUsd ?? 0;
  const riskExposure = portfolio && portfolio.allocation.totalValue > 0
    ? `${(100 - (idleUsd / portfolio.allocation.totalValue) * 100).toFixed(1)}%`
    : "—";

  const allocationData = useMemo(() => {
    if (!portfolio || portfolio.allocation.totalValue === 0) return [];
    return [
      { label: "XLM", value: portfolio.allocation.xlmValue, color: "#7851e9" },
      { label: "USDC", value: portfolio.allocation.usdcValue, color: "#2dd4a0" },
      { label: "Idle", value: portfolio.allocation.idleUsd, color: "#a8a6a2" },
    ];
  }, [portfolio]);

  const performanceData = useMemo(() => {
    if (!growth.history.length) return [];
    return growth.history.map((s) => ({
      time: Math.floor(s.t / 1000) as Time,
      value: s.v,
    }));
  }, [growth.history]);

  const delegatedCapital = portfolio ? portfolio.allocation.xlmValue + portfolio.allocation.usdcValue : 0;
  const availableCapital = portfolio ? portfolio.allocation.idleUsd : 0;

  const latestDecision = useMemo(() => {
    const withDecisions = dashboards.filter((d) => d.lastDecisionTime != null);
    if (withDecisions.length === 0) return null;
    return withDecisions.reduce((latest, d) =>
      (d.lastDecisionTime ?? 0) > (latest.lastDecisionTime ?? 0) ? d : latest
    );
  }, [dashboards]);

  if (!checked) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="max-w-sm rounded-2xl border border-white/[0.06] bg-bg-card p-8 text-center">
          <h2 className="font-display text-base font-medium text-text-primary">Connect your wallet</h2>
          <p className="mt-2 text-xs text-text-muted">
            Connect Freighter to view your portfolio, delegations, and agents.
          </p>
          <button
            onClick={() => connect()}
            disabled={connecting}
            className="mt-5 w-full rounded-xl bg-accent/80 px-4 py-2.5 text-xs font-semibold text-white transition-all duration-300 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            {connecting ? "Connecting…" : "Connect Freighter"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Top actions ── */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-lg font-medium text-text-primary">Overview</h1>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider",
                backendHealthy === true && "border-success/15 bg-success/8 text-success/90",
                backendHealthy === false && "border-error/15 bg-error/8 text-error/90",
                backendHealthy === null && "border-white/[0.06] bg-white/[0.02] text-text-muted"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  backendHealthy === true && "bg-success",
                  backendHealthy === false && "bg-error",
                  backendHealthy === null && "bg-text-muted"
                )}
              />
              {backendHealthy === true ? "Backend Online" : backendHealthy === false ? "Backend Offline" : "Checking…"}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {smartWalletAddress ? shortAddress(smartWalletAddress) : "No capital wallet deployed yet"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/trade"
            className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2 text-xs text-text-secondary transition-colors hover:text-text-primary"
          >
            Trade
          </Link>
          <Link
            href="/dashboard/delegations"
            className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2 text-xs text-text-secondary transition-colors hover:text-text-primary"
          >
            Policy
          </Link>
        </div>
      </div>

      {/* ── Portfolio Hero ── */}
      <PortfolioHero
        portfolioValue={portfolioUsd ? formatCurrency(portfolioUsd) : "—"}
        changePct={growth.changePct ?? 0}
        delegatedCapital={formatCurrency(delegatedCapital)}
        availableCapital={formatCurrency(availableCapital)}
        automationStatus={delegationStats.activeCount > 0 ? "active" : "idle"}
        currentStrategy={agents.length > 0 ? `${activeAgentCount} Active` : "None"}
        riskProfile={toRiskProfile(agents.find((a) => a.riskLevel)?.riskLevel)}
        marketRegime={riskExposure !== "—" && parseFloat(riskExposure) > 50 ? "Volatile" : "Stable"}
        aiConfidence={avgConfidence ?? 0}
        sparklineData={growth.history}
      />

      {/* ── Performance Chart + AI Control Center ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PerformanceChart data={performanceData} />
        </div>
        <div>
          <AIControlCenter
            status={delegationStats.activeCount > 0 ? "executing" : "idle"}
            currentDecision={latestDecision?.currentDecision ?? (agents.length > 0 ? "Monitoring market conditions" : "Awaiting agent configuration")}
            reasoning={latestDecision?.currentReasoning ?? "No recent decisions recorded yet."}
            confidence={latestDecision?.currentConfidence ?? 0}
            riskLevel={toRiskLevel(latestDecision?.riskLevel)}
            nextAnalysis={latestDecision?.lastDecisionTime ? new Date(latestDecision.lastDecisionTime).toLocaleTimeString() : "—"}
            latency={latestDecision?.lastExecution ? Math.max(0, Date.now() - latestDecision.lastExecution) : 0}
            agentHealth={agents.length > 0 ? activeAgentCount / agents.length : 0}
            modelStatus={agents.length === 0 ? "offline" : "online"}
          />
        </div>
      </div>

      {/* ── Portfolio Allocation + Agent Status ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AllocationChart assets={allocationData} total={portfolioUsd ?? 0} />
        </div>
        <div>
          <div className="rounded-2xl border border-white/[0.06] bg-bg-card p-5">
            <h3 className="font-display text-sm font-medium text-text-primary mb-4">Agent Status</h3>
            <div className="space-y-3">
              {agentsLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-24 animate-pulse rounded-xl bg-bg-elevated/60" />
                ))
              ) : agents.length === 0 ? (
                <p className="text-xs text-text-muted text-center py-4">
                  No agents yet. Create one from the{" "}
                  <Link href="/dashboard/trade" className="text-accent/80 hover:text-accent">Trade page</Link>.
                </p>
              ) : (
                agents.slice(0, 4).map((agent) => {
                  const dashboard = dashboards.find((d) => d.agent.id === agent.id);
                  return (
                    <AgentStatusCard
                      key={agent.id}
                      name={shortAddress(agent.publicKey)}
                      status={agent.status === "new" ? "idle" : agent.status === "stopped" ? "stopped" : agent.status === "error" ? "error" : "running"}
                      confidence={dashboard?.currentConfidence ?? 0}
                      currentTask={dashboard?.currentTask ?? (agent.strategy ? agent.strategy.type.toUpperCase() : "Unconfigured")}
                      successRate={dashboard ? dashboard.winRate * 100 : 0}
                      lastAction={agent.lastTickAt ? new Date(agent.lastTickAt).toLocaleTimeString() : "Never"}
                      latency={dashboard?.lastExecution ? Math.max(0, Date.now() - dashboard.lastExecution) : 0}
                    />
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Recent Executions + AI Insights ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ExecutionTimeline
          items={trades.map((t) => ({
            id: t.id,
            action: `${t.side.toUpperCase()} ${t.pair}`,
            asset: t.pair,
            amount: t.amount,
            timestamp: t.created_at,
            reason: t.side === "buy" ? "Strategy execution" : "Rebalancing",
            policy: t.strategy_id,
            result: t.status,
          }))}
        />
        <div className="rounded-2xl border border-white/[0.06] bg-bg-card p-5">
          <h3 className="font-display text-sm font-medium text-text-primary mb-4">AI Insights</h3>
          <div className="space-y-3">
            {insights.length === 0 ? (
              <p className="text-xs text-text-muted text-center py-4">No insights available yet.</p>
            ) : (
              insights.map((agent) => {
                const dashboard = dashboards.find((d) => d.agent.id === agent.id);
                return (
                  <InsightCard
                    key={agent.id}
                    type={agent.lastError ? "risk" : "opportunity"}
                    title={agent.lastError ? "Execution Issue Detected" : "Strategy Update Available"}
                    summary={agent.lastError || agent.lastResult || "Agent produced a result."}
                    confidence={dashboard?.currentConfidence ?? 0}
                    timestamp={agent.lastTickAt ?? Date.now()}
                  />
                );
              })
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
