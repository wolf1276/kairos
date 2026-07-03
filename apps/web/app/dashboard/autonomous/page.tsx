"use client";

// The autonomous multi-agent operations terminal. Three role agents (Strategic / Yield /
// Portfolio Balancer) run continuously in the backend; this page is a live read-model over that
// state — provisioning, per-agent decision/PnL cards, portfolio allocation, a replayable
// decision timeline, and the live audit feed. All state is backend-sourced, so it survives
// refresh/login.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardBody } from "@/app/components/ui/Card";
import { Badge } from "@/app/components/ui/Badge";
import { Spinner } from "@/app/components/ui/Spinner";
import { useWalletContext } from "@/app/contexts/WalletContext";
import {
  provisionRoleAgents,
  getAgentsSummary,
  getPortfolioOverview,
  getOwnerDecisions,
  getAuditLog,
  type AgentDashboard,
  type AgentRole,
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
  const { connected, connecting, connect, walletOwner, smartWalletAddress, ensureAgentAuth, deploying } = useWalletContext();

  const [dashboards, setDashboards] = useState<AgentDashboard[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioOverview | null>(null);
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [audit, setAudit] = useState<AuditLogRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [selectedDecision, setSelectedDecision] = useState<DecisionRecord | null>(null);

  const roleAgents = useMemo(
    () => dashboards.filter((d) => d.role !== null),
    [dashboards],
  );
  const provisioned = roleAgents.length >= 3;

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
    const id = setInterval(refresh, 6000);
    return () => clearInterval(id);
  }, [walletOwner, refresh]);

  const handleProvision = async () => {
    setProvisioning(true);
    setError(null);
    try {
      await provisionRoleAgents({ mode: "paper", capital: "1000" });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProvisioning(false);
    }
  };

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
    <Shell>
      {error && (
        <div className="rounded-xl border border-error/15 bg-error/6 px-4 py-3"><p className="text-xs text-error/90">{error}</p></div>
      )}

      {!provisioned ? (
        <Card>
          <CardBody className="space-y-3 py-8 text-center">
            <p className="text-sm text-text-secondary">Provision your autonomous trading desk.</p>
            <p className="mx-auto max-w-md text-xs text-text-muted">
              Three agents — Strategic, Yield and Portfolio Balancer — will run continuously in paper mode:
              reading the live oracle, reasoning with the LLM, validating against policy &amp; risk, executing, and logging every decision.
            </p>
            <button onClick={handleProvision} disabled={provisioning} className="mx-auto rounded-xl bg-accent/80 px-5 py-2.5 text-xs font-semibold text-white hover:bg-accent disabled:opacity-50">
              {provisioning ? "Provisioning…" : "Provision 3 Agents"}
            </button>
          </CardBody>
        </Card>
      ) : (
        <>
          {portfolio && <PortfolioCard pf={portfolio} />}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {ROLE_ORDER.map((role) => {
              const d = roleAgents.find((a) => a.role === role);
              return <AgentRoleCard key={role} role={role} dash={d} />;
            })}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <DecisionTimeline decisions={decisions} onSelect={setSelectedDecision} />
            <LiveAuditFeed audit={audit} />
          </div>
        </>
      )}

      {selectedDecision && <DecisionReplayModal decision={selectedDecision} onClose={() => setSelectedDecision(null)} />}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-lg font-medium text-text-primary">Autonomous Desk</h1>
          <p className="mt-1 text-xs text-text-muted">Live multi-agent trading terminal — decisions, positions, PnL and full audit.</p>
        </div>
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

function AgentRoleCard({ role, dash }: { role: AgentRole; dash?: AgentDashboard }) {
  const meta = ROLE_META[role];
  return (
    <Card>
      <CardHeader
        title={<span className={meta.accent}>{meta.label}</span>}
        action={dash ? <Badge tone={dash.agent.status === "running" ? "success" : dash.agent.status === "error" ? "error" : "warning"} dot>{dash.agent.status}</Badge> : <Spinner className="h-3 w-3" />}
      />
      <CardBody className="space-y-3 pt-3">
        <p className="text-[11px] text-text-muted">{meta.blurb}</p>

        {!dash ? (
          <p className="text-xs text-text-muted">Provisioning…</p>
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

function prettyMaybeJson(v: string): string {
  try {
    return JSON.stringify(JSON.parse(v), null, 2);
  } catch {
    return v;
  }
}
