"use client";

import { useCallback, useEffect, useState } from "react";
import { Asset } from "@stellar/stellar-sdk";
import { Card, CardHeader, CardBody } from "@/app/components/ui/Card";
import { Badge } from "@/app/components/ui/Badge";
import { Spinner } from "@/app/components/ui/Spinner";
import { useWalletContext } from "@/app/contexts/WalletContext";
import { useCreateDelegation } from "@/app/hooks/useCreateDelegation";
import { withdrawFromSmartWallet } from "@/app/lib/stellar";
import type { CapitalWalletInfo } from "@/app/hooks/useSmartWallet";
import { WalletPicker } from "@/app/components/WalletPicker";
import {
  getAgentsSummary,
  attachAgentDelegation,
  revokeAgentDelegation,
  setAgentStrategy,
  startAgentWallet,
  stopAgentWallet,
  deleteAgentWallet,
  type AgentSummary,
} from "@/app/lib/agentsBackend";

const INPUT_CLS =
  "w-full rounded-lg border border-white/5 bg-bg-elevated px-2.5 py-1.5 font-mono text-xs text-text-primary transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30";

function shortKey(key: string) {
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

function statusTone(status: AgentSummary["status"]): "success" | "error" | "warning" {
  if (status === "running") return "success";
  if (status === "error") return "error";
  return "warning";
}

export default function AgentsPage() {
  const {
    wallet,
    connected,
    connecting,
    connect,
    ensureAgentAuth,
    walletOwner,
    smartWalletAddress,
    capitalWallets,
    deploying,
    deployError,
  } = useWalletContext();
  const networkPassphrase = wallet?.networkPassphrase ?? "Test SDF Network ; September 2015";

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!walletOwner) return;
    setLoadingAgents(true);
    setListError(null);
    try {
      const dashboards = await getAgentsSummary();
      setAgents(dashboards.map((d) => d.agent));
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingAgents(false);
    }
  }, [walletOwner]);

  // Wallet may be connected (from a silent auto-restore) with no agent-backend session yet —
  // the silent restore deliberately skips Freighter's sign popup, so authenticate here instead,
  // the first time this page actually needs it.
  useEffect(() => {
    if (!walletOwner) return;
    ensureAgentAuth().then(refresh);
  }, [walletOwner, ensureAgentAuth, refresh]);

  // Poll the agent list itself (not just individual cards) so agents started/stopped
  // elsewhere still show up here without a manual refresh.
  useEffect(() => {
    if (!walletOwner) return;
    // Re-run ensureAgentAuth each poll (cheap no-op if the cached token is still valid) — a
    // 401 partway through the session clears that cache (see agentsBackend.ts), and only
    // re-auth on the next tick actually recovers instead of every poll failing forever.
    const id = setInterval(() => { ensureAgentAuth().then(refresh); }, 8000);
    return () => clearInterval(id);
  }, [walletOwner, ensureAgentAuth, refresh]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-lg font-medium text-text-primary">Agents</h1>
        <p className="mt-1 text-xs text-text-muted">
          Live status, strategy, last tick, and PnL for every agent you&apos;ve launched. To launch a
          new one, pick a strategy on the <a href="/dashboard/trade" className="text-accent/80 hover:text-accent">Trade page</a>.
        </p>
      </div>

      {!connected ? (
        <Card>
          <CardBody className="text-center">
            <p className="mb-3 text-xs text-text-muted">Connect Freighter to view your agents.</p>
            <button
              onClick={() => connect()}
              disabled={connecting}
              className="rounded-xl bg-accent/70 px-4 py-2 text-xs font-semibold text-white transition-all duration-300 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {connecting ? "Connecting…" : "Connect Freighter"}
            </button>
          </CardBody>
        </Card>
      ) : !smartWalletAddress ? (
        <Card>
          <CardBody className="text-center">
            <p className="text-xs text-text-muted">
              {deploying ? "Deploying your capital wallet…" : "Your capital wallet hasn't finished deploying yet."}
            </p>
            {deployError && <p className="mt-2 text-xs text-error/90">{deployError}</p>}
          </CardBody>
        </Card>
      ) : (
        <>
          {listError && (
            <div className="rounded-xl border border-error/15 bg-error/6 px-4 py-3">
              <p className="text-xs text-error/90">{listError}</p>
            </div>
          )}

          {loadingAgents && agents.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-2xl bg-bg-elevated/60" />
              ))}
            </div>
          ) : agents.length === 0 ? (
            <Card>
              <CardBody className="py-10 text-center">
                <p className="text-sm text-text-muted">
                  No agents yet — launch a strategy from the <a href="/dashboard/trade" className="text-accent/80 hover:text-accent">Trade page</a> to get started.
                </p>
              </CardBody>
            </Card>
          ) : (
            <div className="space-y-4">
              {agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  smartWalletAddress={smartWalletAddress}
                  capitalWallets={capitalWallets}
                  walletOwner={walletOwner!}
                  networkPassphrase={networkPassphrase}
                  sorobanRpcUrl={wallet?.sorobanRpcUrl}
                  onChanged={refresh}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AgentCard({
  agent,
  smartWalletAddress,
  capitalWallets,
  walletOwner,
  networkPassphrase,
  sorobanRpcUrl,
  onChanged,
}: {
  agent: AgentSummary;
  smartWalletAddress: string | null;
  capitalWallets: CapitalWalletInfo[];
  walletOwner: string;
  networkPassphrase: string;
  sorobanRpcUrl?: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ── Step 1: grant this agent spend access from the capital wallet ──
  const [spendLimit, setSpendLimit] = useState("100");
  const [periodDays, setPeriodDays] = useState("1");
  const [delegatorWallet, setDelegatorWallet] = useState<string | null>(smartWalletAddress);
  useEffect(() => { setDelegatorWallet(smartWalletAddress); }, [smartWalletAddress]);
  // Reveals the delegation form for an agent that already has a strategy configured — lets the
  // user attach a delegation post-hoc (e.g. a paper-mode role agent going live) or replace an
  // existing one with new caps, instead of only being able to set a delegation once up front.
  const [editingDelegation, setEditingDelegation] = useState(false);
  const { createDelegation } = useCreateDelegation(networkPassphrase, walletOwner);

  const handleCreateDelegation = async () => {
    const amt = parseFloat(spendLimit) || 0;
    if (amt <= 0) { setError("Enter a valid spend limit"); return; }
    if (!delegatorWallet) { setError("Capital wallet not ready yet"); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await createDelegation(agent.publicKey, delegatorWallet, [
        {
          type: "spend-limit",
          token: Asset.native().contractId(networkPassphrase),
          spendLimit: (BigInt(Math.round(amt * 10_000_000))).toString(),
          period: String(Math.round((parseFloat(periodDays) || 1) * 86400)),
        },
      ]);
      if (!result) throw new Error("Failed to create delegation");

      await attachAgentDelegation(agent.id, result.delegation, Boolean(agent.delegationHash));
      setEditingDelegation(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeDelegation = async () => {
    setBusy(true);
    setError(null);
    try {
      await revokeAgentDelegation(agent.id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // ── Fund non-DCA agents directly — quant/limit/role strategies trade from their own Turnkey
  // account (tick.ts) and never redeem a delegation, so a plain transfer is what actually gets
  // them capital; delegation stays reserved for the DCA redemption path above. ──
  const [fundAmount, setFundAmount] = useState("100");
  const [funding, setFunding] = useState(false);

  const handleFundAgent = async () => {
    const amt = parseFloat(fundAmount) || 0;
    if (amt <= 0) { setError("Enter a valid amount"); return; }
    if (!delegatorWallet) { setError("Capital wallet not ready yet"); return; }
    setFunding(true);
    setError(null);
    try {
      await withdrawFromSmartWallet(delegatorWallet, fundAmount, networkPassphrase, sorobanRpcUrl, agent.publicKey);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFunding(false);
    }
  };

  // ── Step 2: configure the DCA strategy — destination is always the delegator wallet itself ──
  const [amountPerTick, setAmountPerTick] = useState("1");
  const [intervalMinutes, setIntervalMinutes] = useState("60");

  const handleSetStrategy = async () => {
    const amt = parseFloat(amountPerTick) || 0;
    if (amt <= 0) { setError("Enter a valid per-tick amount"); return; }
    setBusy(true);
    setError(null);
    try {
      await setAgentStrategy(agent.id, {
        type: "dca",
        token: Asset.native().contractId(networkPassphrase),
        amountPerTick: (BigInt(Math.round(amt * 10_000_000))).toString(),
        intervalSeconds: Math.max(60, Math.round((parseFloat(intervalMinutes) || 60) * 60)),
      });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // ── Lifecycle ──
  const handleStart = async () => {
    setBusy(true);
    setError(null);
    try {
      await startAgentWallet(agent.id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    setError(null);
    try {
      await stopAgentWallet(agent.id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteAgentWallet(agent.id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copyPubkey = async () => {
    await navigator.clipboard.writeText(agent.publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader
        title={
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs">{shortKey(agent.publicKey)}</span>
            <button onClick={copyPubkey} className="text-[10px] text-accent/70 hover:text-accent">
              {copied ? "Copied!" : "Copy key"}
            </button>
          </div>
        }
        action={<Badge tone={statusTone(agent.status)} dot>{agent.status}</Badge>}
      />
      <CardBody className="space-y-4 pt-4">
        {error && (
          <div className="rounded-xl border border-error/15 bg-error/6 px-3 py-2">
            <p className="text-xs text-error/90">{error}</p>
          </div>
        )}

        {(!agent.delegationHash && !agent.strategy) || editingDelegation ? (
          <div className="space-y-2.5 rounded-xl bg-bg-elevated p-3.5">
            <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">
              {agent.delegationHash ? "Change this agent's spend delegation" : "Step 1 — Grant this agent spend access from your capital wallet"}
            </p>
            {capitalWallets.length > 1 ? (
              <WalletPicker wallets={capitalWallets} value={delegatorWallet} onChange={setDelegatorWallet} />
            ) : (
              <div>
                <label className="mb-1 block text-[10px] text-text-muted">Capital wallet</label>
                <input
                  value={delegatorWallet ? shortKey(delegatorWallet) : "—"}
                  disabled
                  className={INPUT_CLS}
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[10px] text-text-muted">Spend limit (XLM)</label>
                <input value={spendLimit} onChange={(e) => setSpendLimit(e.target.value)} className={INPUT_CLS} type="number" min="0" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] text-text-muted">Period (days)</label>
                <input value={periodDays} onChange={(e) => setPeriodDays(e.target.value)} className={INPUT_CLS} type="number" min="0.1" step="0.1" />
              </div>
            </div>
            <p className="text-[10px] text-text-muted">
              This agent will only ever be able to spend from your capital wallet, up to the limit
              you set — and anything it spends stays within that same wallet.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleCreateDelegation}
                disabled={busy}
                className="flex-1 rounded-xl bg-accent/70 px-4 py-2 text-xs font-semibold text-white transition-all duration-300 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Signing delegation…" : agent.delegationHash ? "Sign & Replace Delegation" : "Create Delegation for Agent"}
              </button>
              {agent.delegationHash && (
                <button
                  onClick={() => setEditingDelegation(false)}
                  disabled={busy}
                  className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        ) : !agent.strategy ? (
          <div className="space-y-2.5 rounded-xl bg-bg-elevated p-3.5">
            <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">
              Step 2 — Configure its DCA strategy
            </p>
            <div className="flex items-center justify-between rounded-lg bg-white/[0.02] px-2.5 py-1.5">
              <span className="text-[10px] text-text-muted">Using wallet</span>
              <span className="font-mono text-xs text-text-secondary">{agent.delegator ? shortKey(agent.delegator) : "—"}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[10px] text-text-muted">Amount per tick (XLM)</label>
                <input value={amountPerTick} onChange={(e) => setAmountPerTick(e.target.value)} className={INPUT_CLS} type="number" min="0" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] text-text-muted">Every (minutes)</label>
                <input value={intervalMinutes} onChange={(e) => setIntervalMinutes(e.target.value)} className={INPUT_CLS} type="number" min="1" />
              </div>
            </div>
            <p className="text-[10px] text-text-muted">
              Profits/spend always return to <span className="font-mono">{agent.delegator ? shortKey(agent.delegator) : "the same wallet"}</span> —
              this agent can never route funds to an external address.
            </p>
            <button
              onClick={handleSetStrategy}
              disabled={busy}
              className="w-full rounded-xl bg-accent/70 px-4 py-2 text-xs font-semibold text-white transition-all duration-300 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save Strategy"}
            </button>
          </div>
        ) : (
          <div className="space-y-2.5 rounded-xl bg-bg-elevated p-3.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-text-muted">Strategy</span>
              <span className="font-mono text-xs text-text-secondary">
                {agent.strategy.type === "dca"
                  ? `DCA — ${Number(agent.strategy.amountPerTick) / 1e7} XLM every ${agent.strategy.intervalSeconds / 60}m`
                  : agent.strategy.type === "limit"
                      ? `Order — ${agent.strategy.side} ${agent.strategy.quantity} ${agent.strategy.asset} @ ${agent.strategy.triggerComparator === "lte" ? "<=" : ">="} ${agent.strategy.triggerPrice}`
                      : agent.strategy.type === "role"
                          ? `Role — ${agent.strategy.role}`
                          : `Quant (${agent.strategy.strategyId}) every ${agent.strategy.intervalSeconds / 60}m`}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-text-muted">Wallet (profits return here)</span>
              <span className="font-mono text-xs text-text-secondary">{shortKey(agent.strategy.destination)}</span>
            </div>
            {agent.strategy.type === "dca" ? (
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-widest text-text-muted">Delegation</span>
                <div className="flex items-center gap-2">
                  <span className={`font-mono text-xs ${agent.delegationHash ? "text-success/80" : "text-text-muted"}`}>
                    {agent.delegationHash ? "Active" : "None (paper only)"}
                  </span>
                  <button
                    onClick={() => setEditingDelegation(true)}
                    disabled={busy || agent.status === "running"}
                    title={agent.status === "running" ? "Stop the agent first" : undefined}
                    className="text-[10px] text-accent/70 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {agent.delegationHash ? "Change" : "Attach"}
                  </button>
                  {agent.delegationHash && (
                    <button
                      onClick={handleRevokeDelegation}
                      disabled={busy || agent.status === "running"}
                      title={agent.status === "running" ? "Stop the agent first" : undefined}
                      className="text-[10px] text-error/70 hover:text-error disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            ) : (
              // quant/limit/role agents trade from their own Turnkey account directly — no
              // delegation to redeem, so topping them up is a plain funding transfer instead.
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-widest text-text-muted">Fund (XLM)</span>
                <input
                  value={fundAmount}
                  onChange={(e) => setFundAmount(e.target.value)}
                  type="number"
                  min="0"
                  className={`${INPUT_CLS} flex-1`}
                />
                <button
                  onClick={handleFundAgent}
                  disabled={funding}
                  className="whitespace-nowrap rounded-lg bg-accent/70 px-3 py-1.5 text-[10px] font-semibold text-white transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {funding ? "Sending…" : "Send"}
                </button>
              </div>
            )}
            {agent.lastTickAt && (
              <div className="border-t border-white/5 pt-2 text-[11px] text-text-muted">
                Last tick: {new Date(agent.lastTickAt).toLocaleString()}
                {agent.lastResult && <p className="mt-0.5 truncate text-success/80">{agent.lastResult}</p>}
                {agent.lastError && <p className="mt-0.5 truncate text-error/80">{agent.lastError}</p>}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              {agent.status === "running" ? (
                <button
                  onClick={handleStop}
                  disabled={busy}
                  className="flex-1 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? <Spinner className="mx-auto h-3 w-3" /> : "Stop"}
                </button>
              ) : (
                <button
                  onClick={handleStart}
                  disabled={busy}
                  className="flex-1 rounded-xl bg-emerald-600/80 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? <Spinner className="mx-auto h-3 w-3" /> : "Start"}
                </button>
              )}
            </div>
          </div>
        )}

        {agent.status !== "running" && (
          <button
            onClick={handleDelete}
            disabled={busy}
            className="w-full rounded-xl border border-error/15 bg-error/[0.03] px-3 py-2 text-xs text-error/80 transition-colors hover:bg-error/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Delete Agent Wallet
          </button>
        )}
      </CardBody>
    </Card>
  );
}
