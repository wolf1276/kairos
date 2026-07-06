// Thin client for the custodial agent-wallet backend (see /backend) — a separate service
// that generates/holds agent keypairs and runs their scheduled spend strategy. Unlike
// /api/delegate-sdk (a Next.js API route proxying the Kairos SDK), this talks directly to
// that standalone service over HTTP.

import type { DcaStrategyConfig, QuantStrategyConfig, LimitStrategyConfig, AgentMode, AgentRole, AgentSummary, TradeRow, PositionRow, PnlSummary, AuditEventType } from '@kairos/types';

export type { DcaStrategyConfig, QuantStrategyConfig, LimitStrategyConfig, AgentMode, AgentRole, AgentSummary, TradeRow, PositionRow, PnlSummary, AuditEventType };

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

function backendBase(): string {
  return process.env.NEXT_PUBLIC_AGENTS_BACKEND_URL || "http://localhost:4001";
}

function backendUrl(path: string): string {
  return `${backendBase()}${path}`;
}

// Set once per session by the wallet-signature login handshake (see lib/agentsAuth.ts) and
// attached to every request below — the backend derives the caller's identity from this
// token rather than trusting a client-supplied owner string.
let authToken: string | null = null;

/** Drops every cached session token (see agentsAuth.ts's `kairos:session:<publicKey>` keys) —
 *  called on a 401 so a rejected/expired token can't keep getting resent by ensureAgentAuth's
 *  cache-first check. Scans by prefix rather than taking a publicKey so it works regardless of
 *  which wallet's token was rejected. */
function clearAllStoredSessionTokens(): void {
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
  const res = await fetch(`${backendBase()}/api/strategies`, {
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
