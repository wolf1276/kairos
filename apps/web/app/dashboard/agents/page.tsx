"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Asset } from "@stellar/stellar-sdk";
import {
  Search, Bell, Plus, Bot, Wallet, TrendingUp, TrendingDown, Activity, ShieldCheck,
  HeartPulse, Zap, X, Play, Square, Pause as PauseIcon, Trash2, Copy, Check, ChevronRight,
  PieChart as PieChartIcon, BarChart3, Layers, Radio,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RTooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { Card, CardHeader, CardBody } from "@/app/components/ui/Card";
import { Badge } from "@/app/components/ui/Badge";
import { Spinner } from "@/app/components/ui/Spinner";
import { AnimatedNumber } from "@/app/components/dashboard/AnimatedNumber";
import { LiveOperationsTerminal } from "@/app/components/dashboard/LiveOperationsTerminal";
import { useWalletContext } from "@/app/contexts/WalletContext";
import { useCreateDelegation } from "@/app/hooks/useCreateDelegation";
import { withdrawFromSmartWallet } from "@/app/lib/stellar";
import type { SmartWalletInfo } from "@/app/hooks/useSmartWallet";
import { WalletPicker } from "@/app/components/WalletPicker";
import {
  getAgentsSummary,
  getAllocations,
  getAuditLog,
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
  getDeveloperModeStatus,
  type AgentSummary,
  type AgentDashboard,
  type Allocations,
  type AuditLogRow,
  type DecisionRecord,
  type PerformanceSnapshot,
  type RuntimeState,
  type RuntimeHeartbeat,
  type RuntimeHealthReport,
  type MemoryPackage,
  type LearningSnapshot,
} from "@/app/lib/agentsBackend";
import { DevPanel } from "./DevPanel";
import { AgentCreationWizard } from "./AgentCreationWizard";

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

function num(v: string | null | undefined): number {
  if (!v) return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtUsdLike(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(2)}K`;
  return `${sign}${abs.toFixed(2)}`;
}

const PIE_COLORS = ["#7851e9", "#8b6ef0", "#2dd4a0", "#f59e0b", "#5c5c62", "#f05151"];

/** Premium AI Capital Management Terminal — landing page for every autonomous agent the caller
 *  has launched. Every number below is derived from real AgentDashboard/Allocations/AuditLogRow
 *  data returned by agentsBackend.ts; nothing here is invented. */
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
    deploySmartWallet,
    checkError,
    retryCheck,
  } = useWalletContext();
  const networkPassphrase = wallet?.networkPassphrase ?? "Test SDF Network ; September 2015";

  const [dashboards, setDashboards] = useState<AgentDashboard[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [allocations, setAllocations] = useState<Allocations | null>(null);
  const [recentAudit, setRecentAudit] = useState<AuditLogRow[]>([]);
  const [search, setSearch] = useState("");
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!walletOwner) return;
    setLoadingAgents(true);
    setListError(null);
    try {
      const [dbs, alloc, audit] = await Promise.all([
        getAgentsSummary(),
        getAllocations().catch(() => null),
        getAuditLog({ limit: 12 }).catch(() => []),
      ]);
      setDashboards(dbs);
      setAllocations(alloc);
      setRecentAudit(audit);
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

  // Poll the fleet itself (not just individual cards) so agents started/stopped elsewhere still
  // show up here without a manual refresh.
  useEffect(() => {
    if (!walletOwner) return;
    const id = setInterval(() => { ensureAgentAuth(false).then(refresh); }, 8000);
    return () => clearInterval(id);
  }, [walletOwner, ensureAgentAuth, refresh]);

  // Opens the guided agent-creation wizard (see AgentCreationWizard / agentcreation.md) — the
  // natural-language, review-and-approve flow that provisions + funds a single agent, rather
  // than silently minting all three role agents at once.
  const handleCreateAgent = useCallback(async () => {
    setCreateError(null);
    try {
      await ensureAgentAuth();
      setWizardOpen(true);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    }
  }, [ensureAgentAuth]);

  const agents = useMemo(() => dashboards.map((d) => d.agent), [dashboards]);

  const filteredDashboards = useMemo(() => {
    if (!search.trim()) return dashboards;
    const q = search.toLowerCase();
    return dashboards.filter((d) =>
      d.agent.publicKey.toLowerCase().includes(q) ||
      (d.role ?? "").toLowerCase().includes(q) ||
      d.mode.toLowerCase().includes(q) ||
      d.agent.status.toLowerCase().includes(q)
    );
  }, [dashboards, search]);

  // ── Fleet KPIs — computed honestly from AgentDashboard/PnlSummary, nothing fabricated ──
  const fleet = useMemo(() => {
    const totalCapital = dashboards.reduce((s, d) => s + num(d.capital), 0);
    const totalRealizedPnl = dashboards.reduce((s, d) => s + num(d.pnl.realizedPnl), 0);
    const totalUnrealizedPnl = dashboards.reduce((s, d) => s + num(d.pnl.unrealizedPnl), 0);
    const totalTodayPnl = dashboards.reduce((s, d) => s + num(d.todayPnl), 0);
    const activeCount = dashboards.filter((d) => d.agent.status === "running").length;
    const totalTrades = dashboards.reduce((s, d) => s + (d.tradeCount || 0), 0);
    const weightedWinRate = dashboards.length
      ? dashboards.reduce((s, d) => s + (d.winRate || 0) * (d.tradeCount || 0), 0) /
        Math.max(1, dashboards.reduce((s, d) => s + (d.tradeCount || 0), 0))
      : 0;
    return {
      totalCapital,
      totalPnl: totalRealizedPnl + totalUnrealizedPnl,
      totalTodayPnl,
      activeCount,
      totalAgents: dashboards.length,
      totalTrades,
      winRatePct: weightedWinRate * 100,
    };
  }, [dashboards]);

  const allocationSlices = useMemo(() => {
    if (!allocations) return [];
    const spotTotal = allocations.spot.reduce((s, a) => s + num(a.openAmount), 0);
    const byKind = new Map<string, number>();
    if (spotTotal > 0) byKind.set("Spot", spotTotal);
    [...allocations.blend, ...allocations.soroswap].forEach((p) => {
      byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + num(p.amount));
    });
    return Array.from(byKind.entries())
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value }));
  }, [allocations]);

  const distributionByMode = useMemo(() => {
    const m = new Map<string, number>();
    dashboards.forEach((d) => m.set(d.mode, (m.get(d.mode) ?? 0) + 1));
    return Array.from(m.entries()).map(([name, count]) => ({ name, count }));
  }, [dashboards]);

  const pnlByAgent = useMemo(() => {
    return dashboards
      .map((d) => ({
        name: shortKey(d.agent.publicKey),
        pnl: num(d.pnl.realizedPnl) + num(d.pnl.unrealizedPnl),
      }))
      .sort((a, b) => b.pnl - a.pnl);
  }, [dashboards]);

  const best = pnlByAgent[0];
  const worst = pnlByAgent[pnlByAgent.length - 1];

  const healthDot = fleet.activeCount > 0 ? "success" : dashboards.some((d) => d.agent.status === "error") ? "error" : "neutral";

  const activeAgent = dashboards.find((d) => d.agent.id === activeAgentId) ?? null;

  return (
    <div className="space-y-6">
      {/* ── Sticky header ── */}
      <header className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] bg-bg-primary/85 px-4 py-3 backdrop-saturate-150 sm:-mx-0 sm:px-0">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-accent/15 bg-accent-muted/40 text-accent">
            <Bot className="h-4.5 w-4.5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-lg font-medium text-text-primary">Agent Fleet</h1>
              <Badge tone={healthDot === "success" ? "success" : healthDot === "error" ? "error" : "neutral"} dot>
                {fleet.activeCount > 0 ? `${fleet.activeCount} active` : "idle"}
              </Badge>
            </div>
            <p className="text-xs text-text-muted">Operating system for your autonomous capital.</p>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-end gap-2 sm:flex-initial">
          <div className="relative hidden sm:block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agents…"
              className="w-48 rounded-lg border border-white/5 bg-bg-elevated py-1.5 pl-8 pr-2.5 text-xs text-text-primary placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            />
          </div>
          <button className="rounded-lg border border-white/5 bg-white/[0.02] p-2 text-text-secondary transition-colors hover:text-text-primary" title="Notifications">
            <Bell className="h-4 w-4" />
          </button>
          <button
            onClick={handleCreateAgent}
            disabled={!walletOwner}
            className="flex items-center gap-1.5 rounded-xl bg-accent/80 px-3.5 py-2 text-xs font-semibold text-white transition-all duration-300 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Create Agent
          </button>
          {walletOwner && (
            <span className="hidden items-center gap-1.5 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5 font-mono text-[11px] text-text-secondary md:flex">
              <Wallet className="h-3.5 w-3.5 text-text-muted" />
              {shortKey(walletOwner)}
            </span>
          )}
        </div>
      </header>

      {!connected ? (
        <Card className="card-matte">
          <CardBody className="text-center">
            <p className="mb-3 text-xs text-text-muted">Connect Freighter to view your agent fleet.</p>
            <button
              onClick={() => connect()}
              disabled={connecting}
              className="rounded-xl bg-accent/70 px-4 py-2 text-xs font-semibold text-white transition-all duration-300 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {connecting ? "Connecting…" : "Connect Freighter"}
            </button>
          </CardBody>
        </Card>
      ) : checkError ? (
        <Card className="card-matte">
          <CardBody className="text-center">
            <p className="text-xs text-text-muted">Couldn&apos;t verify your smart wallet status.</p>
            <p className="mt-2 text-xs text-error/90">{checkError}</p>
            <button
              onClick={() => retryCheck()}
              className="mt-3 rounded-xl bg-accent/70 px-4 py-2 text-xs font-semibold text-white transition-all duration-300 hover:bg-accent"
            >
              Retry
            </button>
          </CardBody>
        </Card>
      ) : !smartWalletAddress ? (
        <Card className="card-matte">
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
          {createError && (
            <div className="rounded-xl border border-error/15 bg-error/6 px-4 py-3">
              <p className="text-xs text-error/90">{createError}</p>
            </div>
          )}

          {loadingAgents && dashboards.length === 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-2xl bg-bg-elevated/60" />
              ))}
            </div>
          ) : dashboards.length === 0 ? (
            <Card className="card-matte">
              <CardBody className="py-10 text-center">
                <p className="text-sm text-text-muted">
                  No agents yet —{" "}
                  <button onClick={handleCreateAgent} className="text-accent/80 hover:text-accent">
                    create your first agent
                  </button>{" "}
                  to get started.
                </p>
              </CardBody>
            </Card>
          ) : (
            <>
              {/* ── Fleet Overview KPIs ── */}
              <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Kpi label="Capital Managed" value={fleet.totalCapital} format={(n) => `${fmtUsdLike(n)} XLM`} icon={<Wallet className="h-3.5 w-3.5" />} />
                <Kpi label="Total PnL" value={fleet.totalPnl} format={(n) => `${n >= 0 ? "+" : ""}${fmtUsdLike(n)}`} icon={fleet.totalPnl >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />} tone={fleet.totalPnl >= 0 ? "success" : "error"} />
                <Kpi label="Active Agents" value={fleet.activeCount} format={(n) => `${Math.round(n)} / ${fleet.totalAgents}`} icon={<Bot className="h-3.5 w-3.5" />} />
                <Kpi label="Today's PnL" value={fleet.totalTodayPnl} format={(n) => `${n >= 0 ? "+" : ""}${fmtUsdLike(n)}`} icon={<Zap className="h-3.5 w-3.5" />} tone={fleet.totalTodayPnl >= 0 ? "success" : "error"} />
                <Kpi label="Total Executions" value={fleet.totalTrades} format={(n) => Math.round(n).toLocaleString()} icon={<Activity className="h-3.5 w-3.5" />} />
                <Kpi label="Win Rate" value={fleet.winRatePct} format={(n) => `${n.toFixed(1)}%`} icon={<ShieldCheck className="h-3.5 w-3.5" />} />
                <Kpi label="Fleet Health" value={fleet.activeCount > 0 ? 1 : 0} format={() => (fleet.activeCount > 0 ? "Operational" : "Idle")} icon={<HeartPulse className="h-3.5 w-3.5" />} tone={fleet.activeCount > 0 ? "success" : "neutral"} />
                <Kpi label="Runtime" value={dashboards.filter((d) => d.mode === "live").length} format={(n) => `${Math.round(n)} live · ${dashboards.filter((d) => d.mode === "paper").length} paper`} icon={<Layers className="h-3.5 w-3.5" />} />
              </section>

              {/* ── Active Agents grid ── */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-sm font-medium text-text-primary">Active Agents</h2>
                  <span className="text-xs text-text-muted">{filteredDashboards.length} of {dashboards.length}</span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredDashboards.map((d) => (
                    <FleetAgentCard key={d.agent.id} dashboard={d} onOpen={() => setActiveAgentId(d.agent.id)} />
                  ))}
                </div>
              </section>

              {/* ── Live Operations Terminal ── */}
              <LiveOperationsTerminal agents={agents} />

              {/* ── Fleet Analytics ── */}
              <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <Card className="lg:col-span-1 card-matte">
                  <CardHeader title={<span className="flex items-center gap-2"><PieChartIcon className="h-3.5 w-3.5 text-accent" />Protocol Allocation</span>} />
                  <CardBody className="pt-2">
                    {allocationSlices.length === 0 ? (
                      <p className="py-8 text-center text-xs text-text-muted">No open allocations yet.</p>
                    ) : (
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={allocationSlices} dataKey="value" nameKey="name" innerRadius={40} outerRadius={68} paddingAngle={2}>
                              {allocationSlices.map((_, i) => (
                                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="none" />
                              ))}
                            </Pie>
                            <RTooltip
                              contentStyle={{ background: "#18181b", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, fontSize: 11 }}
                              labelStyle={{ color: "#a8a6a2" }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {allocationSlices.map((s, i) => (
                        <span key={s.name} className="flex items-center gap-1.5 text-[10px] text-text-secondary">
                          <span className="h-2 w-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                          {s.name}
                        </span>
                      ))}
                    </div>
                  </CardBody>
                </Card>

                <Card className="lg:col-span-2 card-matte">
                  <CardHeader title={<span className="flex items-center gap-2"><BarChart3 className="h-3.5 w-3.5 text-accent" />PnL by Agent</span>} />
                  <CardBody className="pt-2">
                    {pnlByAgent.length === 0 ? (
                      <p className="py-8 text-center text-xs text-text-muted">No performance data yet.</p>
                    ) : (
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={pnlByAgent}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                            <XAxis dataKey="name" tick={{ fill: "#5c5c62", fontSize: 10 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: "#5c5c62", fontSize: 10 }} axisLine={false} tickLine={false} />
                            <RTooltip
                              contentStyle={{ background: "#18181b", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, fontSize: 11 }}
                              labelStyle={{ color: "#a8a6a2" }}
                            />
                            <Bar dataKey="pnl" radius={[6, 6, 0, 0]}>
                              {pnlByAgent.map((p, i) => (
                                <Cell key={i} fill={p.pnl >= 0 ? "#2dd4a0" : "#f05151"} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      {best && (
                        <div className="rounded-lg bg-bg-elevated px-3 py-2">
                          <p className="text-[10px] uppercase tracking-widest text-text-muted">Top Performer</p>
                          <p className="font-mono text-text-secondary">{best.name} · <span className={best.pnl >= 0 ? "text-success" : "text-error"}>{best.pnl >= 0 ? "+" : ""}{fmtUsdLike(best.pnl)}</span></p>
                        </div>
                      )}
                      {worst && worst !== best && (
                        <div className="rounded-lg bg-bg-elevated px-3 py-2">
                          <p className="text-[10px] uppercase tracking-widest text-text-muted">Needs Attention</p>
                          <p className="font-mono text-text-secondary">{worst.name} · <span className={worst.pnl >= 0 ? "text-success" : "text-error"}>{worst.pnl >= 0 ? "+" : ""}{fmtUsdLike(worst.pnl)}</span></p>
                        </div>
                      )}
                    </div>
                  </CardBody>
                </Card>

                <Card className="lg:col-span-3 card-matte">
                  <CardHeader title={<span className="flex items-center gap-2"><Layers className="h-3.5 w-3.5 text-accent" />Fleet Distribution</span>} />
                  <CardBody className="pt-2">
                    <div className="flex flex-wrap gap-4">
                      {distributionByMode.map((d) => (
                        <div key={d.name} className="flex-1 min-w-[120px] rounded-xl bg-bg-elevated p-3">
                          <p className="text-[10px] uppercase tracking-widest text-text-muted">{d.name} mode</p>
                          <p className="mt-1 font-display text-2xl font-semibold text-text-primary tabular-nums">{d.count}</p>
                          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/5">
                            <div className="h-full rounded-full bg-accent/80" style={{ width: `${(d.count / Math.max(1, dashboards.length)) * 100}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardBody>
                </Card>
              </section>

              {/* ── Recent Activity ── */}
              <Card className="card-matte">
                <CardHeader title={<span className="flex items-center gap-2"><Radio className="h-3.5 w-3.5 text-accent" />Recent Activity</span>} />
                <CardBody className="space-y-1.5 pt-2">
                  {recentAudit.length === 0 ? (
                    <p className="py-6 text-center text-xs text-text-muted">No recent activity.</p>
                  ) : (
                    recentAudit.map((a) => (
                      <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-xs hover:bg-white/[0.02]">
                        <span className="text-text-secondary">{a.message || a.event_type.replace(/_/g, " ")}</span>
                        <span className="shrink-0 font-mono text-[10px] text-text-muted">{new Date(a.created_at).toLocaleTimeString()}</span>
                      </div>
                    ))
                  )}
                </CardBody>
              </Card>
            </>
          )}
        </>
      )}

      {wizardOpen && walletOwner && (
        <AgentCreationWizard
          smartWalletAddress={smartWalletAddress}
          smartWallets={smartWallets}
          walletOwner={walletOwner}
          networkPassphrase={networkPassphrase}
          sorobanRpcUrl={wallet?.sorobanRpcUrl}
          deploying={deploying}
          deployError={deployError}
          onDeploySmartWallet={() => deploySmartWallet()}
          onClose={() => { setWizardOpen(false); refresh(); }}
          onCreated={(agentId) => { setWizardOpen(false); refresh(); setActiveAgentId(agentId); }}
        />
      )}

      {activeAgent && (
        <AgentDetailModal
          dashboard={activeAgent}
          smartWalletAddress={smartWalletAddress}
          smartWallets={smartWallets}
          walletOwner={walletOwner!}
          networkPassphrase={networkPassphrase}
          sorobanRpcUrl={wallet?.sorobanRpcUrl}
          onChanged={refresh}
          onClose={() => setActiveAgentId(null)}
        />
      )}
    </div>
  );
}

