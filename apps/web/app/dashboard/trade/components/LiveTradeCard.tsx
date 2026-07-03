"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardHeader, CardBody } from "@/app/components/ui/Card";
import { Badge } from "@/app/components/ui/Badge";
import { Spinner } from "@/app/components/ui/Spinner";
import {
  getAgentWallet,
  getAgentTrades,
  reverseTrade,
  type AgentSummary,
  type TradeRow,
  type PnlSummary,
  type StrategyMeta,
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
  const [error, setError] = useState<string | null>(null);
  const [reversingId, setReversingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [a, t] = await Promise.all([getAgentWallet(agentId), getAgentTrades(agentId)]);
      setAgent(a);
      setTrades(t.trades);
      setPnl(t.pnl);
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
          <Badge tone={agent.status === "running" ? "success" : agent.status === "error" ? "error" : "warning"} dot>
            {agent.status}
          </Badge>
        }
      />
      <CardBody className="space-y-4 pt-4">
        {error && (
          <div className="rounded-xl border border-error/15 bg-error/6 px-3 py-2">
            <p className="text-xs text-error/90">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-bg-elevated px-2.5 py-1.5">
            <span className="block text-[10px] text-text-muted">Last tick</span>
            <span className="text-text-secondary">
              {agent.lastTickAt ? new Date(agent.lastTickAt).toLocaleTimeString() : "—"}
            </span>
          </div>
          <div className="rounded-lg bg-bg-elevated px-2.5 py-1.5">
            <span className="block text-[10px] text-text-muted">Last error</span>
            <span className="truncate text-error/80">{agent.lastError ?? "none"}</span>
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
