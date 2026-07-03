"use client";

// The autonomous multi-agent operations terminal. Three role agents (Strategic / Yield /
// Portfolio Balancer) run continuously in the backend; this page is a live read-model over that
// state — provisioning, per-agent decision/PnL cards, portfolio allocation, a replayable
// decision timeline, and the live audit feed. All state is backend-sourced, so it survives
// refresh/login.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Asset } from "@stellar/stellar-sdk";
import { Card, CardHeader, CardBody } from "@/app/components/ui/Card";
import { Badge } from "@/app/components/ui/Badge";
import { Spinner } from "@/app/components/ui/Spinner";
import { useWalletContext } from "@/app/contexts/WalletContext";
import { signDelegationHashWithFreighter } from "@/app/lib/stellar";
import {
  provisionSingleRoleAgent,
  attachAgentDelegation,
  startAgentWallet,
  getAgentsSummary,
  getPortfolioOverview,
  getOwnerDecisions,
  getAuditLog,
  type AgentDashboard,
  type AgentRole,
  type AgentMode,
  type PortfolioOverview,
  type DecisionRecord,
  type AuditLogRow,
} from "@/app/lib/agentsBackend";

const ROLE_META: Record<AgentRole, { label: string; blurb: string; accent: string }> = {
  strategic: { label: "Strategic Agent", blurb: "Selects the optimal strategy for the live market regime.", accent: "text-violet-300" },
  yield: { label: "Yield Agent", blurb: "Maximises capital efficiency, reallocating idle funds.", accent: "text-emerald-300" },
  balancer: { label: "Portfolio Balancer", blurb: "Keeps allocation on target, reducing concentration risk.", accent: "text-sky-300" },
};

const ROLE_ORDER: AgentRole[] = ["strategic", "yield", "balancer"];

function num(v: string | number | null | undefined, dp = 2): string {
  const n = typeof v === "string" ? parseFloat(v) : v ?? 0;
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: dp });
}