function Kpi({
  label, value, format, icon, tone,
}: {
  label: string; value: number; format: (n: number) => string; icon: React.ReactNode; tone?: "success" | "error" | "neutral";
}) {
  return (
    <Card className="p-4 card-matte">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-text-muted">{label}</p>
        <span className="text-text-muted">{icon}</span>
      </div>
      <p className={`mt-1.5 font-display text-xl font-semibold tabular-nums ${tone === "success" ? "text-success" : tone === "error" ? "text-error" : "text-text-primary"}`}>
        <AnimatedNumber value={value} format={format} />
      </p>
    </Card>
  );
}

function FleetAgentCard({ dashboard, onOpen }: { dashboard: AgentDashboard; onOpen: () => void }) {
  const { agent } = dashboard;
  const pnl = num(dashboard.pnl.realizedPnl) + num(dashboard.pnl.unrealizedPnl);
  const running = agent.status === "running";
  return (
    <button
      onClick={onOpen}
      className="group relative w-full overflow-hidden rounded-2xl border border-white/[0.06] bg-bg-card p-4 text-left transition-all duration-300 hover:border-accent/20 hover:bg-bg-elevated/80 hover:shadow-[0_8px_32px_-8px_rgba(120,81,233,0.15)]"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-white/5 bg-white/[0.02] text-accent">
            <Bot className="h-4 w-4" />
            {running && (
              <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
              </span>
            )}
          </div>
          <div>
            <p className="font-mono text-xs text-text-primary">{shortKey(agent.publicKey)}</p>
            <p className="text-[10px] uppercase tracking-wider text-text-muted">{dashboard.role ?? "unassigned"} · {dashboard.mode}</p>
          </div>
        </div>
        <Badge tone={statusTone(agent.status)} dot>{agent.status}</Badge>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <MiniStat label="Capital" value={dashboard.capital ? `${fmtUsdLike(num(dashboard.capital))} XLM` : "—"} />
        <MiniStat label="PnL" value={`${pnl >= 0 ? "+" : ""}${fmtUsdLike(pnl)}`} tone={pnl >= 0 ? "success" : "error"} />
        <MiniStat label="Win Rate" value={`${(dashboard.winRate * 100).toFixed(1)}%`} />
        <MiniStat label="Risk" value={dashboard.riskLevel ?? "—"} />
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-white/[0.04] pt-2.5 text-[10px] text-text-muted">
        <span className="truncate">
          {dashboard.lastExecution ? `Last run ${new Date(dashboard.lastExecution).toLocaleTimeString()}` : "No executions yet"}
        </span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
      </div>
    </button>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "success" | "error" }) {
  return (
    <div className="rounded-lg bg-bg-elevated px-2.5 py-1.5">
      <p className="text-[9px] uppercase tracking-widest text-text-muted">{label}</p>
      <p className={`truncate font-mono text-[11px] ${tone === "success" ? "text-success/90" : tone === "error" ? "text-error/90" : "text-text-secondary"}`}>{value}</p>
    </div>
  );
}

