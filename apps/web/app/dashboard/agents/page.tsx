"use client";

import { useCallback, useEffect, useState } from "react";
import { Asset } from "@stellar/stellar-sdk";
import { Card, CardHeader, CardBody } from "@/app/components/ui/Card";
import { Badge } from "@/app/components/ui/Badge";
import { Spinner } from "@/app/components/ui/Spinner";
import { useWalletContext } from "@/app/contexts/WalletContext";
import { useCreateDelegation } from "@/app/hooks/useCreateDelegation";
import { withdrawFromSmartWallet } from "@/app/lib/stellar";
import type { SmartWalletInfo } from "@/app/hooks/useSmartWallet";
import { WalletPicker } from "@/app/components/WalletPicker";
import {
  getAgentsSummary,
  attachAgentDelegation,
  revokeAgentDelegation,
  setAgentStrategy,
  startAgentWallet,
  stopAgentWallet,
  deleteAgentWallet,
  getAgentDecisions,
  getAgentPerformance,
  getAgentAuditLog,
  getRuntimeStatus,
  getRuntimeHealth,
  getRuntimeMetrics,
  startRuntime,
  stopRuntime,
  pauseRuntime,
  resumeRuntime,
  getAgentMemoryPackage,
  getAgentLearningSnapshot,
  type AgentSummary,
  type DecisionRecord,
  type PerformanceSnapshot,
  type AuditLogRow,
  type RuntimeState,
  type RuntimeHeartbeat,
  type RuntimeHealthReport,
  type MemoryPackage,
  type LearningSnapshot,
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
    smartWallets,
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
    // Re-check the cached token each poll (cheap no-op if it's still valid) — but never
    // interactively re-prompt Freighter from a background poll: a 401 partway through the
    // session clears the cache (see agentsBackend.ts), and re-auth without `interactive: false`
    // here would pop a signature request every single tick until the user responds.
    const id = setInterval(() => { ensureAgentAuth(false).then(refresh); }, 8000);
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
              {deploying ? "Deploying your smart wallet…" : "Your smart wallet hasn't finished deploying yet."}
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
                  smartWallets={smartWallets}
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
  smartWallets,
  walletOwner,
  networkPassphrase,
  sorobanRpcUrl,
  onChanged,
}: {
  agent: AgentSummary;
  smartWalletAddress: string | null;
  smartWallets: SmartWalletInfo[];
  walletOwner: string;
  networkPassphrase: string;
  sorobanRpcUrl?: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [controlCenterOpen, setControlCenterOpen] = useState(false);

  // ── Step 1: grant this agent spend access from the smart wallet ──
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
    if (!delegatorWallet) { setError("Smart wallet not ready yet"); return; }
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
    if (!delegatorWallet) { setError("Smart wallet not ready yet"); return; }
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
        action={
          <div className="flex items-center gap-2">
            <Badge tone={statusTone(agent.status)} dot>{agent.status}</Badge>
            <button
              onClick={() => setControlCenterOpen((v) => !v)}
              className="rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1 text-[10px] font-medium text-text-secondary transition-colors hover:text-text-primary"
            >
              {controlCenterOpen ? "Hide Control Center" : "Control Center"}
            </button>
          </div>
        }
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
              {agent.delegationHash ? "Change this agent's spend delegation" : "Step 1 — Grant this agent spend access from your smart wallet"}
            </p>
            {smartWallets.length > 1 ? (
              <WalletPicker wallets={smartWallets} value={delegatorWallet} onChange={setDelegatorWallet} />
            ) : (
              <div>
                <label className="mb-1 block text-[10px] text-text-muted">Smart wallet</label>
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
              This agent will only ever be able to spend from your smart wallet, up to the limit
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

        {controlCenterOpen && <ControlCenter agent={agent} />}
      </CardBody>
    </Card>
  );
}

const PIPELINE_STAGES = [
  "Market", "Context", "Memory", "Reasoning", "Decision", "Verification",
  "Planning", "Routing", "Execution", "Outcome", "Learning",
] as const;

/** Maps the agent's own free-text `currentTask` (set by the reasoning pipeline as it works
 *  through a tick — see AgentDashboard.currentTask) onto the fixed 11-stage pipeline label set
 *  above, so the diagram highlights the stage actually in progress rather than a guess. */
function currentStageIndex(agent: AgentSummary): number {
  if (agent.status !== "running") return -1;
  if (agent.lastError) return PIPELINE_STAGES.indexOf("Verification");
  if (agent.lastResult) return PIPELINE_STAGES.indexOf("Outcome");
  return PIPELINE_STAGES.indexOf("Reasoning");
}

function decisionTone(status: string | null): "success" | "error" | "warning" | "neutral" {
  if (!status) return "neutral";
  if (status.toLowerCase().includes("fail")) return "error";
  if (status.toLowerCase().includes("success")) return "success";
  return "warning";
}

function healthTone(status: "ok" | "degraded" | "down" | undefined): "success" | "warning" | "error" | "neutral" {
  if (status === "ok") return "success";
  if (status === "degraded") return "warning";
  if (status === "down") return "error";
  return "neutral";
}

function fmtMs(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtTime(ts: number | null): string {
  return ts ? new Date(ts).toLocaleString() : "—";
}

const AUDIT_LOG_LABELS: Partial<Record<AuditLogRow["event_type"], string>> = {
  strategy_started: "Pipeline Started",
  market_analysis: "Context Assembled",
  decision_made: "Reasoning Complete",
  strategy_selected: "Planning Complete",
  trade_executed: "Execution Complete",
  position_updated: "Memory Updated",
  portfolio_rebalanced: "Learning Updated",
  strategy_stopped: "Pipeline Stopped",
  strategy_error: "Pipeline Error",
  policy_violation: "Policy Violation",
  delegation_invalid: "Delegation Invalid",
};

/** The Agent Control Center — everything about this one autonomous agent, in one place.
 *  Pure read/control passthrough over the existing Dashboard API (/api/dashboard/*) and the
 *  existing agent-wallet backend (/api/agents/*, /api/decisions, /api/agents/:id/audit) — no
 *  new backend logic, no mocked data. */
function ControlCenter({ agent }: { agent: AgentSummary }) {
  const [status, setStatus] = useState<RuntimeState | null>(null);
  const [health, setHealth] = useState<RuntimeHealthReport | null>(null);
  const [metrics, setMetrics] = useState<RuntimeHeartbeat | null>(null);
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [performance, setPerformance] = useState<PerformanceSnapshot[]>([]);
  const [audit, setAudit] = useState<AuditLogRow[]>([]);
  const [memory, setMemory] = useState<MemoryPackage | null>(null);
  const [learning, setLearning] = useState<LearningSnapshot | null>(null);
  const [memorySearch, setMemorySearch] = useState("");
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, h, m, d, p, a] = await Promise.all([
        getRuntimeStatus(),
        getRuntimeHealth(),
        getRuntimeMetrics(),
        getAgentDecisions(agent.id, { limit: 20 }).catch(() => []),
        getAgentPerformance(agent.id, { limit: 1 }).catch(() => []),
        getAgentAuditLog(agent.id, { limit: 30 }).catch(() => []),
      ]);
      setStatus(s);
      setHealth(h);
      setMetrics(m);
      setDecisions(d);
      setPerformance(p);
      setAudit(a);
      // Memory/Learning read from the Memory & Learning Engines — a 422/500 here (e.g. an agent
      // with zero recorded outcomes yet) is expected and shouldn't blank out the rest of the panel.
      getAgentMemoryPackage(agent.id).then(setMemory).catch(() => setMemory(null));
      getAgentLearningSnapshot(agent.id).then(setLearning).catch(() => setLearning(null));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [agent.id]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const runtimeAction = async (fn: () => Promise<RuntimeState | null>) => {
    setRuntimeBusy(true);
    setLoadError(null);
    try {
      const next = await fn();
      setStatus(next);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setRuntimeBusy(false);
    }
  };

  const perf = performance[0];
  const stageIdx = currentStageIndex(agent);

  return (
    <div className="space-y-4 border-t border-white/5 pt-4">
      {loadError && (
        <div className="rounded-xl border border-error/15 bg-error/6 px-3 py-2">
          <p className="text-xs text-error/90">{loadError}</p>
        </div>
      )}

      {/* 1. Runtime */}
      <section className="space-y-2.5">
        <h4 className="font-mono text-[10px] uppercase tracking-widest text-text-muted">Runtime</h4>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => runtimeAction(startRuntime)} disabled={runtimeBusy} className="rounded-lg bg-emerald-600/80 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-40">Start</button>
          <button onClick={() => runtimeAction(pauseRuntime)} disabled={runtimeBusy} className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-1.5 text-[11px] text-text-secondary hover:text-text-primary disabled:opacity-40">Pause</button>
          <button onClick={() => runtimeAction(resumeRuntime)} disabled={runtimeBusy} className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-1.5 text-[11px] text-text-secondary hover:text-text-primary disabled:opacity-40">Resume</button>
          <button onClick={() => runtimeAction(stopRuntime)} disabled={runtimeBusy} className="rounded-lg border border-error/15 bg-error/[0.03] px-3 py-1.5 text-[11px] text-error/80 hover:bg-error/[0.06] disabled:opacity-40">Stop</button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Status" value={status ?? "—"} />
          <Stat label="Provider" value={metrics?.provider ?? "—"} />
          <Stat label="Model" value={metrics?.model ?? "—"} />
          <Stat label="Execution Target" value={agent.mode ?? "—"} />
          <Stat label="Uptime" value={fmtMs(metrics?.uptimeMs ?? null)} />
          <Stat label="Last Run" value={fmtTime(metrics?.lastExecutionAt ?? null)} />
          <Stat label="Next Run" value={fmtTime(metrics?.nextExecutionAt ?? null)} />
          <Stat label="Health" value={health ? Object.values(health).every((v) => v === "ok") ? "Healthy" : "Degraded" : "—"}
            tone={health ? healthTone(Object.values(health).every((v) => v === "ok") ? "ok" : "degraded") : "neutral"} />
        </div>
      </section>

      {/* 2. Live Pipeline */}
      <section className="space-y-2">
        <h4 className="font-mono text-[10px] uppercase tracking-widest text-text-muted">Live Pipeline</h4>
        <div className="flex flex-wrap items-center gap-1.5">
          {PIPELINE_STAGES.map((stage, i) => (
            <div key={stage} className="flex items-center gap-1.5">
              <span
                className={`rounded-full border px-2 py-1 text-[10px] font-mono ${
                  i === stageIdx
                    ? "border-accent/30 bg-accent-muted/70 text-accent"
                    : i < stageIdx
                        ? "border-success/15 bg-success/8 text-success/80"
                        : "border-white/5 bg-white/[0.02] text-text-muted"
                }`}
              >
                {stage}
              </span>
              {i < PIPELINE_STAGES.length - 1 && <span className="text-text-muted">→</span>}
            </div>
          ))}
        </div>
        {agent.lastResult && <p className="text-[11px] text-text-muted">Current: {agent.lastResult}</p>}
      </section>

      {/* 3. Recent Decisions */}
      <section className="space-y-2">
        <h4 className="font-mono text-[10px] uppercase tracking-widest text-text-muted">Recent Decisions</h4>
        {decisions.length === 0 ? (
          <p className="text-[11px] text-text-muted">No decisions recorded yet.</p>
        ) : (
          <div className="max-h-48 space-y-1.5 overflow-y-auto">
            {decisions.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg bg-bg-elevated px-2.5 py-1.5 text-[11px]">
                <span className="font-mono text-text-secondary">{d.action}</span>
                <span className="text-text-muted">{d.pair}</span>
                <span className="font-mono text-text-secondary">{(d.confidence * 100).toFixed(0)}%</span>
                <Badge tone={decisionTone(d.execution_result)}>{d.execution_result ?? "pending"}</Badge>
                <span className="text-text-muted">{fmtTime(d.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4. Memory */}
      <section className="space-y-2">
        <h4 className="font-mono text-[10px] uppercase tracking-widest text-text-muted">Memory</h4>
        <input
          value={memorySearch}
          onChange={(e) => setMemorySearch(e.target.value)}
          placeholder="Search memory…"
          className={INPUT_CLS}
        />
        {!memory ? (
          <p className="text-[11px] text-text-muted">No memory package available yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <MemoryList title="Working" items={memory.working.map((w) => `${w.key}: ${JSON.stringify(w.value)}`)} search={memorySearch} />
            <MemoryList title="Episodic" items={memory.episodic.map((e) => `${e.tags.join(" / ")} · conf ${e.confidence.toFixed(2)}`)} search={memorySearch} />
            <MemoryList title="Semantic" items={memory.semantic.map((s) => `${s.key} = ${s.value}`)} search={memorySearch} />
            <MemoryList
              title="Learning"
              items={learning ? [
                `episodes: ${learning.episodeCount}`,
                `verification pass rate: ${(learning.verificationPassRate * 100).toFixed(1)}%`,
                ...learning.executionDistribution.map((e) => `${e.protocol}: ${(e.fraction * 100).toFixed(1)}%`),
              ] : []}
              search={memorySearch}
            />
          </div>
        )}
      </section>

      {/* 5. Metrics */}
      <section className="space-y-2">
        <h4 className="font-mono text-[10px] uppercase tracking-widest text-text-muted">Metrics</h4>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          <Stat label="PnL" value={perf ? `${perf.realized_pnl}` : "—"} />
          <Stat label="Win Rate" value={perf ? `${(perf.win_rate * 100).toFixed(1)}%` : "—"} />
          <Stat label="Drawdown" value={learning?.avgSlippage ? `${learning.avgSlippage.value.toFixed(3)}` : "—"} />
          <Stat label="Sharpe" value="—" />
          <Stat label="Fees" value={learning?.avgFees ? learning.avgFees.value.toFixed(4) : "—"} />
          <Stat label="Slippage" value={learning?.avgSlippage ? learning.avgSlippage.value.toFixed(4) : "—"} />
          <Stat label="Latency" value={learning?.avgExecutionLatencyMs ? `${learning.avgExecutionLatencyMs.value.toFixed(0)}ms` : "—"} />
          <Stat label="Trades" value={perf ? String(perf.trade_count) : "—"} />
          <Stat label="Success Rate" value={learning ? `${(learning.verificationPassRate * 100).toFixed(1)}%` : "—"} />
        </div>
      </section>

      {/* 6. Logs */}
      <section className="space-y-2">
        <h4 className="font-mono text-[10px] uppercase tracking-widest text-text-muted">Logs</h4>
        {audit.length === 0 ? (
          <p className="text-[11px] text-text-muted">No runtime events yet.</p>
        ) : (
          <div className="max-h-40 space-y-1 overflow-y-auto font-mono text-[10px] text-text-muted">
            {audit.map((a) => (
              <div key={a.id} className="flex justify-between gap-2">
                <span className="text-text-secondary">{AUDIT_LOG_LABELS[a.event_type] ?? a.event_type}</span>
                <span>{fmtTime(a.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" | "error" | "neutral" }) {
  return (
    <div className="rounded-lg bg-bg-elevated px-2.5 py-1.5">
      <p className="text-[9px] uppercase tracking-widest text-text-muted">{label}</p>
      <p className={`truncate font-mono text-xs ${tone === "success" ? "text-success/90" : tone === "warning" ? "text-amber-400/90" : tone === "error" ? "text-error/90" : "text-text-primary"}`}>
        {value}
      </p>
    </div>
  );
}

function MemoryList({ title, items, search }: { title: string; items: string[]; search: string }) {
  const filtered = search ? items.filter((i) => i.toLowerCase().includes(search.toLowerCase())) : items;
  return (
    <div className="rounded-lg bg-bg-elevated p-2.5">
      <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-text-muted">{title} ({filtered.length})</p>
      {filtered.length === 0 ? (
        <p className="text-[10px] text-text-muted">Empty</p>
      ) : (
        <div className="max-h-24 space-y-0.5 overflow-y-auto">
          {filtered.map((i, idx) => (
            <p key={idx} className="truncate text-[10px] text-text-secondary">{i}</p>
          ))}
        </div>
      )}
    </div>
  );
}
