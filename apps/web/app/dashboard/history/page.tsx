"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWalletContext } from "@/app/contexts/WalletContext";
import { Card, CardBody } from "@/app/components/ui/Card";
import { Badge } from "@/app/components/ui/Badge";
import { Spinner } from "@/app/components/ui/Spinner";
import {
  listAgentWallets,
  getAgentTrades,
  getAuditLog,
  type TradeRow,
  type AgentSummary,
  type AuditLogRow,
} from "@/app/lib/agentsBackend";

function shortAddress(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function Pnl({ value }: { value: string | null }) {
  if (!value) return <span className="text-text-muted">—</span>;
  const n = parseFloat(value);
  return (
    <span className={n > 0 ? "text-success" : n < 0 ? "text-error" : "text-text-secondary"}>
      {n >= 0 ? "+" : ""}{n.toFixed(2)}
    </span>
  );
}

const EVENT_LABELS: Record<string, string> = {
  strategy_started: "Strategy started",
  strategy_stopped: "Strategy stopped",
  strategy_error: "Error",
  signal_generated: "Signal generated",
  policy_violation: "Policy violation",
  delegation_invalid: "Delegation invalid",
  trade_executed: "Trade executed",
  position_updated: "Position updated",
};

function eventTone(type: string): "success" | "error" | "warning" | "neutral" {
  if (type === "strategy_error" || type === "policy_violation" || type === "delegation_invalid") return "error";
  if (type === "trade_executed" || type === "strategy_started") return "success";
  if (type === "signal_generated" || type === "position_updated") return "warning";
  return "neutral";
}

export default function HistoryPage() {
  const { connected, connecting, connect, ensureAgentAuth, walletOwner } = useWalletContext();

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [activity, setActivity] = useState<AuditLogRow[]>([]);
  const [view, setView] = useState<"activity" | "trades">("activity");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (showSpinner = false) => {
    if (!walletOwner) return;
    if (showSpinner) setLoading(true);
    setError(null);
    try {
      const a = await listAgentWallets(walletOwner);
      setAgents(a);
      if (a.length === 0) {
        setTrades([]);
      } else {
        const results = await Promise.all(a.map((ag) => getAgentTrades(ag.id).catch(() => ({ trades: [], pnl: null }))));
        const all = results.flatMap((r) => r.trades);
        all.sort((x, y) => y.created_at - x.created_at);
        setTrades(all);
      }
      setActivity(await getAuditLog({ limit: 200 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  useEffect(() => {
    if (!walletOwner) return;
    // Wallet may be connected (silent auto-restore) with no agent-backend session yet — that
    // restore deliberately skips the sign popup, so authenticate here the first time this page
    // actually needs a token.
    ensureAgentAuth().then(() => refresh(true));
    // Full activity/trade history is backend-persisted — poll so this page stays live while open.
    // Re-run ensureAgentAuth each poll (cheap no-op if the cached token is still valid) — a 401
    // partway through the session clears that cache (see agentsBackend.ts), and only re-auth on
    // the next tick actually recovers instead of every poll failing forever.
    const id = setInterval(() => { ensureAgentAuth().then(() => refresh(false)); }, 8000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletOwner, ensureAgentAuth]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-lg font-medium text-text-primary">History</h1>
          <p className="mt-1 text-sm text-text-muted">
            Full activity trail and trade fills, persisted server-side across every agent.
          </p>
        </div>
        {connected && (
          <div className="flex gap-1 rounded-xl border border-white/5 bg-bg-elevated/50 p-1">
            <button
              onClick={() => setView("activity")}
              className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                view === "activity" ? "bg-accent/15 text-text-primary" : "text-text-muted hover:text-text-secondary"
              }`}
            >
              Activity ({activity.length})
            </button>
            <button
              onClick={() => setView("trades")}
              className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                view === "trades" ? "bg-accent/15 text-text-primary" : "text-text-muted hover:text-text-secondary"
              }`}
            >
              Trades ({trades.length})
            </button>
          </div>
        )}
      </div>

      {!connected ? (
        <Card>
          <CardBody className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-text-secondary">Connect Freighter to view your trade history.</p>
            <button
              onClick={() => connect()}
              disabled={connecting}
              className="mt-4 rounded-xl bg-accent/70 px-5 py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {connecting ? "Connecting…" : "Connect Freighter"}
            </button>
          </CardBody>
        </Card>
      ) : loading ? (
        <Card>
          <CardBody className="flex justify-center py-16">
            <Spinner className="h-5 w-5" />
          </CardBody>
        </Card>
      ) : error ? (
        <Card>
          <CardBody className="py-16 text-center">
            <p className="text-sm text-error/90">{error}</p>
          </CardBody>
        </Card>
      ) : view === "activity" && activity.length === 0 ? (
        <Card>
          <CardBody className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-bg-elevated/50">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <h2 className="font-display text-base font-medium text-text-primary">No activity yet</h2>
            <p className="mt-2 max-w-sm text-sm text-text-muted">
              Launch a strategy and every lifecycle event — signals, executions, errors — will
              appear here.
            </p>
            <Link
              href="/dashboard/trade"
              className="mt-6 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
            >
              Start Trading
            </Link>
          </CardBody>
        </Card>
      ) : view === "trades" && trades.length === 0 ? (
        <Card>
          <CardBody className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-bg-elevated/50">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <h2 className="font-display text-base font-medium text-text-primary">No history yet</h2>
            <p className="mt-2 max-w-sm text-sm text-text-muted">
              Execute your first trade on Stellar testnet and it will appear here.
            </p>
            <Link
              href="/dashboard/trade"
              className="mt-6 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
            >
              Start Trading
            </Link>
          </CardBody>
        </Card>
      ) : view === "activity" ? (
        <>
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span>{activity.length} event{activity.length !== 1 ? "s" : ""}</span>
            <span className="text-border">·</span>
            <span>{agents.length} agent{agents.length !== 1 ? "s" : ""}</span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/5">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-white/5 bg-bg-elevated/30">
                  <th className="px-4 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-widest text-text-muted">Time</th>
                  <th className="px-4 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-widest text-text-muted">Event</th>
                  <th className="px-4 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-widest text-text-muted">Strategy</th>
                  <th className="px-4 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-widest text-text-muted">Pair</th>
                  <th className="px-4 py-3 text-center font-mono text-[10px] font-medium uppercase tracking-widest text-text-muted">Mode</th>
                  <th className="px-4 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-widest text-text-muted">Agent</th>
                  <th className="px-4 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-widest text-text-muted">Details</th>
                  <th className="px-4 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-widest text-text-muted">TX</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {activity.map((e) => (
                  <tr key={e.id} className="transition-colors hover:bg-white/[0.02]">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-text-secondary">
                      {new Date(e.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={eventTone(e.event_type)}>{EVENT_LABELS[e.event_type] ?? e.event_type}</Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-text-secondary">{e.strategy_id ?? "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-text-secondary">{e.pair ?? "—"}</td>
                    <td className="px-4 py-3 text-center">
                      {e.mode ? <Badge tone={e.mode === "live" ? "error" : "neutral"}>{e.mode}</Badge> : <span className="text-text-muted">—</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                      {shortAddress(e.agent_id)}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-xs text-text-secondary">{e.message ?? "—"}</td>
                    <td className="px-4 py-3">
                      {e.tx_hash ? (
                        e.tx_hash.startsWith("paper-") ? (
                          <span className="font-mono text-[10px] text-text-muted">paper</span>
                        ) : (
                          <a
                            href={`https://stellar.expert/explorer/testnet/tx/${e.tx_hash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-[10px] text-accent/70 hover:text-accent"
                          >
                            {e.tx_hash.slice(0, 8)}…
                          </a>
                        )
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span>{trades.length} trade{trades.length !== 1 ? "s" : ""}</span>
            <span className="text-border">·</span>
            <span>{agents.length} agent{agents.length !== 1 ? "s" : ""}</span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/5">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-white/5 bg-bg-elevated/30">
                  <th className="px-4 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-widest text-text-muted">Time</th>
                  <th className="px-4 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-widest text-text-muted">Side</th>
                  <th className="px-4 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-widest text-text-muted">Pair</th>
                  <th className="px-4 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-widest text-text-muted">Amount</th>
                  <th className="px-4 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-widest text-text-muted">Price</th>
                  <th className="px-4 py-3 text-center font-mono text-[10px] font-medium uppercase tracking-widest text-text-muted">Status</th>
                  <th className="px-4 py-3 text-center font-mono text-[10px] font-medium uppercase tracking-widest text-text-muted">Mode</th>
                  <th className="px-4 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-widest text-text-muted">P&L</th>
                  <th className="px-4 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-widest text-text-muted">Agent</th>
                  <th className="px-4 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-widest text-text-muted">TX</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {trades.map((t) => (
                  <tr key={t.id} className="transition-colors hover:bg-white/[0.02]">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-text-secondary">
                      {new Date(t.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={t.side === "buy" ? "buy" : "sell"}>{t.side}</Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-text-secondary">{t.pair}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-text-primary">{t.amount}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-text-primary">{t.price}</td>
                    <td className="px-4 py-3 text-center">
                      <Badge tone={t.status === "success" ? "success" : "error"}>{t.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge tone={t.mode === "live" ? "error" : "neutral"}>{t.mode}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                      <Pnl value={t.realized_pnl} />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                      {shortAddress(t.agent_id)}
                    </td>
                    <td className="px-4 py-3">
                      {t.tx_hash ? (
                        <a
                          href={`https://stellar.expert/explorer/testnet/tx/${t.tx_hash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-[10px] text-accent/70 hover:text-accent"
                        >
                          {t.tx_hash.slice(0, 8)}…
                        </a>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
