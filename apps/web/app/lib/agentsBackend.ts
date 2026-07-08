// Thin client for the custodial agent-wallet backend (see /backend) — a separate service
// that generates/holds agent keypairs and runs their scheduled spend strategy. Unlike
// /api/delegate-sdk (a Next.js API route proxying the Kairos SDK), this talks directly to
// that standalone service over HTTP.

import type { DcaStrategyConfig, QuantStrategyConfig, LimitStrategyConfig, AgentMode, AgentRole, AgentSummary, TradeRow, PositionRow, PnlSummary, AuditEventType, IntentParseResult } from '@kairos/types';
import { getAgentsBackendBase } from '@/app/lib/backendBase';

export type { DcaStrategyConfig, QuantStrategyConfig, LimitStrategyConfig, AgentMode, AgentRole, AgentSummary, TradeRow, PositionRow, PnlSummary, AuditEventType, IntentParseResult };

export interface StrategyMeta {
  id: string;
  name: string;
  category: string;
  description: string;
}

export interface AuditLogRow {
  id: string;
  agent_id: string;
  owner: string;
  event_type: AuditEventType;
  mode: string | null;
  strategy_id: string | null;
  mpc_account: string | null;
  pair: string | null;
  market_snapshot_json: string | null;
  indicators_json: string | null;
  signal: string | null;
  policy_validation_json: string | null;
  delegation_validation_json: string | null;
  execution_status: string | null;
  tx_hash: string | null;
  position_after_json: string | null;
  pnl_after_json: string | null;
  message: string | null;
  created_at: number;
}

export interface AgentDashboard {
  agent: AgentSummary;
  role: AgentRole | null;
  position: PositionRow | null;
  pnl: PnlSummary;
  tradeCount: number;
  winRate: number;
  totalReturn: number | null;
  runningTimeMs: number | null;
  lastExecution: number | null;
  delegationStatus: "active" | "disabled" | "none";
  mode: AgentMode;
  capital: string | null;
  riskLevel: string | null;
  todayPnl: string;
  lifetimePnl: string;
  currentTask: string | null;
  currentDecision: string | null;
  currentConfidence: number | null;
  currentReasoning: string | null;
  currentStrategy: string | null;
  lastDecisionTime: number | null;
}

export interface DecisionRecord {
  id: string;
  agent_id: string;
  owner: string;
  role: AgentRole;
  mode: string;
  pair: string;
  market_snapshot_json: string | null;
  oracle_json: string | null;
  indicators_json: string | null;
  regime_json: string | null;
  llm_model: string | null;
  llm_prompt_summary: string | null;
  llm_response_json: string | null;
  action: string;
  selected_strategy: string | null;
  confidence: number;
  reasoning: string;
  policy_validation_json: string | null;
  delegation_validation_json: string | null;
  risk_json: string | null;
  execution_result: string | null;
  trade_id: string | null;
  position_before_json: string | null;
  position_after_json: string | null;
  pnl_before_json: string | null;
  pnl_after_json: string | null;
  created_at: number;
}

export interface PerformanceSnapshot {
  id: string;
  agent_id: string;
  owner: string;
  realized_pnl: string;
  unrealized_pnl: string;
  open_position: string;
  trade_count: number;
  win_rate: number;
  capital_managed: string | null;
  created_at: number;
}

export interface YieldVenue {
  id: string;
  name: string;
  baseApyPct: number;
  effectiveApyPct: number;
}

export interface PortfolioOverview {
  price: number;
  allocation: {
    xlmValue: number;
    usdcValue: number;
    totalValue: number;
    xlmPct: number;
    usdcPct: number;
    idleUsd: number;
    xlmAmount: number;
  };
  targets: { xlmPct: number; usdcPct: number; driftThresholdPct: number };
  managedCapital: number;
  yieldVenues: YieldVenue[];
}

function backendUrl(path: string): string {
  return `${getAgentsBackendBase()}${path}`;
}