function timeAgo(ts: number | null): string {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export default function AutonomousPage() {
  const { wallet, connected, connecting, connect, walletOwner, smartWalletAddress, ensureAgentAuth, deploying } = useWalletContext();
  const networkPassphrase = wallet?.networkPassphrase ?? "Test SDF Network ; September 2015";

  const [dashboards, setDashboards] = useState<AgentDashboard[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioOverview | null>(null);
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [audit, setAudit] = useState<AuditLogRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedDecision, setSelectedDecision] = useState<DecisionRecord | null>(null);

  // Add-agent flow: click "Add Agent" → pick which role → set its delegation → done.
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [pickedRole, setPickedRole] = useState<AgentRole | null>(null);

  const roleAgents = useMemo(
    () => dashboards.filter((d) => d.role !== null),
    [dashboards],
  );
  const availableRoles = useMemo(
    () => ROLE_ORDER.filter((r) => !roleAgents.some((a) => a.role === r)),
    [roleAgents],
  );

  const refresh = useCallback(async () => {
    if (!walletOwner) return;
    try {
      const [sum, pf, dec, aud] = await Promise.all([
        getAgentsSummary(),
        getPortfolioOverview().catch(() => null),
        getOwnerDecisions({ limit: 40 }).catch(() => []),
        getAuditLog({ limit: 40 }).catch(() => []),
      ]);
      setDashboards(sum);
      setPortfolio(pf);
      setDecisions(dec);
      setAudit(aud);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [walletOwner]);

  useEffect(() => {
    if (!walletOwner) return;
    ensureAgentAuth().then(refresh);
  }, [walletOwner, ensureAgentAuth, refresh]);

  useEffect(() => {
    if (!walletOwner) return;
    // Re-run ensureAgentAuth each poll (cheap no-op if the cached token is still valid) — a
    // 401 partway through the session clears that cache (see agentsBackend.ts), and only
    // re-auth on the next tick actually recovers instead of every poll failing forever.
    const id = setInterval(() => { ensureAgentAuth().then(refresh); }, 6000);
    return () => clearInterval(id);
  }, [walletOwner, ensureAgentAuth, refresh]);

  if (!connected) {
    return (
      <Shell>
        <Card>
          <CardBody className="text-center">
            <p className="mb-3 text-xs text-text-muted">Connect Freighter to run the autonomous agents.</p>
            <button onClick={() => connect()} disabled={connecting} className="rounded-xl bg-accent/70 px-4 py-2 text-xs font-semibold text-white hover:bg-accent disabled:opacity-50">
              {connecting ? "Connecting…" : "Connect Freighter"}
            </button>
          </CardBody>
        </Card>
      </Shell>
    );
  }

  if (!smartWalletAddress) {
    return (
      <Shell>
        <Card><CardBody className="text-center"><p className="text-xs text-text-muted">{deploying ? "Deploying your capital wallet…" : "Waiting for your capital wallet to finish deploying."}</p></CardBody></Card>
      </Shell>
    );
  }

  return (
    <Shell
      onAddAgent={availableRoles.length > 0 ? () => { setPickedRole(null); setAddAgentOpen(true); } : undefined}
    >
      {error && (
        <div className="rounded-xl border border-error/15 bg-error/6 px-4 py-3"><p className="text-xs text-error/90">{error}</p></div>
      )}

      {roleAgents.length === 0 ? (
        <Card>
          <CardBody className="space-y-3 py-8 text-center">
            <p className="text-sm text-text-secondary">Provision your autonomous trading desk.</p>
            <p className="mx-auto max-w-md text-xs text-text-muted">
              Strategic, Yield and Portfolio Balancer agents run continuously once added: reading the live
              oracle, reasoning with the LLM, validating against policy &amp; risk, executing, and logging every decision.
            </p>
            <button
              onClick={() => { setPickedRole(null); setAddAgentOpen(true); }}
              className="mx-auto rounded-xl bg-accent/80 px-5 py-2.5 text-xs font-semibold text-white hover:bg-accent"
            >
              + Add Agent
            </button>
          </CardBody>
        </Card>
      ) : (
        <>
          {portfolio && <PortfolioCard pf={portfolio} />}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {ROLE_ORDER.map((role) => {
              const d = roleAgents.find((a) => a.role === role);
              return (
                <AgentRoleCard
                  key={role}
                  role={role}
                  dash={d}
                  onAdd={!d ? () => { setPickedRole(role); setAddAgentOpen(true); } : undefined}
                />
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <DecisionTimeline decisions={decisions} onSelect={setSelectedDecision} />
            <LiveAuditFeed audit={audit} />
          </div>
        </>
      )}

      {selectedDecision && <DecisionReplayModal decision={selectedDecision} onClose={() => setSelectedDecision(null)} />}

      {addAgentOpen && (
        <AddAgentFlow
          availableRoles={availableRoles}
          initialRole={pickedRole}
          smartWalletAddress={smartWalletAddress}
          walletOwner={walletOwner!}
          networkPassphrase={networkPassphrase}
          onClose={() => setAddAgentOpen(false)}
          onDone={async () => { setAddAgentOpen(false); await refresh(); }}
        />
      )}
    </Shell>
  );
}

function Shell({ children, onAddAgent }: { children: React.ReactNode; onAddAgent?: () => void }) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-lg font-medium text-text-primary">Autonomous Desk</h1>
          <p className="mt-1 text-xs text-text-muted">Live multi-agent trading terminal — decisions, positions, PnL and full audit.</p>
        </div>
        {onAddAgent && (
          <button
            onClick={onAddAgent}
            className="rounded-xl bg-accent/80 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent"
          >
            + Add Agent
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function PortfolioCard({ pf }: { pf: PortfolioOverview }) {
  const xlmPct = Math.max(0, Math.min(100, pf.allocation.xlmPct));
  const targetXlm = pf.targets.xlmPct;
  const drift = Math.abs(pf.allocation.xlmPct - targetXlm);
  const offTarget = drift > pf.targets.driftThresholdPct;
  return (
    <Card>
      <CardHeader title="Portfolio Allocation" action={<Badge tone={offTarget ? "warning" : "success"} dot>{offTarget ? `off target ${drift.toFixed(1)}%` : "on target"}</Badge>} />
      <CardBody className="space-y-4 pt-4">
        <div>
          <div className="mb-1 flex justify-between text-[11px] text-text-muted">
            <span>XLM {xlmPct.toFixed(1)}%</span>
            <span>USDC {(100 - xlmPct).toFixed(1)}%</span>
          </div>
          <div className="relative h-3 w-full overflow-hidden rounded-full bg-sky-500/20">
            <div className="absolute inset-y-0 left-0 bg-violet-500/60" style={{ width: `${xlmPct}%` }} />
            <div className="absolute inset-y-0 w-0.5 bg-white/70" style={{ left: `${targetXlm}%` }} title={`Target ${targetXlm}%`} />
          </div>
          <p className="mt-1 text-right text-[10px] text-text-muted">▲ target XLM {targetXlm}%</p>
        </div>
        <div className="grid grid-cols-4 gap-2 text-center text-xs">
          <Stat label="Total value" value={`$${num(pf.allocation.totalValue)}`} />
          <Stat label="Idle (USDC)" value={`$${num(pf.allocation.idleUsd)}`} />
          <Stat label="XLM held" value={num(pf.allocation.xlmAmount, 4)} />
          <Stat label="Managed" value={`$${num(pf.managedCapital)}`} />
        </div>
        {pf.yieldVenues.length > 0 && (
          <div>
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-text-muted">Yield venues (live APY)</p>
            <div className="flex flex-wrap gap-2">
              {pf.yieldVenues.map((v) => (
                <span key={v.id} className="rounded-lg bg-bg-elevated px-2.5 py-1 text-[11px] text-text-secondary">
                  {v.name} <span className="font-mono text-emerald-300">{v.effectiveApyPct.toFixed(2)}%</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-bg-elevated px-2 py-1.5">
      <span className="block text-[10px] text-text-muted">{label}</span>
      <span className="font-mono text-text-secondary">{value}</span>
    </div>
  );
}

function AgentRoleCard({ role, dash, onAdd }: { role: AgentRole; dash?: AgentDashboard; onAdd?: () => void }) {
  const meta = ROLE_META[role];
  return (
    <Card>
      <CardHeader
        title={<span className={meta.accent}>{meta.label}</span>}
        action={dash ? <Badge tone={dash.agent.status === "running" ? "success" : dash.agent.status === "error" ? "error" : "warning"} dot>{dash.agent.status}</Badge> : undefined}
      />
      <CardBody className="space-y-3 pt-3">
        <p className="text-[11px] text-text-muted">{meta.blurb}</p>

        {!dash ? (
          onAdd ? (
            <button
              onClick={onAdd}
              className="w-full rounded-xl border border-dashed border-white/10 bg-white/[0.02] py-4 text-xs text-text-muted transition-colors hover:border-accent/30 hover:text-text-primary"
            >
              + Add {meta.label}
            </button>
          ) : (
            <div className="flex items-center justify-center gap-2 py-4 text-xs text-text-muted">
              <Spinner className="h-3 w-3" /> Provisioning…
            </div>
          )
        ) : (
          <>
            <div className="rounded-xl border border-accent/10 bg-accent-muted/40 px-3 py-2">
              <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-text-muted">
                {dash.agent.status === "running" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
                Current task
              </span>
              <p className="mt-1 line-clamp-2 text-xs text-text-secondary">{dash.currentTask ?? "Waiting for first tick…"}</p>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-text-muted">Decision</span>
              <span className="flex items-center gap-1.5">
                {dash.currentDecision ? <Badge tone={dash.currentDecision === "hold" ? "neutral" : "buy"}>{dash.currentDecision}</Badge> : <span className="text-text-muted">—</span>}
                {dash.currentConfidence !== null && <span className="font-mono text-[10px] text-text-muted">{(dash.currentConfidence * 100).toFixed(0)}%</span>}
              </span>
            </div>
            {dash.currentReasoning && <p className="line-clamp-2 text-[10px] italic text-text-muted">“{dash.currentReasoning}”</p>}

            <div className="grid grid-cols-2 gap-2 text-xs">
              <Stat label="Today PnL" value={num(dash.todayPnl, 4)} />
              <Stat label="Lifetime PnL" value={num(dash.lifetimePnl, 4)} />
              <Stat label="Strategy" value={dash.currentStrategy ?? "—"} />
              <Stat label="Position" value={num(dash.position?.open_amount ?? 0, 3)} />
              <Stat label="Trades" value={String(dash.tradeCount)} />
              <Stat label="Win rate" value={`${(dash.winRate * 100).toFixed(0)}%`} />
              <Stat label="Capital" value={dash.capital ? `$${num(dash.capital)}` : "—"} />
              <Stat label="Last exec" value={timeAgo(dash.lastExecution)} />
            </div>
            <div className="flex items-center justify-between border-t border-white/5 pt-1.5 text-[10px] text-text-muted">
              <span>Realized {num(dash.pnl.realizedPnl, 4)} · Unrealized {num(dash.pnl.unrealizedPnl, 4)}</span>
              <span>decided {timeAgo(dash.lastDecisionTime)}</span>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function DecisionTimeline({ decisions, onSelect }: { decisions: DecisionRecord[]; onSelect: (d: DecisionRecord) => void }) {
  return (
    <Card>
      <CardHeader title="Decision Timeline" action={<span className="text-[10px] text-text-muted">{decisions.length} recent</span>} />
      <CardBody className="pt-3">
        {decisions.length === 0 ? (
          <p className="py-6 text-center text-xs text-text-muted">No decisions yet — agents will reason on their next tick.</p>
        ) : (
          <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
            {decisions.map((d) => (
              <button key={d.id} onClick={() => onSelect(d)} className="w-full rounded-lg bg-white/[0.02] px-2.5 py-2 text-left transition-colors hover:bg-white/[0.05]">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Badge tone="neutral">{d.role}</Badge>
                    <Badge tone={d.action === "hold" ? "neutral" : "buy"}>{d.action}</Badge>
                    {d.selected_strategy && <span className="truncate font-mono text-[10px] text-text-muted">{d.selected_strategy}</span>}
                  </div>
                  <span className="shrink-0 font-mono text-[10px] text-text-muted">{(d.confidence * 100).toFixed(0)}% · {timeAgo(d.created_at)}</span>
                </div>
                <p className="mt-0.5 line-clamp-1 text-[11px] text-text-secondary">{d.reasoning}</p>
                {d.execution_result && <p className="text-[10px] text-text-muted">{d.execution_result}{d.llm_model ? " · LLM" : " · heuristic"}</p>}
              </button>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function LiveAuditFeed({ audit }: { audit: AuditLogRow[] }) {
  return (
    <Card>
      <CardHeader title="Live Activity" action={<span className="flex items-center gap-1.5 text-[10px] text-text-muted"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />streaming</span>} />
      <CardBody className="pt-3">
        {audit.length === 0 ? (
          <p className="py-6 text-center text-xs text-text-muted">No activity yet.</p>
        ) : (
          <div className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
            {audit.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.02] px-2.5 py-1 text-[11px]">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-text-muted">{e.event_type.replace(/_/g, " ")}</span>
                  <span className="truncate text-text-secondary">{e.message ?? ""}</span>
                </div>
                <span className="shrink-0 text-[10px] text-text-muted">{timeAgo(e.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function DecisionReplayModal({ decision, onClose }: { decision: DecisionRecord; onClose: () => void }) {
  const blocks: [string, string | null][] = [
    ["Reasoning", decision.reasoning],
    ["Market snapshot", decision.market_snapshot_json],
    ["Oracle", decision.oracle_json],
    ["Indicators", decision.indicators_json],
    ["Regime", decision.regime_json],
    ["LLM prompt", decision.llm_prompt_summary],
    ["LLM response", decision.llm_response_json],
    ["Policy validation", decision.policy_validation_json],
    ["Delegation validation", decision.delegation_validation_json],
    ["Risk", decision.risk_json],
    ["Position before", decision.position_before_json],
    ["Position after", decision.position_after_json],
    ["PnL before", decision.pnl_before_json],
    ["PnL after", decision.pnl_after_json],
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-bg-primary p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge tone="neutral">{decision.role}</Badge>
            <Badge tone={decision.action === "hold" ? "neutral" : "buy"}>{decision.action}</Badge>
            <span className="font-mono text-[11px] text-text-muted">{(decision.confidence * 100).toFixed(0)}% · {new Date(decision.created_at).toLocaleString()}</span>
          </div>
          <button onClick={onClose} className="text-xs text-text-muted hover:text-text-primary">✕</button>
        </div>
        <p className="mb-3 text-[10px] text-text-muted">Decision {decision.id} · {decision.execution_result ?? "—"} · model {decision.llm_model ?? "heuristic"}</p>
        <div className="space-y-2">
          {blocks.filter(([, v]) => v).map(([label, v]) => (
            <div key={label}>
              <p className="font-mono text-[10px] uppercase tracking-widest text-text-muted">{label}</p>
              <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap rounded-lg bg-bg-elevated px-2.5 py-1.5 text-[11px] text-text-secondary">{prettyMaybeJson(v as string)}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** "+ Add Agent" flow: pick which role (skipped if the caller already picked one, e.g. clicking
 *  an empty role slot directly), then a delegation form for how much capital to grant that
 *  agent's MPC wallet. Live mode actually signs + submits an on-chain spend-limit delegation
 *  from the capital wallet to the agent's own key (same mechanism as the Agents page); paper
 *  mode just records the capital figure since no funds move. */
function AddAgentFlow({
  availableRoles,
  initialRole,
  smartWalletAddress,
  walletOwner,
  networkPassphrase,
  onClose,
  onDone,
}: {
  availableRoles: AgentRole[];
  initialRole: AgentRole | null;
  smartWalletAddress: string | null;
  walletOwner: string;
  networkPassphrase: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [role, setRole] = useState<AgentRole | null>(initialRole);
  const [mode, setMode] = useState<AgentMode>("live");
  const [amount, setAmount] = useState("100");
  const [periodDays, setPeriodDays] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!role) return;
    const amt = parseFloat(amount) || 0;
    if (amt <= 0) { setError("Enter a valid amount"); return; }
    if (mode === "live" && !smartWalletAddress) { setError("Capital wallet not ready yet"); return; }
    setBusy(true);
    setError(null);
    try {
      const agent = await provisionSingleRoleAgent({ role, mode, capital: amount });

      if (mode === "live") {
        const prepareRes = await fetch("/api/delegate-sdk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "PREPARE_DELEGATION",
            delegate: agent.publicKey,
            delegator: smartWalletAddress,
            policies: [
              {
                type: "spend-limit",
                token: Asset.native().contractId(networkPassphrase),
                spendLimit: BigInt(Math.round(amt * 10_000_000)).toString(),
                period: String(Math.round((parseFloat(periodDays) || 1) * 86400)),
              },
            ],
          }),
        });
        const prepared = await prepareRes.json();
        if (!prepareRes.ok) throw new Error(prepared.error);

        const signatureHex = await signDelegationHashWithFreighter(prepared.hashHex, networkPassphrase, walletOwner);

        const submitRes = await fetch("/api/delegate-sdk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "SUBMIT_DELEGATION", unsignedDelegation: prepared.unsignedDelegation, signatureHex }),
        });
        const submitted = await submitRes.json();
        if (!submitRes.ok) throw new Error(submitted.error);

        await attachAgentDelegation(agent.id, submitted.delegation);
        await startAgentWallet(agent.id);
      }

      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-bg-primary p-5" onClick={(e) => e.stopPropagation()}>
        {!role ? (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-sm font-medium text-text-primary">Which agent?</h2>
              <button onClick={onClose} className="text-xs text-text-muted hover:text-text-primary">✕</button>
            </div>
            <div className="space-y-2">
              {availableRoles.map((r) => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className="w-full rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 text-left transition-colors hover:border-accent/30 hover:bg-white/[0.05]"
                >
                  <span className={`block text-xs font-semibold ${ROLE_META[r].accent}`}>{ROLE_META[r].label}</span>
                  <span className="mt-0.5 block text-[11px] text-text-muted">{ROLE_META[r].blurb}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-sm font-medium text-text-primary">
                Delegate to <span className={ROLE_META[role].accent}>{ROLE_META[role].label}</span>
              </h2>
              <button onClick={onClose} className="text-xs text-text-muted hover:text-text-primary">✕</button>
            </div>

            <div className="space-y-3">
              <div className="flex gap-2">
                <button
                  onClick={() => setMode("live")}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${mode === "live" ? "border-accent/40 bg-accent-muted/40 text-text-primary" : "border-white/5 bg-white/[0.02] text-text-muted"}`}
                >
                  Live — real delegation
                </button>
                <button
                  onClick={() => setMode("paper")}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${mode === "paper" ? "border-accent/40 bg-accent-muted/40 text-text-primary" : "border-white/5 bg-white/[0.02] text-text-muted"}`}
                >
                  Paper — simulated
                </button>
              </div>

              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-widest text-text-muted">
                  {mode === "live" ? "Spend limit (XLM) to this agent's MPC wallet" : "Simulated capital (USD)"}
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-text-primary focus:outline-none"
                />
              </div>

              {mode === "live" && (
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-widest text-text-muted">Renews every (days)</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={periodDays}
                    onChange={(e) => setPeriodDays(e.target.value)}
                    className="w-full rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-text-primary focus:outline-none"
                  />
                </div>
              )}

              {error && <p className="text-xs text-error/90">{error}</p>}

              <div className="flex gap-2 pt-1">
                {!initialRole && (
                  <button
                    onClick={() => setRole(null)}
                    disabled={busy}
                    className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2 text-xs text-text-secondary hover:text-text-primary disabled:opacity-50"
                  >
                    Back
                  </button>
                )}
                <button
                  onClick={handleSubmit}
                  disabled={busy}
                  className="flex-1 rounded-xl bg-accent/80 px-4 py-2 text-xs font-semibold text-white hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? "Setting up…" : mode === "live" ? "Sign & Delegate" : "Create Agent"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
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
