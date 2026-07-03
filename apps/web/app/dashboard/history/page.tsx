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
  type TradeRow,
  type AgentSummary,
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

export default function HistoryPage() {
  const { wallet, connected, connecting, connect, walletOwner } = useWalletContext();

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!walletOwner) return;
    setLoading(true);
    setError(null);
    listAgentWallets(walletOwner)
      .then((a) => {
        setAgents(a);
        if (a.length === 0) {
          setTrades([]);
          setLoading(false);
          return;
        }
        return Promise.all(a.map((ag) => getAgentTrades(ag.id).catch(() => ({ trades: [], pnl: null }))))
          .then((results) => {
            const all = results.flatMap((r) => r.trades);
            all.sort((a, b) => b.created_at - a.created_at);
            setTrades(all);
          });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [walletOwner]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-lg font-medium text-text-primary">Trade History</h1>
        <p className="mt-1 text-sm text-text-muted">
          On-chain trade history from Stellar testnet executions.
        </p>
      </div>

      {!connected ? (
        <Card>
          <CardBody className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-text-secondary">Connect Freighter to view your trade history.</p>
            <button
              onClick={connect}
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
      ) : trades.length === 0 ? (
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
