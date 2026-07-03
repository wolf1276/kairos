"use client";

import Link from "next/link";
import { useEffect, useState, useMemo } from "react";
import { useWalletContext } from "@/app/contexts/WalletContext";
import { useStellarBalances } from "@/app/hooks/useStellarBalances";
import { useSmartWalletBalances } from "@/app/hooks/useSmartWalletBalances";
import { useDelegations } from "@/app/dashboard/delegations/hooks/useDelegations";
import {
  listAgentWallets,
  getAgentTrades,
  getAgentsSummary,
  getPortfolioOverview,
  getAuditLog,
  type AgentSummary,
  type TradeRow,
  type AgentDashboard,
  type PortfolioOverview,
  type AuditLogRow,
} from "@/app/lib/agentsBackend";
import { delegateXLM, withdrawFromSmartWallet } from "@/app/lib/stellar";
import { usePrices } from "@/app/hooks/usePrices";
import { usePortfolioSnapshots } from "@/app/hooks/usePortfolioSnapshots";
import type { Time } from "lightweight-charts";

import { PortfolioHero } from "@/app/components/dashboard/PortfolioHero";
import { MetricCard } from "@/app/components/dashboard/MetricCard";
import { PerformanceChart } from "@/app/components/dashboard/PerformanceChart";
import { AIControlCenter } from "@/app/components/dashboard/AIControlCenter";
import { AllocationChart } from "@/app/components/dashboard/AllocationChart";
import { AgentStatusCard } from "@/app/components/dashboard/AgentStatusCard";
import { ExecutionTimeline } from "@/app/components/dashboard/ExecutionTimeline";
import { InsightCard } from "@/app/components/dashboard/InsightCard";
import { PolicySummary } from "@/app/components/dashboard/PolicySummary";
import { ActivityFeed } from "@/app/components/dashboard/ActivityFeed";
import { QuickStatCard } from "@/app/components/dashboard/QuickStatCard";

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