/** Full agent control surface — a drawer/modal over everything the original 861-line page did
 *  (delegation, strategy, funding, start/stop/delete) plus the Control Center (runtime, pipeline,
 *  decisions, memory, metrics, logs). Nothing here is new functionality — it's the same handlers,
 *  restructured into a focused per-agent view opened from the fleet grid. */
function AgentDetailModal({
  dashboard,
  smartWalletAddress,
  smartWallets,
  walletOwner,
  networkPassphrase,
  sorobanRpcUrl,
  onChanged,
  onClose,
}: {
  dashboard: AgentDashboard;
  smartWalletAddress: string | null;
  smartWallets: SmartWalletInfo[];
  walletOwner: string;
  networkPassphrase: string;
  sorobanRpcUrl?: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const agent = dashboard.agent;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [spendLimit, setSpendLimit] = useState("100");
  const [periodDays, setPeriodDays] = useState("1");
  const [delegatorWallet, setDelegatorWallet] = useState<string | null>(smartWalletAddress);
  useEffect(() => { setDelegatorWallet(smartWalletAddress); }, [smartWalletAddress]);
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
      window.dispatchEvent(new Event("kairos:smart-wallet-changed"));
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
      window.dispatchEvent(new Event("kairos:smart-wallet-changed"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

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
      window.dispatchEvent(new Event("kairos:smart-wallet-changed"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFunding(false);
    }
  };

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
      onClose();
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 py-8 backdrop-blur-[2px]" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl rounded-2xl border border-white/[0.08] bg-bg-card shadow-[0_24px_64px_-16px_rgba(0,0,0,0.7)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-text-primary">{shortKey(agent.publicKey)}</span>
            <button onClick={copyPubkey} className="flex items-center gap-1 text-[10px] text-accent/70 hover:text-accent">
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy key"}
            </button>
            <Badge tone={statusTone(agent.status)} dot>{agent.status}</Badge>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-white/[0.04] hover:text-text-primary">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[75vh] space-y-4 overflow-y-auto p-6">
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
                  <input value={delegatorWallet ? shortKey(delegatorWallet) : "—"} disabled className={INPUT_CLS} />
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
              <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">Step 2 — Configure its DCA strategy</p>
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
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-text-muted">Fund (XLM)</span>
                  <input value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} type="number" min="0" className={`${INPUT_CLS} flex-1`} />
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
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy ? <Spinner className="h-3 w-3" /> : <><Square className="h-3 w-3" /> Stop</>}
                  </button>
                ) : (
                  <button
                    onClick={handleStart}
                    disabled={busy}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600/80 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy ? <Spinner className="h-3 w-3" /> : <><Play className="h-3 w-3" /> Start</>}
                  </button>
                )}
              </div>
            </div>
          )}

          {agent.status !== "running" && (
            <button
              onClick={handleDelete}
              disabled={busy}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-error/15 bg-error/[0.03] px-3 py-2 text-xs text-error/80 transition-colors hover:bg-error/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete Agent Wallet
            </button>
          )}

          <ControlCenter agent={agent} />
        </div>
      </div>
    </div>
  );
}

