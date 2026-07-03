// Thin client for the custodial agent-wallet backend (see /backend) — a separate service
// that generates/holds agent keypairs and runs their scheduled spend strategy. Unlike
// /api/delegate-sdk (a Next.js API route proxying the Kairos SDK), this talks directly to
// that standalone service over HTTP.

export interface DcaStrategyConfig {
  type: "dca";
  token: string;
  amountPerTick: string;
  intervalSeconds: number;
  /** Always forced server-side to the delegation's delegator — see backend/src/agentService.ts. */
  destination: string;
}

export interface QuantStrategyConfig {
  type: "quant";
  strategyId: string;
  pair: string;
  amountPerTrade: string;
  intervalSeconds: number;
  /** Always forced server-side to the delegation's delegator — see backend/src/agentService.ts. */
  destination: string;
}

export interface LimitStrategyConfig {
  type: "limit";
  pair: string;
  asset: "XLM" | "USDC";
  side: "buy" | "sell";
  quantity: string;
  triggerComparator: "lte" | "gte";
  triggerPrice: string;
  intervalSeconds: number;
  /** Always forced server-side to the delegation's delegator — see backend/src/agentService.ts. */
  destination: string;
}

export type StrategyConfig = DcaStrategyConfig | QuantStrategyConfig | LimitStrategyConfig;

export interface StrategyMeta {
  id: string;
  name: string;
  category: string;
  description: string;
}

export interface TradeRow {
  id: string;
  agent_id: string;
  strategy_id: string;
  side: "buy" | "sell";
  pair: string;
  amount: string;
  price: string;
  tx_hash: string | null;
  status: "success" | "failed";
  realized_pnl: string | null;
  reversed_trade_id: string | null;
  created_at: number;
}

export interface PnlSummary {
  realizedPnl: string;
  unrealizedPnl: string;
  openPosition: string;
}

export type AgentMode = "paper" | "live";

export interface AgentSummary {
  id: string;
  owner: string;
  publicKey: string;
  status: "new" | "running" | "stopped" | "error";
  delegationHash: string | null;
  /** The smart wallet this agent is authorized to spend from — set once a delegation is attached. */
  delegator: string | null;
  strategy: StrategyConfig | null;
  lastTickAt: number | null;
  lastResult: string | null;
  lastError: string | null;
  createdAt: number;
  /** Set at creation, immutable — switch to live by creating a new agent, not by mutating a running one. */
  mode: AgentMode;
  capital: string | null;
  riskLevel: string | null;
  startedAt: number | null;
}

export interface PositionRow {
  id: string;
  agent_id: string;
  pair: string;
  side: "long";
  open_amount: string;
  avg_cost: string;
  realized_pnl_total: string;
  updated_at: number;
}

export type AuditEventType =
  | "strategy_started"
  | "strategy_stopped"
  | "strategy_error"
  | "signal_generated"
  | "policy_violation"
  | "delegation_invalid"
  | "trade_executed"
  | "position_updated";

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
    if (res.status === 401) authToken = null;
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

export async function getAgentWallet(id: string): Promise<AgentSummary> {
  const data = await request<{ agent: AgentSummary }>(`/api/agents/${id}`);
  return data.agent;
}

export async function attachAgentDelegation(id: string, delegation: unknown): Promise<AgentSummary> {
  const data = await request<{ agent: AgentSummary }>(`/api/agents/${id}/delegation`, {
    method: "POST",
    body: JSON.stringify({ delegation }),
  });
  return data.agent;
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
