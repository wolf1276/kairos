"use client";

// Developer/debug view of the Context Layer — shows exactly what backend/src/agentContext
// assembles for a given agent (Market, Managed Capital, Policy, System, Historical + metadata).
// Every value here comes straight from GET /api/agents/:id/context — no mock data.

import { useCallback, useEffect, useState } from "react";
import { Card, CardHeader, CardBody } from "@/app/components/ui/Card";
import { Badge } from "@/app/components/ui/Badge";
import { Spinner } from "@/app/components/ui/Spinner";
import { useWalletContext } from "@/app/contexts/WalletContext";
import {
  getAgentsSummary,
  getAgentContext,
  type AgentSummary,
  type AgentContextSnapshot,
} from "@/app/lib/agentsBackend";

function fmt(n: number, digits = 2): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function fmtTime(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

function qualityTone(level: "high" | "medium" | "low"): "success" | "warning" | "error" {
  if (level === "high") return "success";
  if (level === "medium") return "warning";
  return "error";
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const tone = confidence >= 0.75 ? "success" : confidence >= 0.4 ? "warning" : "error";
  return <Badge tone={tone}>{Math.round(confidence * 100)}%</Badge>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-xs">
      <span className="text-text-secondary">{label}</span>
      <span className="font-mono text-text-primary">{value}</span>
    </div>
  );
}

