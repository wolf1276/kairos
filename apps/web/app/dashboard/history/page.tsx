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

const ROLE_LABELS: Record<string, string> = {
  strategic: "Strategic",
  yield: "Yield",
  balancer: "Balancer",
};

/** Trades/activity are keyed by an internal agent UUID — meaningless on its own. Resolves it to
 *  the agent's role name (Strategic/Yield/Balancer) so it's actually clear which agent is
 *  responsible for a given fill, instead of an opaque truncated id nobody can tell apart. */
function agentLabel(agentId: string, agents: AgentSummary[]): string {
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) return shortAddress(agentId);
  if (agent.role) return ROLE_LABELS[agent.role] ?? agent.role;
  return `Manual ${shortAddress(agent.publicKey)}`;
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

/** Sums realized PnL per agent from the trade fills already on this page — answers "which
 *  agent is actually losing money" at a glance instead of making the user eyeball a long
 *  trade-by-trade table. Only counts `realized_pnl` (set on the closing 'sell' leg of a
 *  position — see pnl.ts), so this is realized, not mark-to-market unrealized PnL. */
function PnlByAgent({ trades, agents }: { trades: TradeRow[]; agents: AgentSummary[] }) {
  const byAgent = new Map<string, { realized: number; trades: number; wins: number; losses: number }>();
  for (const t of trades) {
    if (t.realized_pnl === null) continue;
    const pnl = parseFloat(t.realized_pnl);
    const entry = byAgent.get(t.agent_id) ?? { realized: 0, trades: 0, wins: 0, losses: 0 };
    entry.realized += pnl;
    entry.trades += 1;
    if (pnl > 0) entry.wins += 1;
    else if (pnl < 0) entry.losses += 1;
    byAgent.set(t.agent_id, entry);
  }
  const rows = Array.from(byAgent.entries()).sort((a, b) => a[1].realized - b[1].realized);
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {rows.map(([agentId, s]) => (
        <div
          key={agentId}
          className="flex items-center gap-2 rounded-xl border border-white/5 bg-bg-elevated/40 px-3 py-2 text-xs"
        >
          <span className="font-medium text-text-secondary">{agentLabel(agentId, agents)}</span>
          <Pnl value={String(s.realized)} />
          <span className="text-text-muted">
            ({s.wins}W / {s.losses}L, {s.trades} closed)
          </span>
        </div>
      ))}
    </div>
  );
}

export default function HistoryPage() {
  const { connected, connecting, connect, ensureAgentAuth, walletOwner } = useWalletContext();

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [activity, setActivity] = useState<AuditLogRow[]>([]);
  const [view, setView] = useState<"activity" | "trades">("activity");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<AuditLogRow | null>(null);

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
                  <tr
                    key={e.id}
                    onClick={() => setSelectedEvent(e)}
                    className="cursor-pointer transition-colors hover:bg-white/[0.02]"
                  >
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
                      {agentLabel(e.agent_id, agents)}
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
          <PnlByAgent trades={trades} agents={agents} />

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
                      {agentLabel(t.agent_id, agents)}
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

      {selectedEvent && (
        <AuditDetailModal event={selectedEvent} agentName={agentLabel(selectedEvent.agent_id, agents)} onClose={() => setSelectedEvent(null)} />
      )}
    </div>
  );
}

function prettyMaybeJson(v: string): string {
  try {
    return JSON.stringify(JSON.parse(v), null, 2);
  } catch {
    return v;
  }
}

/** Full-detail drill-down for a single audit event — every event type (market_analysis,
 *  policy_check, delegation_check, risk_check, trade_opened/closed, etc.) carries whichever of
 *  these structured fields are relevant to it, so this renders whatever's actually present
 *  instead of assuming a fixed shape. Same depth as the Autonomous page's decision replay
 *  modal, but reachable for every event on every agent from one place. */
function AuditDetailModal({ event, agentName, onClose }: { event: AuditLogRow; agentName: string; onClose: () => void }) {
  const blocks: [string, string | null][] = [
    ["Message", event.message],
    ["Market snapshot", event.market_snapshot_json],
    ["Indicators", event.indicators_json],
    ["Signal", event.signal],
    ["Policy validation", event.policy_validation_json],
    ["Delegation validation", event.delegation_validation_json],
    ["Position after", event.position_after_json],
    ["PnL after", event.pnl_after_json],
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-bg-primary p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge tone={eventTone(event.event_type)}>{EVENT_LABELS[event.event_type] ?? event.event_type}</Badge>
            {event.mode && <Badge tone={event.mode === "live" ? "error" : "neutral"}>{event.mode}</Badge>}
            <span className="font-mono text-[11px] text-text-muted">{agentName} · {new Date(event.created_at).toLocaleString()}</span>
          </div>
          <button onClick={onClose} className="text-xs text-text-muted hover:text-text-primary">✕</button>
        </div>
        <p className="mb-3 text-[10px] text-text-muted">
          Event {event.id} · strategy {event.strategy_id ?? "—"} · pair {event.pair ?? "—"}
          {event.execution_status ? ` · ${event.execution_status}` : ""}
        </p>
        {event.tx_hash && (
          <p className="mb-3 text-[10px]">
            {event.tx_hash.startsWith("paper-") ? (
              <span className="font-mono text-text-muted">paper fill</span>
            ) : (
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${event.tx_hash}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-accent/70 hover:text-accent"
              >
                view tx: {event.tx_hash}
              </a>
            )}
          </p>
        )}
        <div className="space-y-2">
          {blocks.filter(([, v]) => v).map(([label, v]) => (
            <div key={label}>
              <p className="font-mono text-[10px] uppercase tracking-widest text-text-muted">{label}</p>
              <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap rounded-lg bg-bg-elevated px-2.5 py-1.5 text-[11px] text-text-secondary">{prettyMaybeJson(v as string)}</pre>
            </div>
          ))}
          {blocks.every(([, v]) => !v) && <p className="py-4 text-center text-xs text-text-muted">No additional detail recorded for this event.</p>}
        </div>
      </div>
    </div>
  );
}