// Set once per session by the wallet-signature login handshake (see lib/agentsAuth.ts) and
// attached to every request below — the backend derives the caller's identity from this
// token rather than trusting a client-supplied owner string.
let authToken: string | null = null;

/** Drops every cached session token (see agentsAuth.ts's `kairos:session:<publicKey>` keys) —
 *  called on a 401 so a rejected/expired token can't keep getting resent by ensureAgentAuth's
 *  cache-first check. Scans by prefix rather than taking a publicKey so it works regardless of
 *  which wallet's token was rejected. */
/** Exported for logout flows (see useAuthentication.ts) that need to drop every cached session
 *  token deterministically, not just the in-memory bearer token. */
export function clearAllStoredSessionTokens(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith("kairos:session:")) keys.push(key);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // sessionStorage unavailable — nothing to clear.
  }
}

export function setAuthToken(token: string | null): void {
  authToken = token;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(backendUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...init?.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      authToken = null;
      // Also drop the sessionStorage cache (see agentsAuth.ts) — ensureAgentAuth() checks
      // that cache *before* re-challenging, so leaving a rejected token in it would make
      // every page/poll keep resending the same dead token forever with no way to self-heal.
      clearAllStoredSessionTokens();
    }
    throw new Error(data.error || `Agent backend request failed (${res.status})`);
  }
  return data;
}

export async function createAgentWallet(
  owner: string,
  options?: { mode?: AgentMode; capital?: string; riskLevel?: string }
): Promise<AgentSummary> {
  const data = await request<{ agent: AgentSummary }>("/api/agents", {
    method: "POST",
    body: JSON.stringify({ owner, ...options }),
  });
  return data.agent;
}

export async function listAgentWallets(owner: string): Promise<AgentSummary[]> {
  const data = await request<{ agents: AgentSummary[] }>(`/api/agents?owner=${encodeURIComponent(owner)}`);
  return data.agents;
}

/** Step 1 of Agent Creation (agentcreation.md): sends the user's natural-language goal to the
 *  backend Intent Parser — the single production parser/prompt/schema for Agent Creation — and
 *  returns the raw AgentSpec result. Unlike `request()`, this does not throw on a non-2xx status:
 *  a 502 here still carries a real IntentParseResult body (status: 'failed') that the wizard needs
 *  to render, not just a generic error. */