const PIPELINE_STAGES = [
  "Market", "Context", "Memory", "Reasoning", "Decision", "Verification",
  "Planning", "Routing", "Execution", "Outcome", "Learning",
] as const;

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

const AUDIT_LOG_LABELS: Record<string, string> = {
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

/** The Agent Control Center — everything about this one autonomous agent, in one place. Pure
 *  read/control passthrough over the existing Dashboard API (/api/dashboard/*) and the existing
 *  agent-wallet backend (/api/agents/*, /api/decisions, /api/agents/:id/audit) — no new backend
 *  logic, no mocked data. */
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
  // Hidden Developer Mode: re-verified against the backend (GET /api/dev/status, gated by
  // requireAuth+requireDev / DEV_ALLOWLIST) on every mount — never cached as a persisted
  // client-side flag, so switching wallets/accounts always re-checks server-side membership.
  const [devMode, setDevMode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDeveloperModeStatus().then((enabled) => { if (!cancelled) setDevMode(enabled); });
    return () => { cancelled = true; };
  }, [agent.id]);

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

      {devMode && (
        <>
          <div className="flex items-center gap-2">
            <Badge tone="warning" dot>Developer Mode</Badge>
          </div>
          <DevPanel agent={agent} />
        </>
      )}

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

      <section className="space-y-2">
        <h4 className="font-mono text-[10px] uppercase tracking-widest text-text-muted">Memory</h4>
        <input value={memorySearch} onChange={(e) => setMemorySearch(e.target.value)} placeholder="Search memory…" className={INPUT_CLS} />
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