export default function ContextLayerPage() {
  const { walletOwner, ensureAgentAuth } = useWalletContext();

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [context, setContext] = useState<AgentContextSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    if (!walletOwner) return;
    try {
      const dashboards = await getAgentsSummary();
      const list = dashboards.map((d) => d.agent);
      setAgents(list);
      setSelectedId((prev) => prev ?? list[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [walletOwner]);

  useEffect(() => {
    if (!walletOwner) return;
    ensureAgentAuth().then(loadAgents);
  }, [walletOwner, ensureAgentAuth, loadAgents]);

  const loadContext = useCallback(
    async (refresh = false) => {
      if (!selectedId) return;
      setLoading(true);
      setError(null);
      try {
        const ctx = await getAgentContext(selectedId, { refresh });
        setContext(ctx);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setContext(null);
      } finally {
        setLoading(false);
      }
    },
    [selectedId]
  );

  useEffect(() => {
    loadContext();
  }, [loadContext]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-lg font-medium text-text-primary">Context Layer</h1>
          <p className="text-xs text-text-secondary">Exactly what the AI Operating System sees for one agent, right now.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="rounded-lg border border-white/5 bg-bg-elevated px-2.5 py-1.5 font-mono text-xs text-text-primary"
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.role ?? "manual"} · {a.id.slice(0, 8)}
              </option>
            ))}
          </select>
          <button
            className="rounded-lg border border-white/5 bg-bg-elevated px-3 py-1.5 text-xs text-text-primary hover:bg-bg-elevated/70"
            onClick={() => loadContext(true)}
            disabled={loading}
          >
            {loading ? <Spinner className="h-3 w-3" /> : "Rebuild"}
          </button>
        </div>
      </div>

      {error && (
        <Card className="border-error/20">
          <CardBody>
            <p className="text-xs text-error">{error}</p>
          </CardBody>
        </Card>
      )}

      {!context && !error && (
        <Card>
          <CardBody>
            <p className="text-xs text-text-secondary">{loading ? "Building context…" : "No agent selected."}</p>
          </CardBody>
        </Card>
      )}

      {context && (
        <>
          <Card>
            <CardHeader
              title="Snapshot Metadata"
              action={
                <div className="flex items-center gap-2">
                  <Badge tone={qualityTone(context.quality.level)}>
                    quality: {context.quality.level} ({Math.round(context.quality.score * 100)}%)
                  </Badge>
                  <Badge tone={context.status === "valid" ? "success" : "error"} dot>
                    {context.status}
                  </Badge>
                </div>
              }
            />
            <CardBody className="grid grid-cols-2 gap-x-8 gap-y-1 md:grid-cols-4">
              <Row label="Version" value={context.meta.version} />
              <Row label="Generated" value={fmtTime(context.meta.timestamp)} />
              <Row label="Snapshot ID" value={context.meta.snapshotId.slice(0, 8)} />
              <Row label="Context Hash" value={context.meta.contextHash.slice(0, 12)} />
              <Row label="Market ID" value={context.meta.marketId} />
              <Row label="Agent" value={`${context.role ?? "manual"} · ${context.agentId.slice(0, 8)}`} />
            </CardBody>
            {context.validation.errors.length > 0 && (
              <CardBody className="border-t border-white/5 pt-4">
                <p className="mb-1 text-[10px] uppercase tracking-wider text-error/80">Validation errors</p>
                <ul className="list-inside list-disc text-xs text-error/90">
                  {context.validation.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </CardBody>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Market Context" action={<ConfidenceBadge confidence={context.market.confidence} />} />
              <CardBody>
                <Row label="Pair" value={context.market.pair} />
                <Row label="Price" value={fmt(context.market.price, 5)} />
                <Row label="Oracle age" value={`${context.market.oracle.ageSeconds}s`} />
                <Row label="Regime" value={context.market.regime.label} />
                <Row label="Breakout" value={context.market.regime.breakout ? "yes" : "no"} />
                <Row label="RSI" value={fmt(context.market.momentum.rsi, 1)} />
                <Row label="MACD hist" value={fmt(context.market.momentum.macdHistogram, 5)} />
                <Row label="EMA20 / EMA50" value={`${fmt(context.market.trend.ema20, 4)} / ${fmt(context.market.trend.ema50, 4)}`} />
                <Row label="Volatility" value={`${fmt(context.market.volatility.volatilityPct, 2)}% (${context.market.volatility.band})`} />
                <Row label="Volume (window)" value={fmt(context.market.volume.window24h, 0)} />
                <Row label="Liquidity" value={fmt(context.market.liquidity.recentVolume, 0)} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Managed Capital" action={<ConfidenceBadge confidence={context.capital.confidence} />} />
              <CardBody>
                <Row label="Total managed" value={`$${fmt(context.capital.totalManagedCapital)}`} />
                <Row label="Idle capital" value={`$${fmt(context.capital.idleCapital)}`} />
                <Row label="Deployable" value={`$${fmt(context.capital.deployableCapital)}`} />
                <Row label="Allocation" value={`XLM ${fmt(context.capital.allocation.xlmPct, 1)}% / USDC ${fmt(context.capital.allocation.usdcPct, 1)}%`} />
                <Row label="Realized PnL" value={fmt(context.capital.realizedPnl)} />
                <Row label="Unrealized PnL" value={fmt(context.capital.unrealizedPnl)} />
                <Row label="Protocol exposure" value={context.capital.protocolExposure.length} />
                <Row label="Pending executions" value={context.capital.pendingExecutions.length} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Policy Context" action={<ConfidenceBadge confidence={context.policy.confidence} />} />
              <CardBody>
                <Row label="Objective" value={context.policy.objective} />
                <Row label="Risk profile" value={context.policy.riskProfile} />
                <Row label="Allowed assets" value={context.policy.allowedAssets.join(", ") || "—"} />
                <Row label="Allowed protocols" value={context.policy.allowedProtocols.join(", ") || "none"} />
                <Row label="Delegation" value={context.policy.delegationActive ? "active" : "inactive"} />
                <Row label="Spend limit / trade" value={context.policy.spendingLimitPerTrade ?? "—"} />
                <Row label="Min confidence" value={context.policy.minConfidence ?? "—"} />
                <Row label="Max capital" value={context.policy.positionLimit.maxCapital ?? "—"} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="System Context" action={<ConfidenceBadge confidence={context.system.confidence} />} />
              <CardBody>
                <Row label="Oracle" value={<Badge tone={context.system.oracleHealthy ? "success" : "error"}>{context.system.oracleHealthy ? "healthy" : "unhealthy"}</Badge>} />
                <Row label="Scheduler" value={context.system.schedulerRunning ? "running" : "stopped"} />
                <Row label="Price feed" value={context.system.priceFeedRunning ? "running" : "stopped"} />
                <Row label="Protocol execution" value={context.system.protocolExecutionAvailable ? "enabled" : "disabled"} />
                <Row label="Execution available" value={context.system.executionAvailable ? "yes" : "no"} />
              </CardBody>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader title="Historical Context" action={<ConfidenceBadge confidence={context.historical.confidence} />} />
              <CardBody className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
                <div>
                  <Row label="Last execution" value={context.historical.lastExecution ? `${context.historical.lastExecution.side} ${context.historical.lastExecution.pair} (${context.historical.lastExecution.status})` : "none"} />
                  <Row label="Last decision" value={context.historical.lastDecision ? `${context.historical.lastDecision.action} (${fmt(context.historical.lastDecision.confidence, 2)})` : "none"} />
                  <Row label="Recent failures" value={context.historical.recentFailureCount} />
                </div>
                <div>
                  <Row label="Cooldown" value={context.historical.cooldown.active ? `${context.historical.cooldown.remainingSeconds}s remaining` : "none"} />
                  <Row label="Recent trades" value={context.historical.recentExecutionSummary.tradeCount} />
                  <Row label="Recent success/fail" value={`${context.historical.recentExecutionSummary.successCount}/${context.historical.recentExecutionSummary.failureCount}`} />
                </div>
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
