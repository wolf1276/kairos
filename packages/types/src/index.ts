// ── Strategy configs ──

export interface DcaStrategyConfig {
  type: 'dca';
  token: string;
  amountPerTick: string;
  intervalSeconds: number;
  destination: string;
}

export interface QuantStrategyConfig {
  type: 'quant';
  strategyId: string;
  pair: string;
  amountPerTrade: string;
  intervalSeconds: number;
  destination: string;
}

export interface LimitStrategyConfig {
  type: 'limit';
  pair: string;
  asset: 'XLM' | 'USDC';
  side: 'buy' | 'sell';
  quantity: string;
  triggerComparator: 'lte' | 'gte';
  triggerPrice: string;
  intervalSeconds: number;
  destination: string;
}

export interface RoleStrategyConfig {
  type: 'role';
  role: 'yield' | 'strategic' | 'balancer';
  pair: string;
  amountPerTrade: string;
  intervalSeconds: number;
  minConfidence: number;
  destination: string;
}

export type StrategyConfig = DcaStrategyConfig | QuantStrategyConfig | LimitStrategyConfig | RoleStrategyConfig;

// ── Agent ──

export type AgentMode = 'paper' | 'live';
export type AgentRole = 'yield' | 'strategic' | 'balancer';
export type AgentStatus = 'new' | 'running' | 'stopped' | 'error';

/** Permissions + safety limits the user approves in the Agent Creation wizard's "Permissions"
 *  and "Capital & Safety" steps (agentcreation.md §4/§3). Stored on the agent and returned in
 *  AgentSummary so it's no longer collected in the UI and silently discarded — see
 *  backend/src/routes/agents.ts POST / and POST /:id/policy. */
export interface AgentPolicy {
  capabilities: {
    swap: boolean;
    yield: boolean;
    rebalance: boolean;
    dca: boolean;
    holdStable: boolean;
    borrow: boolean;
    leverage: boolean;
  };
  maxAllocationPct: number;
  maxDailyTrades: number;
  maxSlippagePct: number;
}

export interface AgentSummary {
  id: string;
  owner: string;
  publicKey: string;
  role: AgentRole | null;
  status: AgentStatus;
  delegationHash: string | null;
  delegator: string | null;
  strategy: StrategyConfig | null;
  lastTickAt: number | null;
  lastResult: string | null;
  lastError: string | null;
  createdAt: number;
  mode: AgentMode;
  capital: string | null;
  riskLevel: string | null;
  startedAt: number | null;
  policy: AgentPolicy | null;
}

// ── Trades ──

export type TradeSide = 'buy' | 'sell';
export type TradeStatus = 'success' | 'failed';

export interface TradeRow {
  id: string;
  agent_id: string;
  strategy_id: string;
  side: TradeSide;
  pair: string;
  amount: string;
  price: string;
  tx_hash: string | null;
  status: TradeStatus;
  realized_pnl: string | null;
  reversed_trade_id: string | null;
  created_at: number;
  mode: AgentMode;
}

// ── Positions ──

export type PositionSide = 'long';

export interface PositionRow {
  id: string;
  agent_id: string;
  pair: string;
  side: PositionSide;
  open_amount: string;
  avg_cost: string;
  realized_pnl_total: string;
  updated_at: number;
}

// ── Audit ──

export type AuditEventType =
  | 'strategy_started'
  | 'strategy_stopped'
  | 'strategy_error'
  | 'signal_generated'
  | 'policy_violation'
  | 'delegation_invalid'
  | 'trade_executed'
  | 'position_updated'
  | 'agent_provisioned'
  | 'market_analysis'
  | 'decision_made'
  | 'strategy_selected'
  | 'yield_opportunity'
  | 'portfolio_rebalanced'
  | 'policy_check'
  | 'delegation_check'
  | 'risk_check'
  | 'trade_opened'
  | 'trade_closed';

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
  message: string;
  created_at: number;
}

// ── Decisions ──

export interface DecisionRecord {
  id: string;
  agent_id: string;
  owner: string;
  role: string;
  mode: string;
  pair: string;
  market_snapshot_json: string;
  oracle_json: string;
  indicators_json: string;
  regime_json: string;
  llm_model: string | null;
  llm_prompt_summary: string | null;
  llm_response_json: string | null;
  action: string;
  selected_strategy: string | null;
  confidence: number;
  reasoning: string;
  policy_validation_json: string;
  delegation_validation_json: string;
  risk_json: string;
  execution_result: string;
  trade_id: string | null;
  position_before_json: string | null;
  position_after_json: string | null;
  pnl_before_json: string | null;
  pnl_after_json: string | null;
  created_at: number;
}

// ── Performance ──

export interface PerformanceSnapshot {
  id: string;
  agent_id: string;
  owner: string;
  realized_pnl: string;
  unrealized_pnl: string;
  open_position: string;
  trade_count: number;
  win_rate: number;
  capital_managed: string;
  created_at: number;
}

// ── Delegation ──

export interface JsonSafeDelegation {
  delegate: string;
  delegator: string;
  authority: string;
  caveats: { enforcer: string; terms: number[] }[];
  salt: string;
  nonce: string;
  signature: string;
}

// ── P&L ──

export interface PnlSummary {
  realizedPnl: string;
  unrealizedPnl: string;
  openPosition: string;
}

// ── Yield ──

export interface YieldVenue {
  name: string;
  apy: number;
  tvl: number;
  risk: 'low' | 'medium' | 'high';
}

// ── Portfolio ──

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

// ── Dashboard ──

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

// ── Agent Creation: Intent Parser (see agentcreation.md) ──
// Single schema shared by the backend Intent Parser (source of truth) and the frontend
// wizard (thin client) — one AgentSpec shape, no duplicate parsing schemas.

export const RISK_LEVELS = ['conservative', 'balanced', 'aggressive'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const EXECUTION_STYLES = ['autonomous', 'guided'] as const;
export type ExecutionStyle = (typeof EXECUTION_STYLES)[number];

/** The editable Agent Specification shown/edited in Step 2 of the wizard. Every field the user
 *  sees must trace back to something the model actually said (or the user's own text) — never a
 *  default invented here. */
export interface AgentSpec {
  mission: string;
  objective: string;
  riskLevel: RiskLevel;
  suggestedCapital: string | null;
  executionStyle: ExecutionStyle;
  confidence: number;
}

export interface IntentParseResult {
  status: 'ok' | 'needs_clarification' | 'failed';
  spec: AgentSpec | null;
  /** Populated when status !== 'ok'. Never fabricated — these are the model's own follow-up
   *  questions (or, for 'failed', a description of why parsing could not proceed). */
  clarifyingQuestions: string[];
  error?: string;
}
