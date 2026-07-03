"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardHeader, CardBody } from "@/app/components/ui/Card";
import { Badge } from "@/app/components/ui/Badge";
import { Spinner } from "@/app/components/ui/Spinner";
import {
  getAgentWallet,
  getAgentTrades,
  getAgentDashboard,
  getAgentAuditLog,
  reverseTrade,
  type AgentSummary,
  type TradeRow,
  type PnlSummary,
  type StrategyMeta,
  type AgentDashboard,
  type AuditLogRow,
} from "@/app/lib/agentsBackend";

function shortHash(hash: string) {
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

function pnlTone(value: string): "success" | "error" | "neutral" {
  const n = parseFloat(value);
  if (n > 0) return "success";
  if (n < 0) return "error";
  return "neutral";
}

export function LiveTradeCard({
  agentId,
  strategies,
}: {
  agentId: string;
  strategies: StrategyMeta[];
}) {
  const [agent, setAgent] = useState<AgentSummary | null>(null);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [pnl, setPnl] = useState<PnlSummary | null>(null);
  const [dashboard, setDashboard] = useState<AgentDashboard | null>(null);
  const [activity, setActivity] = useState<AuditLogRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reversingId, setReversingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [a, t, d, events] = await Promise.all([
        getAgentWallet(agentId),
        getAgentTrades(agentId),
        getAgentDashboard(agentId).catch(() => null),
        getAgentAuditLog(agentId, { limit: 20 }).catch(() => []),
      ]);
      setAgent(a);
      setTrades(t.trades);
      setPnl(t.pnl);
      setDashboard(d);
      setActivity(events);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [agentId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll while the agent is actually running — stop otherwise, and always clear the interval
  // on unmount (mirrors the cleanup pattern in app/hooks/useSmartWallet.ts's effects).
  useEffect(() => {
    if (agent?.status !== "running") return;
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [agent?.status, refresh]);

  const handleReverse = async (tradeId: string) => {
    setReversingId(tradeId);
    setError(null);
    try {
      await reverseTrade(agentId, tradeId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReversingId(null);
    }
  };

  if (!agent) {
    return (
      <Card>
        <CardBody className="py-8 text-center">
          <Spinner className="mx-auto h-4 w-4" />
        </CardBody>
      </Card>
    );
  }

  const strategyId = agent.strategy?.type === "quant" ? agent.strategy.strategyId : null;
  const strategyMeta = strategies.find((s) => s.id === strategyId);
  const strategyName = strategyMeta?.name ?? strategyId ?? "—";
  const latestTrade = trades.length ? trades[trades.length - 1] : null;
  const reversedIds = new Set(trades.map((t) => t.reversed_trade_id).filter(Boolean) as string[]);

  return (
    <Card>
      <CardHeader
        title={strategyName}
        action={
          <div className="flex items-center gap-1.5">
            <Badge tone={agent.mode === "live" ? "error" : "neutral"}>{agent.mode}</Badge>
            <Badge tone={agent.status === "running" ? "success" : agent.status === "error" ? "error" : "warning"} dot>
              {agent.status}
            </Badge>
          </div>
        }
      />
      <CardBody className="space-y-4 pt-4">
        {error && (
          <div className="rounded-xl border border-error/15 bg-error/6 px-3 py-2">
            <p className="text-xs text-error/90">{error}</p>
          </div>
        )}

        <div className="rounded-xl border border-accent/10 bg-accent-muted/40 px-3 py-2">
          <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-text-muted">
            {agent.status === "running" && (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            )}
            Agent thinking
          </span>
          <p className="mt-1 text-xs text-text-secondary">
            {agent.lastError ?? agent.lastResult ?? "Waiting for first tick…"}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-bg-elevated px-2.5 py-1.5">
            <span className="block text-[10px] text-text-muted">Last tick</span>
            <span className="text-text-secondary">
              {agent.lastTickAt ? new Date(agent.lastTickAt).toLocaleTimeString() : "—"}
            </span>
          </div>
          <div className="rounded-lg bg-bg-elevated px-2.5 py-1.5">
            <span className="block text-[10px] text-text-muted">Status</span>
            <span className="truncate text-text-secondary">{agent.status}</span>
          </div>
        </div>

        {latestTrade && (
          <div className="rounded-xl bg-bg-elevated p-3 space-y-1.5">
            <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">Most recent trade</p>
            <div className="flex items-center justify-between">
              <Badge tone={latestTrade.side === "buy" ? "buy" : "sell"}>{latestTrade.side}</Badge>
              <span className="font-mono text-xs text-text-secondary">
                {latestTrade.amount} @ {latestTrade.price}
              </span>
            </div>
            {latestTrade.tx_hash && (
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${latestTrade.tx_hash}`}
                target="_blank"
                rel="noreferrer"
                className="block truncate text-[10px] text-accent/70 hover:text-accent"
              >
                {shortHash(latestTrade.tx_hash)}
              </a>
            )}
          </div>
        )}

        {pnl && (
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg bg-bg-elevated px-2.5 py-1.5 text-center">
              <span className="block text-[10px] text-text-muted">Realized P&L</span>
              <Badge tone={pnlTone(pnl.realizedPnl)}>{pnl.realizedPnl}</Badge>
            </div>
            <div className="rounded-lg bg-bg-elevated px-2.5 py-1.5 text-center">
              <span className="block text-[10px] text-text-muted">Unrealized P&L</span>
              <Badge tone={pnlTone(pnl.unrealizedPnl)}>{pnl.unrealizedPnl}</Badge>
            </div>
            <div className="rounded-lg bg-bg-elevated px-2.5 py-1.5 text-center">
              <span className="block text-[10px] text-text-muted">Open position</span>
              <span className="font-mono text-text-secondary">{pnl.openPosition}</span>
            </div>
          </div>
        )}

        {dashboard && (
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg bg-bg-elevated px-2.5 py-1.5 text-center">
              <span className="block text-[10px] text-text-muted">Win rate</span>
              <span className="font-mono text-text-secondary">{(dashboard.winRate * 100).toFixed(0)}%</span>
            </div>
            <div className="rounded-lg bg-bg-elevated px-2.5 py-1.5 text-center">
              <span className="block text-[10px] text-text-muted">Total return</span>
              <span className="font-mono text-text-secondary">
                {dashboard.totalReturn !== null ? `${(dashboard.totalReturn * 100).toFixed(1)}%` : "—"}
              </span>
            </div>
            <div className="rounded-lg bg-bg-elevated px-2.5 py-1.5 text-center">
              <span className="block text-[10px] text-text-muted">Running</span>
              <span className="font-mono text-text-secondary">
                {dashboard.runningTimeMs ? `${Math.floor(dashboard.runningTimeMs / 60000)}m` : "—"}
              </span>
            </div>
          </div>
        )}

        {dashboard?.position && parseFloat(dashboard.position.open_amount) > 0 && (
          <div className="rounded-xl bg-bg-elevated p-3 space-y-1">
            <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">Open position</p>
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono text-text-secondary">{dashboard.position.open_amount} @ avg {dashboard.position.avg_cost}</span>
              <span className="font-mono text-[10px] text-text-muted">{dashboard.position.pair}</span>
            </div>
          </div>
        )}

        {activity.length > 0 && (
          <div>
            <p className="mb-1.5 text-[10px] font-mono uppercase tracking-widest text-text-muted">Live activity</p>
            <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
              {activity.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.02] px-2.5 py-1 text-[11px]">
                  <span className="truncate text-text-secondary">{e.message ?? e.event_type}</span>
                  <span className="shrink-0 text-[10px] text-text-muted">{new Date(e.created_at).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="mb-1.5 text-[10px] font-mono uppercase tracking-widest text-text-muted">Audit trail</p>
          <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {trades.length === 0 && <p className="text-xs text-text-muted">No trades yet.</p>}
            {[...trades].reverse().map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.02] px-2.5 py-1.5 text-[11px]"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Badge tone={t.side === "buy" ? "buy" : "sell"}>{t.side}</Badge>
                  <span className="truncate font-mono text-text-secondary">
                    {t.amount} @ {t.price}
                  </span>
                  {t.reversed_trade_id && (
                    <span className="shrink-0 text-[10px] text-text-muted">(reversal)</span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[10px] text-text-muted">
                    {new Date(t.created_at).toLocaleTimeString()}
                  </span>
                  {!t.reversed_trade_id && !reversedIds.has(t.id) && (
                    <button
                      onClick={() => handleReverse(t.id)}
                      disabled={reversingId === t.id}
                      className="rounded-md border border-white/5 bg-white/[0.02] px-2 py-0.5 text-[10px] text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {reversingId === t.id ? "Reversing…" : "Reverse"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
