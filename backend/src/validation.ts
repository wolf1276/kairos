// Pre-execution validation pipeline shared by every autonomous role tick (see roleTick.ts).
// Ordered exactly as the required execution pipeline: policy → delegation → risk. Each stage
// returns a structured result (persisted into the decision + audit trail), and the first
// failing stage aborts execution before any funds move.
import { getActiveDelegationForAgent } from './agentService.js';
import type { AgentRow } from './db.js';
import type { AgentDecision, MarketContext, RoleStrategyConfig } from './types.js';

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export interface RiskResult extends ValidationResult {
  metrics: {
    volatilityPct: number;
    confidence: number;
    minConfidence: number;
    maxTradeStroops: string;
    drawdownPct: number | null;
  };
}

/** Circuit-breaker ceiling: once an agent's cumulative loss (realized + unrealized, against its
 *  allocated capital) exceeds this fraction, every subsequent trade is blocked until an operator
 *  intervenes (adjusts capital or stops/restarts the agent) — an agent must not be able to bleed
 *  out its entire allocation unattended just because each individual tick still clears the
 *  volatility/confidence bars. */
const MAX_DRAWDOWN_PCT = 20;

/** Policy check: the decision must clear the agent's minimum confidence and name a concrete,
 *  executable action. HOLD is always policy-valid (it just means "do nothing this tick"). */
export function validatePolicy(config: RoleStrategyConfig, decision: AgentDecision): ValidationResult {
  if (decision.action === 'hold') return { ok: true };
  if (decision.confidence < config.minConfidence) {
    return { ok: false, reason: `Confidence ${decision.confidence.toFixed(2)} below policy minimum ${config.minConfidence}` };
  }
  if (BigInt(config.amountPerTrade) <= 0n) {
    return { ok: false, reason: 'Per-trade size is zero — nothing to execute' };
  }
  return { ok: true };
}

/** Delegation check: a live, non-disabled wallet delegation must back the agent. In paper mode
 *  this is advisory (no real funds move) but is still recorded so the audit trail is identical
 *  across modes. */
export function validateDelegation(row: AgentRow): ValidationResult {
  const delegation = getActiveDelegationForAgent(row);
  if (!delegation) {
    return { ok: false, reason: 'No active delegation — revoked, paused, or never attached' };
  }
  return { ok: true };
}

/** Risk check: block execution in extreme volatility, on low-confidence non-hold actions, or
 *  once cumulative loss against allocated capital breaches the drawdown circuit breaker —
 *  and surface the metrics that informed the call. */
export function riskChecks(
  config: RoleStrategyConfig,
  decision: AgentDecision,
  ctx: MarketContext,
  cumulativePnl?: { capital: string | null; realizedPnl: string; unrealizedPnl: string }
): RiskResult {
  const capital = cumulativePnl?.capital ? parseFloat(cumulativePnl.capital) : null;
  const drawdownPct =
    capital && capital > 0 && cumulativePnl
      ? ((parseFloat(cumulativePnl.realizedPnl) + parseFloat(cumulativePnl.unrealizedPnl)) / capital) * 100
      : null;
  const metrics = {
    volatilityPct: ctx.regime.volatilityPct,
    confidence: decision.confidence,
    minConfidence: config.minConfidence,
    maxTradeStroops: config.amountPerTrade,
    drawdownPct,
  };
  if (decision.action === 'hold') return { ok: true, metrics };
  // A hard circuit breaker: never trade into a market whipsawing beyond this band.
  if (ctx.regime.volatilityPct > 12) {
    return { ok: false, reason: `Volatility ${ctx.regime.volatilityPct.toFixed(1)}% exceeds 12% risk ceiling`, metrics };
  }
  // A hard circuit breaker: stop trading once cumulative loss against allocated capital breaches
  // the ceiling — this blocks every subsequent tick (not just this one) since neither capital nor
  // realized loss shrinks back on its own, until the operator intervenes.
  if (drawdownPct !== null && drawdownPct < -MAX_DRAWDOWN_PCT) {
    return {
      ok: false,
      reason: `Cumulative loss ${drawdownPct.toFixed(1)}% of capital exceeds ${MAX_DRAWDOWN_PCT}% drawdown ceiling — agent halted pending review`,
      metrics,
    };
  }
  return { ok: true, metrics };
}