function statusTone(status: AgentSummary["status"]): "success" | "error" | "warning" | "neutral" {
  if (status === "running") return "success";
  if (status === "error") return "error";
  if (status === "stopped") return "neutral";
  return "warning";
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
    deploying,
    deployError,
    deploySmartWallet,
  } = useWalletContext();
  const networkPassphrase = wallet?.networkPassphrase ?? "Test SDF Network ; September 2015";

  const {
    xlmBalance,
    usdcBalance,
    loading: balancesLoading,
    refresh: refreshBalances,
  } = useSmartWalletBalances(smartWalletAddress, wallet?.networkPassphrase ?? null, wallet?.sorobanRpcUrl);

  const {
    xlmBalance: freighterXlmBalance,
    loading: freighterBalanceLoading,
    refresh: refreshFreighterBalance,
  } = useStellarBalances(wallet?.address ?? null, wallet?.networkPassphrase ?? null);

  const { priceMap, loading: pricesLoading, error: pricesError } = usePrices(["XLMUSDT", "USDCUSDT"]);
  const xlmPrice = priceMap["XLMUSDT"];
  const usdcPrice = priceMap["USDCUSDT"];
  const pricesReady = xlmPrice != null && usdcPrice != null;
  const portfolioUsd = pricesReady ? xlmBalance * xlmPrice + usdcBalance * usdcPrice : null;

  const growth = usePortfolioSnapshots(walletOwner, smartWalletAddress ? portfolioUsd : null);

  const [transferMode, setTransferMode] = useState<"deposit" | "withdraw" | null>(null);
  const [transferAmount, setTransferAmount] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  const closeTransfer = () => {
    setTransferMode(null);
    setTransferAmount("");
    setTransferError(null);
  };

  const submitTransfer = async () => {
    if (!smartWalletAddress || !transferMode) return;
    const amt = parseFloat(transferAmount);
    if (!amt || amt <= 0) {
      setTransferError("Enter a valid amount");
      return;
    }
    setTransferBusy(true);
    setTransferError(null);
    try {
      if (transferMode === "deposit") {
        await delegateXLM(transferAmount, smartWalletAddress, networkPassphrase, wallet?.sorobanRpcUrl);
      } else {
        await withdrawFromSmartWallet(smartWalletAddress, transferAmount, networkPassphrase, wallet?.sorobanRpcUrl);
      }
      await Promise.all([refreshBalances(), refreshFreighterBalance()]);
      closeTransfer();
    } catch (e) {
      setTransferError(e instanceof Error ? e.message : String(e));
    } finally {
      setTransferBusy(false);
    }
  };

  const { stats: delegationStats, loading: delegationsLoading } = useDelegations(
    walletOwner,
    smartWalletAddress,
    networkPassphrase
  );

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [dashboards, setDashboards] = useState<AgentDashboard[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioOverview | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditLogRow[]>([]);

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

  useEffect(() => {
    if (!walletOwner) return;
    getAuditLog({ limit: 5 })
      .then(setAuditEvents)
      .catch(() => setAuditEvents([]));
  }, [walletOwner, trades]);

  const totalRealizedPnl = useMemo(
    () => trades.reduce((acc, t) => acc + (t.realized_pnl ? parseFloat(t.realized_pnl) : 0), 0),
    [trades]
  );

  const insights = useMemo(
    () => agents.filter((a) => a.lastResult || a.lastError).slice(0, 4),
    [agents]
  );

  const dailyReturn = useMemo(() => {
    if (growth.changePct == null || !portfolioUsd) return "0.00";
    return `${growth.changePct >= 0 ? "+" : ""}${growth.changePct.toFixed(2)}%`;
  }, [growth.changePct, portfolioUsd]);

  const dailyReturnPositive = (growth.changePct ?? 0) >= 0;

  const activeAgentCount = agents.filter((a) => a.status === "running").length;
  const automationUptime = agents.length > 0 ? `${((activeAgentCount / agents.length) * 100).toFixed(1)}%` : "—";

  const successfulTrades = trades.filter((t) => t.status === "success").length;
  const executionSuccess = trades.length > 0 ? `${((successfulTrades / trades.length) * 100).toFixed(1)}%` : "—";

  const avgWinRate = useMemo(() => {
    if (dashboards.length === 0) return null;
    return dashboards.reduce((acc, d) => acc + d.winRate, 0) / dashboards.length;
  }, [dashboards]);
  const winRateDisplay = avgWinRate != null ? `${(avgWinRate * 100).toFixed(1)}%` : "—";

  const avgConfidence = useMemo(() => {
    const withConfidence = dashboards.filter((d) => d.currentConfidence != null);
    if (withConfidence.length === 0) return null;
    return withConfidence.reduce((acc, d) => acc + (d.currentConfidence ?? 0), 0) / withConfidence.length;
  }, [dashboards]);
  const aiAccuracy = avgConfidence != null ? `${(avgConfidence * 100).toFixed(1)}%` : "—";

  const idleUsd = portfolio?.allocation.idleUsd ?? 0;
  const riskExposure = portfolio && portfolio.allocation.totalValue > 0
    ? `${(100 - (idleUsd / portfolio.allocation.totalValue) * 100).toFixed(1)}%`
    : "—";

  const lifetimePnl = useMemo(
    () => dashboards.reduce((acc, d) => acc + parseFloat(d.lifetimePnl || "0"), 0),
    [dashboards]
  );

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

  const policies = useMemo(() => {
    if (!portfolio) return [];
    const driftUsage = Math.round(Math.abs(portfolio.allocation.xlmPct - portfolio.targets.xlmPct) * 10) / 10;
    return [
      {
        id: "xlm-target",
        name: "XLM Allocation Drift",
        usage: driftUsage,
        limit: portfolio.targets.driftThresholdPct,
        status: (driftUsage >= portfolio.targets.driftThresholdPct ? "warning" : "active") as "active" | "warning",
      },
      {
        id: "delegations",
        name: "Active Delegations",
        usage: delegationStats.activeCount,
        limit: Math.max(agents.length, delegationStats.activeCount, 1),
        status: "active" as const,
      },
      {
        id: "managed-capital",
        name: "Managed Capital",
        usage: Math.round(portfolio.managedCapital),
        limit: Math.max(Math.round(portfolio.allocation.totalValue), 1),
        status: "active" as const,
      },
    ];
  }, [portfolio, delegationStats.activeCount, agents.length]);

  const activityItems = useMemo(
    () =>
      auditEvents.map((e) => ({
        id: e.id,
        message: e.message || e.event_type.replace(/_/g, " "),
        timestamp: e.created_at,
        type: (e.event_type === "strategy_error" || e.event_type === "policy_violation" || e.event_type === "delegation_invalid"
          ? "warning"
          : e.event_type === "trade_executed" || e.event_type === "trade_closed"
            ? "success"
            : "info") as "info" | "success" | "warning",
      })),
    [auditEvents]
  );

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
          <h1 className="font-display text-lg font-medium text-text-primary">Overview</h1>
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

      {/* ── Metrics Row ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Portfolio Value"
          value={portfolioUsd ? formatCurrency(portfolioUsd) : "—"}
          change={{ value: dailyReturn, positive: dailyReturnPositive }}
          sparklineData={growth.history}
          href="/dashboard/portfolio"
        />
        <MetricCard
          title="Delegated Capital"
          value={formatCurrency(delegatedCapital)}
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>}
          href="/dashboard/delegations"
        />
        <MetricCard
          title="Available Funds"
          value={formatCurrency(availableCapital)}
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>}
        />
        <MetricCard
          title="Automation Uptime"
          value={automationUptime}
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}
        />
      </div>

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
            marketSentiment="Neutral"
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
                      health={agent.status === "running" ? 0.95 : agent.status === "error" ? 0.3 : 0.7}
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
                    actionLabel={agent.lastError ? "Review" : "Details"}
                    onAction={() => {}}
                  />
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── Policy Summary + Activity Feed ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PolicySummary policies={policies} />
        <ActivityFeed items={activityItems} />
      </div>

      {/* ── Quick Stats ── */}
      <div>
        <h3 className="font-display text-sm font-medium text-text-primary mb-3">Executive KPIs</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          <QuickStatCard label="Execution Success" value={executionSuccess} />
          <QuickStatCard label="Win Rate" value={winRateDisplay} />
          <QuickStatCard label="Avg AI Confidence" value={aiAccuracy} />
          <QuickStatCard label="Idle Capital Exposure" value={riskExposure} />
          <QuickStatCard label="Lifetime PnL" value={formatCurrency(lifetimePnl)} change={{ value: lifetimePnl >= 0 ? "+" : "-", positive: lifetimePnl >= 0 }} />
          <QuickStatCard label="Active Agents" value={`${activeAgentCount}/${agents.length}`} />
        </div>
      </div>
    </div>
  );
}