export async function parseAgentIntent(goal: string): Promise<IntentParseResult> {
  const res = await fetch(backendUrl("/api/agents/parse-intent"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({ goal }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    authToken = null;
    clearAllStoredSessionTokens();
  }
  if (!data || typeof data.status !== "string") {
    throw new Error(data?.error || `Agent backend request failed (${res.status})`);
  }
  return data as IntentParseResult;
}

export async function getBackendHealth(): Promise<boolean> {
  const res = await fetch(backendUrl("/health"));
  if (!res.ok) return false;
  const data = await res.json().catch(() => ({}));
  return Boolean(data.ok);
}

export async function getAgentWallet(id: string): Promise<AgentSummary> {
  const data = await request<{ agent: AgentSummary }>(`/api/agents/${id}`);
  return data.agent;
}

export async function attachAgentDelegation(id: string, delegation: unknown, force?: boolean): Promise<AgentSummary> {
  const data = await request<{ agent: AgentSummary }>(`/api/agents/${id}/delegation`, {
    method: "POST",
    body: JSON.stringify({ delegation, force }),
  });
  return data.agent;
}

export async function revokeAgentDelegation(id: string): Promise<AgentSummary> {
  const data = await request<{ agent: AgentSummary }>(`/api/agents/${id}/delegation/revoke`, {
    method: "POST",
  });
  return data.agent;
}

export interface SmartWallet {
  owner: string;
  address: string;
  label: string | null;
  network: string | null;
  created_at: number;
  updated_at: number;
}

export async function listSmartWallets(): Promise<SmartWallet[]> {
  const data = await request<{ wallets: SmartWallet[] }>("/api/smart-wallets");
  return data.wallets;
}

export async function registerSmartWallet(address: string, label?: string, network?: string): Promise<SmartWallet[]> {
  const data = await request<{ wallets: SmartWallet[] }>("/api/smart-wallets", {
    method: "POST",
    body: JSON.stringify({ address, label, network }),
  });
  return data.wallets;
}

// Distributes over the union properly (unlike Omit<StrategyConfig, "destination">, which would
// collapse the discriminated union into a single flattened object) — `destination` is always
// forced server-side, so callers never need to supply it.
export type StrategyInput =
  | Omit<DcaStrategyConfig, "destination">
  | Omit<QuantStrategyConfig, "destination">
  | Omit<LimitStrategyConfig, "destination">;

export async function setAgentStrategy(id: string, strategy: StrategyInput): Promise<AgentSummary> {
  const data = await request<{ agent: AgentSummary }>(`/api/agents/${id}/strategy`, {
    method: "POST",
    body: JSON.stringify(strategy),
  });
  return data.agent;
}

export async function startAgentWallet(id: string): Promise<AgentSummary> {
  const data = await request<{ agent: AgentSummary }>(`/api/agents/${id}/start`, { method: "POST" });
  return data.agent;
}

export async function stopAgentWallet(id: string): Promise<AgentSummary> {
  const data = await request<{ agent: AgentSummary }>(`/api/agents/${id}/stop`, { method: "POST" });
  return data.agent;
}

export async function deleteAgentWallet(id: string): Promise<void> {
  await request(`/api/agents/${id}`, { method: "DELETE" });
}

/** Fetches the public registry of quant strategies — note this endpoint lives at
 *  /api/strategies, not under /api/agents, so it does not go through `backendUrl`'s
 *  `/api/agents`-relative helpers directly (it still shares the same backend base URL). */
export async function listStrategies(): Promise<StrategyMeta[]> {
  const res = await fetch(`${getAgentsBackendBase()}/api/strategies`, {
    headers: { "Content-Type": "application/json" },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Agent backend request failed (${res.status})`);
  return (data as { strategies: StrategyMeta[] }).strategies;
}

export async function getAgentTrades(id: string): Promise<{ trades: TradeRow[]; pnl: PnlSummary }> {
  return request<{ trades: TradeRow[]; pnl: PnlSummary }>(`/api/agents/${id}/trades`);
}

export async function reverseTrade(id: string, tradeId: string): Promise<TradeRow> {
  const data = await request<{ trade: TradeRow }>(`/api/agents/${id}/trades/${tradeId}/reverse`, {
    method: "POST",
  });
  return data.trade;
}

export async function getAgentPositions(id: string): Promise<PositionRow[]> {
  const data = await request<{ positions: PositionRow[] }>(`/api/agents/${id}/positions`);
  return data.positions;
}

export async function getPositions(): Promise<(PositionRow & { agentId: string })[]> {
  const data = await request<{ positions: (PositionRow & { agentId: string })[] }>("/api/positions");
  return data.positions;
}

export async function getAgentAuditLog(id: string, opts?: { limit?: number; before?: number }): Promise<AuditLogRow[]> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.before) params.set("before", String(opts.before));
  const qs = params.toString();
  const data = await request<{ events: AuditLogRow[] }>(`/api/agents/${id}/audit${qs ? `?${qs}` : ""}`);
  return data.events;
}

export async function getAuditLog(opts?: { limit?: number; before?: number }): Promise<AuditLogRow[]> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.before) params.set("before", String(opts.before));
  const qs = params.toString();
  const data = await request<{ events: AuditLogRow[] }>(`/api/audit${qs ? `?${qs}` : ""}`);
  return data.events;
}

export async function getAgentDashboard(id: string): Promise<AgentDashboard> {
  return request<AgentDashboard>(`/api/agents/${id}/dashboard`);
}

export async function getAgentsSummary(): Promise<AgentDashboard[]> {
  const data = await request<{ agents: AgentDashboard[] }>("/api/agents/summary");
  return data.agents;
}

export interface SpotAllocation {
  pair: string;
  openAmount: string;
  avgCost: string;
}

export interface ProtocolAllocation {
  asset: string;
  kind: string;
  amount: string;
  updatedAt: number;
}

export interface Allocations {
  spot: SpotAllocation[];
  blend: ProtocolAllocation[];
  soroswap: ProtocolAllocation[];
}

/** Real per-venue position breakdown — replaces the dashboard's hardcoded ALLOCATION mock.
 *  See backend/src/routes/stats.ts's `/allocations` handler for why amounts aren't converted
 *  to USD percentages here (no cross-asset price feed exists yet). */
export async function getAllocations(): Promise<Allocations> {
  const data = await request<{ success: boolean } & Allocations>("/api/allocations");
  return { spot: data.spot, blend: data.blend, soroswap: data.soroswap };
}

// ── Autonomous multi-agent system ──

/** Idempotently creates + starts the 3 fixed role agents (yield/strategic/balancer) for the caller. */
export async function provisionRoleAgents(opts?: { mode?: AgentMode; capital?: string }): Promise<AgentSummary[]> {
  const data = await request<{ agents: AgentSummary[] }>("/api/agents/provision", {
    method: "POST",
    body: JSON.stringify(opts ?? {}),
  });
  return data.agents;
}

/** Idempotently creates (and, in paper mode, starts) a single role agent — lets the UI offer
 *  "pick one role, then set its delegation" instead of minting all three roles at once. */
export async function provisionSingleRoleAgent(opts: { role: AgentRole; mode?: AgentMode; capital?: string }): Promise<AgentSummary> {
  const data = await request<{ agent: AgentSummary }>("/api/agents/provision-role", {
    method: "POST",
    body: JSON.stringify(opts),
  });
  return data.agent;
}

export async function getOwnerDecisions(opts?: { limit?: number; before?: number }): Promise<DecisionRecord[]> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.before) params.set("before", String(opts.before));
  const qs = params.toString();
  const data = await request<{ decisions: DecisionRecord[] }>(`/api/decisions${qs ? `?${qs}` : ""}`);
  return data.decisions;
}

export async function getAgentDecisions(id: string, opts?: { limit?: number }): Promise<DecisionRecord[]> {
  const qs = opts?.limit ? `?limit=${opts.limit}` : "";
  const data = await request<{ decisions: DecisionRecord[] }>(`/api/agents/${id}/decisions${qs}`);
  return data.decisions;
}

export async function getDecision(decisionId: string): Promise<DecisionRecord> {
  const data = await request<{ decision: DecisionRecord }>(`/api/decisions/${decisionId}`);
  return data.decision;
}

export async function getAgentPerformance(id: string, opts?: { limit?: number }): Promise<PerformanceSnapshot[]> {
  const qs = opts?.limit ? `?limit=${opts.limit}` : "";
  const data = await request<{ snapshots: PerformanceSnapshot[] }>(`/api/agents/${id}/performance${qs}`);
  return data.snapshots;
}

export async function getPortfolioOverview(): Promise<PortfolioOverview> {
  return request<PortfolioOverview>("/api/portfolio");
}

export async function setPortfolioTarget(opts: { targetXlmPct?: number; driftThresholdPct?: number }): Promise<PortfolioOverview["targets"]> {
  const data = await request<{ targets: PortfolioOverview["targets"] }>("/api/portfolio/target", {
    method: "POST",
    body: JSON.stringify(opts),
  });
  return data.targets;
}

export async function recordManualTrade(trade: {
  side: 'buy' | 'sell';
  pair: string;
  amount: string;
  price: string;
  txHash: string;
}): Promise<TradeRow> {
  const data = await request<{ trade: TradeRow }>("/api/trades/manual", {
    method: "POST",
    body: JSON.stringify(trade),
  });
  return data.trade;
}

// ── Context Layer ────────────────────────────────────────────────────────────────────────────
// Mirrors backend/src/agentContext/types.ts's AgentContext shape exactly — this is a read-only
// debug/dev view of what the Context Layer currently sees for one agent, nothing more.

export interface MarketContextView {
  pair: string;
  price: number;
  oracle: { timestamp: number; ageSeconds: number };
  candles: { resolutionSeconds: number };
  trend: { ema20: number; ema50: number; sma20: number; trendStrength: number; direction: "up" | "down" | "flat" };
  momentum: { rsi: number; macdHistogram: number; roc: number };
  volatility: { atr: number; volatilityPct: number; band: "low" | "normal" | "high" };
  volume: { window24h: number; changePct: number };
  liquidity: { recentVolume: number };
  regime: { base: string; label: string; breakout: boolean; volatilityBand: "low" | "normal" | "high" };
  confidence: number;
}

export interface ManagedCapitalContextView {
  totalManagedCapital: number;
  idleCapital: number;
  deployableCapital: number;
  allocation: { xlmPct: number; usdcPct: number };
  protocolExposure: { protocolId: string; kind: string; asset: string; amount: string }[];
  realizedPnl: number;
  unrealizedPnl: number;
  pendingExecutions: { kind: "spot" | "protocol"; status: string; ageSeconds: number }[];
  confidence: number;
}

export interface PolicyContextView {
  objective: AgentRole | "unassigned";
  riskProfile: string;
  allowedAssets: string[];
  allowedProtocols: string[];
  delegationActive: boolean;
  spendingLimitPerTrade: string | null;
  minConfidence: number | null;
  positionLimit: { maxCapital: string | null };
  confidence: number;
}

export interface SystemContextView {
  oracleHealthy: boolean;
  schedulerRunning: boolean;
  priceFeedRunning: boolean;
  protocolExecutionAvailable: boolean;
  executionAvailable: boolean;
  featureFlags: Record<string, boolean>;
  confidence: number;
}

export interface HistoricalContextView {
  lastExecution: { side: "buy" | "sell"; pair: string; status: "success" | "failed"; createdAt: number } | null;
  lastDecision: { action: string; confidence: number; createdAt: number } | null;
  recentFailureCount: number;
  cooldown: { active: boolean; remainingSeconds: number };
  recentExecutionSummary: { tradeCount: number; successCount: number; failureCount: number };
  confidence: number;
}

export interface ContextQuality {
  score: number;
  level: "high" | "medium" | "low";
  domainConfidence: { market: number; capital: number; policy: number; system: number; historical: number };
}

export interface AgentContextSnapshot {
  agentId: string;
  owner: string;
  role: AgentRole | null;
  pair: string;
  meta: { version: string; timestamp: number; marketId: string; snapshotId: string; contextHash: string };
  market: MarketContextView;
  capital: ManagedCapitalContextView;
  policy: PolicyContextView;
  system: SystemContextView;
  historical: HistoricalContextView;
  validation: { ok: boolean; errors: string[] };
  status: "valid" | "invalid";
  quality: ContextQuality;
}

export async function getAgentContext(id: string, opts?: { refresh?: boolean }): Promise<AgentContextSnapshot> {
  const qs = opts?.refresh ? "?refresh=true" : "";
  const data = await request<{ context: AgentContextSnapshot }>(`/api/agents/${id}/context${qs}`);
  return data.context;
}

// ── Dashboard API (Autonomous Runtime) ──────────────────────────────────────────────────────
// Thin client for /api/dashboard/* — a passthrough over the single global AutonomousRuntime
// (status/health/metrics/start/stop/pause/resume) plus the Memory/Learning Engines, which are
// scoped per agentId. This is the same backend as everything above (mounted unauthenticated
// in index.ts), just a different router.

export type RuntimeState = "STOPPED" | "STARTING" | "RUNNING" | "PAUSED" | "STOPPING";

export interface RuntimeHeartbeat {
  status: RuntimeState;
  uptimeMs: number;
  lastExecutionAt: number | null;
  nextExecutionAt: number | null;
  executionCount: number;
  failureCount: number;
  provider: string | null;
  model: string | null;
}

export interface RuntimeHealthReport {
  runtime: "ok" | "degraded" | "down";
  scheduler: "ok" | "degraded" | "down";
  pipelineRunner: "ok" | "degraded" | "down";
  provider: "ok" | "degraded" | "down";
}

export interface EpisodicRecord {
  id: string;
  agentId: string;
  timestamp: number;
  contextRef: string;
  decisionRef: string | null;
  executionRef: string | null;
  outcome: "profit" | "loss" | "breakeven" | "pending" | string;
  pnl: number | null;
  holdingTimeSeconds: number | null;
  confidence: number;
  quality: string;
  tags: string[];
}

export interface SemanticFact {
  id: string;
  agentId: string;
  key: string;
  value: string;
}

export interface WorkingMemoryEntry {
  key: string;
  value: unknown;
}

export interface MemoryPackage {
  meta: { version: string; agentId: string; timestamp: number; packageId: string; packageHash: string };
  episodic: EpisodicRecord[];
  semantic: SemanticFact[];
  working: WorkingMemoryEntry[];
  status: "valid" | "invalid";
}

export interface LearningSnapshot {
  snapshotId: string;
  agentId: string;
  episodeCount: number;
  semanticFactCount: number;
  avgFees: { value: number; sampleCount: number } | null;
  avgSlippage: { value: number; sampleCount: number } | null;
  avgExecutionLatencyMs: { value: number; sampleCount: number } | null;
  verificationPassRate: number;
  executionDistribution: { protocol: string; fraction: number }[];
}

async function dashboardRequest<T>(path: string): Promise<T | null> {
  const res = await fetch(backendUrl(path), { headers: { "Content-Type": "application/json" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Dashboard API request failed (${res.status})`);
  return data;
}

export async function getRuntimeStatus(): Promise<RuntimeState | null> {
  const data = await dashboardRequest<{ status: RuntimeState | null }>("/api/dashboard/status");
  return data?.status ?? null;
}

export async function getRuntimeHealth(): Promise<RuntimeHealthReport | null> {
  const data = await dashboardRequest<{ health: RuntimeHealthReport | null }>("/api/dashboard/health");
  return data?.health ?? null;
}

export async function getRuntimeMetrics(): Promise<RuntimeHeartbeat | null> {
  const data = await dashboardRequest<{ metrics: RuntimeHeartbeat | null }>("/api/dashboard/metrics");
  return data?.metrics ?? null;
}

async function dashboardAction(path: string): Promise<RuntimeState | null> {
  const res = await fetch(backendUrl(path), { method: "POST", headers: { "Content-Type": "application/json" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Dashboard API request failed (${res.status})`);
  return data.status ?? null;
}

export const startRuntime = () => dashboardAction("/api/dashboard/start");
export const stopRuntime = () => dashboardAction("/api/dashboard/stop");
export const pauseRuntime = () => dashboardAction("/api/dashboard/pause");
export const resumeRuntime = () => dashboardAction("/api/dashboard/resume");

export async function getAgentMemoryPackage(agentId: string): Promise<MemoryPackage> {
  const data = await dashboardRequest<{ memory: MemoryPackage }>(`/api/dashboard/memory?agentId=${encodeURIComponent(agentId)}`);
  if (!data) throw new Error("Memory unavailable");
  return data.memory;
}

export async function getAgentLearningSnapshot(agentId: string): Promise<LearningSnapshot> {
  const data = await dashboardRequest<{ learning: LearningSnapshot }>(`/api/dashboard/learning?agentId=${encodeURIComponent(agentId)}`);
  if (!data) throw new Error("Learning snapshot unavailable");
  return data.learning;
}

export async function getAgentEpisodicHistory(agentId: string): Promise<EpisodicRecord[]> {
  const data = await dashboardRequest<{ history: EpisodicRecord[] }>(`/api/dashboard/history?agentId=${encodeURIComponent(agentId)}`);
  return data?.history ?? [];
}

// --- Hidden Developer Mode (/api/dev/*) --------------------------------------------------
// Thin typed wrappers over the backend's requireAuth+requireDev-gated dev routes (see
// backend/src/routes/dev.ts). Every call below goes through the same `request<T>` helper (and
// therefore the same Bearer token / 401-handling) as the rest of this file — no separate auth
// path. A 403 here just means the caller isn't in the server-side DEV_ALLOWLIST; callers must
// treat that as "render nothing", never as an error to surface to a normal user.

export interface DevPipelineStage {
  name: string;
  completed: boolean;
  durationMs: number | null;
  failed: boolean;
}

export interface DevPipelineSnapshot {
  success: boolean;
  startedAt: number;
  finishedAt: number;
  totalDurationMs: number;
  failureStage: string | null;
  error: string | null;
  stages: DevPipelineStage[];
}

export interface DevBenchmarkSession {
  sessionId: string;
  executionCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
}

/** Returns true only if the backend actually confirms membership in DEV_ALLOWLIST — never
 *  inferred client-side, never cached across accounts (callers should re-check on every mount /
 *  wallet switch rather than storing this as a persisted boolean). */
export async function getDeveloperModeStatus(): Promise<boolean> {
  try {
    const data = await request<{ success: boolean; enabled: boolean }>("/api/dev/status");
    return Boolean(data?.enabled);
  } catch {
    return false;
  }
}

export async function getDevRuntime(): Promise<unknown> {
  const data = await request<{ runtime: unknown }>("/api/dev/runtime");
  return data.runtime;
}

export async function getDevPipeline(): Promise<DevPipelineSnapshot | null> {
  const data = await request<{ pipeline: DevPipelineSnapshot | null }>("/api/dev/pipeline");
  return data.pipeline;
}

export async function getDevBenchmark(): Promise<{ session: DevBenchmarkSession | null; trading: unknown; pipelineLatency: unknown }> {
  return request("/api/dev/benchmark");
}

export async function devPaperStart(target?: { agentId?: string; role?: "strategic" | "yield" | "balancer" }): Promise<unknown> {
  return request("/api/dev/paper/start", { method: "POST", body: JSON.stringify(target ?? {}) });
}

export async function devPaperStop(agentId: string): Promise<unknown> {
  return request("/api/dev/paper/stop", { method: "POST", body: JSON.stringify({ agentId }) });
}

export async function devPaperPause(agentId: string): Promise<unknown> {
  return request("/api/dev/paper/pause", { method: "POST", body: JSON.stringify({ agentId }) });
}

export async function devPaperResume(agentId: string): Promise<unknown> {
  return request("/api/dev/paper/resume", { method: "POST", body: JSON.stringify({ agentId }) });
}

export async function devValidationRun(): Promise<unknown> {
  return request("/api/dev/validation/run", { method: "POST", body: JSON.stringify({}) });
}

export function devExportLogsUrl(): string {
  return backendUrl("/api/dev/export/logs");
}

export function devExportBenchmarkUrl(): string {
  return backendUrl("/api/dev/export/benchmark");
}

/** Live-tails GET /api/dev/stream (SSE). Native `EventSource` can't attach an Authorization
 *  header, and requireAuth only reads the standard header — rather than widening the backend's
 *  auth surface to accept a token query param just for this, this streams the response body via
 *  `fetch` (which *can* send the Bearer header) and parses the `data: ...\n\n` frames by hand.
 *  Returns an unsubscribe function; calls `onEvent` for each parsed audit row, `onError` once if
 *  the connection drops or never opens (e.g. 403 for a non-allowlisted caller). */
export function openDevStream(onEvent: (row: AuditLogRow) => void, onError?: () => void): () => void {
  const controller = new AbortController();
  (async () => {
    try {
      const res = await fetch(backendUrl("/api/dev/stream"), {
        headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        onError?.();
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            onEvent(JSON.parse(line.slice("data: ".length)));
          } catch {
            // Malformed frame — skip it rather than crash the stream.
          }
        }
      }
    } catch {
      if (!controller.signal.aborted) onError?.();
    }
  })();
  return () => controller.abort();
}
