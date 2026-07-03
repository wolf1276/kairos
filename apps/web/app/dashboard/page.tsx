"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWalletContext } from "@/app/contexts/WalletContext";
import { useStellarBalances } from "@/app/hooks/useStellarBalances";
import { useDelegations } from "@/app/dashboard/delegations/hooks/useDelegations";
import { Badge } from "@/app/components/ui/Badge";
import { Card, CardHeader, CardBody } from "@/app/components/ui/Card";
import {
  listAgentWallets,
  getAgentTrades,
  type AgentSummary,
  type TradeRow,
} from "@/app/lib/agentsBackend";
import { delegateXLM, withdrawFromSmartWallet } from "@/app/lib/stellar";

function shortAddress(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function statusTone(status: AgentSummary["status"]): "success" | "error" | "warning" | "neutral" {
  if (status === "running") return "success";
  if (status === "error") return "error";
  if (status === "stopped") return "neutral";
  return "warning";
}

function strategyLabel(agent: AgentSummary): string {
  if (!agent.strategy) return "Unconfigured";
  if (agent.strategy.type === "dca") return "Strategy — DCA";
  return `Intent — ${agent.strategy.strategyId}`;
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
    smartWalletBalance,
    deploying,
    deployError,
    deploySmartWallet,
    checkBalance,
  } = useWalletContext();
  const networkPassphrase = wallet?.networkPassphrase ?? "Test SDF Network ; September 2015";

  const {
    xlmBalance,
    usdcBalance,
    allBalances,
    loading: balancesLoading,
    refresh: refreshBalances,
  } = useStellarBalances(smartWalletAddress, wallet?.networkPassphrase ?? null);

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
      await Promise.all([refreshBalances(), checkBalance(smartWalletAddress)]);
      closeTransfer();
    } catch (e) {
      setTransferError(e instanceof Error ? e.message : String(e));
    } finally {
      setTransferBusy(false);
    }
  };
  const { stats: delegationStats, delegations, loading: delegationsLoading } = useDelegations(
    walletOwner,
    smartWalletAddress,
    networkPassphrase
  );

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [tradesLoading, setTradesLoading] = useState(false);

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

  const totalRealizedPnl = trades.reduce((acc, t) => acc + (t.realized_pnl ? parseFloat(t.realized_pnl) : 0), 0);
  const insights = agents.filter((a) => a.lastResult || a.lastError).slice(0, 4);

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
        <Card className="max-w-sm p-8 text-center">
          <h2 className="font-display text-base font-medium text-text-primary">Connect your wallet</h2>
          <p className="mt-2 text-xs text-text-muted">
            Connect Freighter to view your portfolio, delegations, and agents.
          </p>
          <button
            onClick={connect}
            disabled={connecting}
            className="mt-5 w-full rounded-xl bg-accent/80 px-4 py-2.5 text-xs font-semibold text-white transition-all duration-300 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            {connecting ? "Connecting…" : "Connect Freighter"}
          </button>
        </Card>
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
          <button
            onClick={() => (smartWalletAddress ? setTransferMode("deposit") : undefined)}
            disabled={!smartWalletAddress}
            title={!smartWalletAddress ? "Deploy a capital wallet first" : undefined}
            className={`rounded-xl px-4 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              transferMode === "deposit"
                ? "bg-accent text-white"
                : "border border-white/5 bg-white/[0.02] text-text-secondary hover:text-text-primary"
            }`}
          >
            Deposit
          </button>
          <button
            onClick={() => (smartWalletAddress ? setTransferMode("withdraw") : undefined)}
            disabled={!smartWalletAddress}
            title={!smartWalletAddress ? "Deploy a capital wallet first" : undefined}
            className={`rounded-xl px-4 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              transferMode === "withdraw"
                ? "bg-accent text-white"
                : "border border-white/5 bg-white/[0.02] text-text-secondary hover:text-text-primary"
            }`}
          >
            Withdraw
          </button>
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

      {/* ── Capital (smart) wallet detection ── */}
      {!smartWalletAddress ? (
        <Card className="p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
                Capital Wallet
              </p>
              <p className="mt-1 text-xs text-text-muted">
                No capital wallet found for this account. Deploy one to enable delegations and agent trading.
              </p>
              {deployError && <p className="mt-1.5 text-xs text-error/90">{deployError}</p>}
            </div>
            <button
              onClick={deploySmartWallet}
              disabled={deploying}
              className="shrink-0 rounded-xl bg-accent/80 px-4 py-2.5 text-xs font-semibold text-white transition-all duration-300 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {deploying ? "Deploying…" : "Create Capital Wallet"}
            </button>
          </div>
        </Card>
      ) : (
        <Card className="p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
                Capital Wallet
              </p>
              <p className="mt-1 font-mono text-xs text-text-secondary">{shortAddress(smartWalletAddress)}</p>
            </div>
            <p className="font-display text-2xl font-bold tracking-tight text-text-primary tabular-nums">
              {smartWalletBalance != null ? parseFloat(smartWalletBalance).toFixed(2) : "—"}{" "}
              <span className="text-sm font-medium text-text-muted">XLM</span>
            </p>
          </div>
        </Card>
      )}

      {/* ── Deposit / Withdraw panel ── */}
      {transferMode && smartWalletAddress && (
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
              {transferMode === "deposit" ? "Transfer to Capital Wallet" : "Withdraw to Freighter Wallet"}
            </p>
            <button onClick={closeTransfer} className="text-text-muted hover:text-text-primary">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <p className="mt-2 text-xs text-text-muted">
            {transferMode === "deposit"
              ? `From ${wallet ? shortAddress(wallet.address) : "your wallet"} to ${shortAddress(smartWalletAddress)}`
              : `From ${shortAddress(smartWalletAddress)} to ${wallet ? shortAddress(wallet.address) : "your wallet"}`}
          </p>
          <div className="mt-1 flex items-center justify-between text-[11px] text-text-muted">
            <span>Available</span>
            <button
              onClick={() =>
                setTransferAmount(
                  (transferMode === "deposit" ? parseFloat(wallet?.balance ?? "0") : xlmBalance).toString()
                )
              }
              className="font-mono text-text-secondary hover:text-accent"
            >
              {transferMode === "deposit"
                ? `${parseFloat(wallet?.balance ?? "0").toFixed(2)} XLM`
                : `${xlmBalance.toFixed(2)} XLM`}
            </button>
          </div>
          {transferError && <p className="mt-2 text-xs text-error/90">{transferError}</p>}
          <div className="mt-3 flex gap-2">
            <input
              value={transferAmount}
              onChange={(e) => setTransferAmount(e.target.value)}
              type="number"
              min="0"
              step="0.01"
              placeholder="Amount (XLM)"
              className="w-full rounded-lg border border-white/5 bg-bg-elevated px-3 py-2 font-mono text-xs text-text-primary transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            />
            <button
              onClick={submitTransfer}
              disabled={transferBusy}
              className="shrink-0 rounded-lg bg-accent/80 px-4 py-2 text-xs font-semibold text-white transition-all duration-300 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {transferBusy ? "Signing…" : transferMode === "deposit" ? "Deposit" : "Withdraw"}
            </button>
          </div>
        </Card>
      )}

      {/* ── Portfolio Summary + Delegation ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
            Portfolio Summary
          </p>
          {balancesLoading && !smartWalletAddress ? (
            <div className="mt-2 h-10 w-40 animate-pulse rounded-md bg-bg-elevated/60" />
          ) : (
            <p className="mt-1.5 font-display text-4xl font-bold tracking-tight text-text-primary tabular-nums">
              {(xlmBalance + usdcBalance).toFixed(2)}{" "}
              <span className="text-lg font-medium text-text-muted">USD est.</span>
            </p>
          )}
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-white/[0.02] p-3">
              <p className="text-[10px] uppercase tracking-widest text-text-muted">XLM</p>
              <p className="mt-1 font-mono text-sm text-text-primary tabular-nums">{xlmBalance.toFixed(2)}</p>
            </div>
            <div className="rounded-xl bg-white/[0.02] p-3">
              <p className="text-[10px] uppercase tracking-widest text-text-muted">USDC</p>
              <p className="mt-1 font-mono text-sm text-text-primary tabular-nums">{usdcBalance.toFixed(2)}</p>
            </div>
            <div className="rounded-xl bg-white/[0.02] p-3">
              <p className="text-[10px] uppercase tracking-widest text-text-muted">Realized PnL</p>
              <p
                className={`mt-1 font-mono text-sm tabular-nums ${
                  totalRealizedPnl > 0 ? "text-success" : totalRealizedPnl < 0 ? "text-error" : "text-text-primary"
                }`}
              >
                {totalRealizedPnl >= 0 ? "+" : ""}
                {totalRealizedPnl.toFixed(2)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-text-muted">
            Delegation
          </p>
          {delegationsLoading ? (
            <div className="mt-2 h-8 w-20 animate-pulse rounded-md bg-bg-elevated/60" />
          ) : (
            <p className="mt-1.5 font-display text-3xl font-bold tracking-tight text-text-primary tabular-nums">
              {delegationStats.activeCount}
              <span className="text-lg font-medium text-text-muted"> active</span>
            </p>
          )}
          <div className="mt-3 space-y-1.5 text-xs text-text-muted">
            <div className="flex justify-between">
              <span>Policies attached</span>
              <span className="text-text-secondary">{delegationStats.policiesAttached}</span>
            </div>
            <div className="flex justify-between">
              <span>Revoked</span>
              <span className="text-text-secondary">{delegationStats.revokedCount}</span>
            </div>
          </div>
          <Link
            href="/dashboard/delegations"
            className="mt-4 block rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-center text-xs text-text-secondary transition-colors hover:text-text-primary"
          >
            Manage
          </Link>
        </Card>
      </div>

      {/* ── Agent Cards ── */}
      <div>
        <h2 className="mb-3 font-display text-sm font-medium text-text-primary">Agents</h2>
        {agentsLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-32 animate-pulse rounded-2xl bg-bg-elevated/60" />
            ))}
          </div>
        ) : agents.length === 0 ? (
          <Card>
            <CardBody className="py-8 text-center">
              <p className="text-xs text-text-muted">
                No agents yet — launch one from the{" "}
                <Link href="/dashboard/trade" className="text-accent/80 hover:text-accent">
                  Trade page
                </Link>
                .
              </p>
            </CardBody>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {agents.slice(0, 3).map((agent) => (
              <Card key={agent.id} className="p-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-text-secondary">{shortAddress(agent.publicKey)}</span>
                  <Badge tone={statusTone(agent.status)} dot>
                    {agent.status}
                  </Badge>
                </div>
                <p className="mt-3 text-xs font-medium text-text-primary">{strategyLabel(agent)}</p>
                <p className="mt-1 text-[11px] text-text-muted">
                  {agent.lastTickAt ? `Last tick ${new Date(agent.lastTickAt).toLocaleTimeString()}` : "Never ticked"}
                </p>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* ── Active Positions ── */}
      <div>
        <h2 className="mb-3 font-display text-sm font-medium text-text-primary">Active Positions</h2>
        <Card>
          {balancesLoading ? (
            <CardBody className="py-8 text-center">
              <span className="h-4 w-4 mx-auto inline-block animate-spin rounded-full border-2 border-accent border-t-transparent" />
            </CardBody>
          ) : allBalances.length === 0 ? (
            <CardBody className="py-8 text-center">
              <p className="text-xs text-text-muted">No positions in your capital wallet yet.</p>
            </CardBody>
          ) : (
            <div className="divide-y divide-white/5">
              {allBalances.map((b, i) => (
                <div key={i} className="flex items-center justify-between px-6 py-3">
                  <span className="text-xs font-medium text-text-primary">{b.code}</span>
                  <span className="font-mono text-xs text-text-secondary tabular-nums">
                    {parseFloat(b.balance).toFixed(4)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── AI Insights + Recent Activity ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="AI Insights" />
          <CardBody className="space-y-2.5 pt-3">
            {insights.length === 0 ? (
              <p className="text-xs text-text-muted">No agent activity to analyze yet.</p>
            ) : (
              insights.map((agent) => (
                <div key={agent.id} className="rounded-xl bg-white/[0.02] px-3.5 py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] text-text-secondary">{shortAddress(agent.publicKey)}</span>
                    <span className="text-[10px] text-text-muted">
                      {agent.lastTickAt && new Date(agent.lastTickAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className={`mt-1 truncate text-xs ${agent.lastError ? "text-error/85" : "text-success/85"}`}>
                    {agent.lastError || agent.lastResult}
                  </p>
                </div>
              ))
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recent Activity" />
          <CardBody className="space-y-2 pt-3">
            {tradesLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-10 animate-pulse rounded-lg bg-bg-elevated/60" />
                ))}
              </div>
            ) : trades.length === 0 ? (
              <p className="text-xs text-text-muted">No trades yet.</p>
            ) : (
              trades.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Badge tone={t.side === "buy" ? "buy" : "sell"}>{t.side}</Badge>
                    <span className="text-xs text-text-secondary">{t.pair}</span>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-xs text-text-primary tabular-nums">{t.amount}</p>
                    <p className="text-[10px] text-text-muted">{new Date(t.created_at).toLocaleTimeString()}</p>
                  </div>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>

    </div>
  );
}
