// Stage 9: Risk. Exposure vs. risk tolerance, drawdown, volatility, liquidity.
import type { ReasoningContext } from '../../types.js';
import type { DecisionIntelligence } from '../../decisionIntelligence/types.js';
import type { RuleResult } from '../types.js';

function pass(rule: string, message: string): RuleResult {
  return { rule, stage: 'risk', passed: true, severity: 'error', message };
}
function fail(rule: string, message: string, severity: RuleResult['severity'] = 'error'): RuleResult {
  return { rule, stage: 'risk', passed: false, severity, message };
}

/** Maximum allocation fraction permitted per risk tolerance tier — independent of (and typically
 *  tighter than) the user's own maxAllocationPct, acting as a second, risk-tolerance-aware ceiling. */
export const RISK_TOLERANCE_CEILING: Record<string, number> = { low: 0.2, medium: 0.5, high: 0.8 };
export const MAX_DRAWDOWN_PCT = 30;
export const MAX_RISK_VOLATILITY_PCT = 50;
/** A trade should not consume more than this fraction of recent observed volume — a liquidity
 *  safety rail against slippage. */
export const MAX_LIQUIDITY_FRACTION = 0.5;

export function runRiskRules(decision: DecisionIntelligence, context: ReasoningContext): RuleResult[] {
  const results: RuleResult[] = [];
  const { risk, liquidity } = context.agentContext.features;
  const { primaryDecision } = decision;
  const { riskTolerance } = context.userPolicy;

  const ceiling = RISK_TOLERANCE_CEILING[riskTolerance] ?? RISK_TOLERANCE_CEILING.medium;
  results.push(primaryDecision.allocation <= ceiling
    ? pass('risk.tolerance_alignment', `Allocation ${primaryDecision.allocation} is within the '${riskTolerance}' risk tolerance ceiling (${ceiling}).`)
    : fail('risk.tolerance_alignment', `Allocation ${primaryDecision.allocation} exceeds the '${riskTolerance}' risk tolerance ceiling (${ceiling}).`));

  if (risk.drawdownPct === null) {
    results.push({ rule: 'risk.drawdown_limit', stage: 'risk', passed: false, severity: 'warning', message: 'Drawdown data is unavailable — cannot verify against the drawdown limit.' });
  } else {
    results.push(risk.drawdownPct <= MAX_DRAWDOWN_PCT
      ? pass('risk.drawdown_limit', `Current drawdown ${risk.drawdownPct}% is within the ${MAX_DRAWDOWN_PCT}% limit.`)
      : fail('risk.drawdown_limit', `Current drawdown ${risk.drawdownPct}% exceeds the ${MAX_DRAWDOWN_PCT}% limit — too risky to add exposure.`));
  }

  results.push(risk.volatilityPct <= MAX_RISK_VOLATILITY_PCT
    ? pass('risk.volatility_bounds', `Risk-domain volatility ${risk.volatilityPct}% is within the ${MAX_RISK_VOLATILITY_PCT}% limit.`)
    : fail('risk.volatility_bounds', `Risk-domain volatility ${risk.volatilityPct}% exceeds the ${MAX_RISK_VOLATILITY_PCT}% limit.`));

  const requestedCapital = primaryDecision.allocation * context.agentContext.capital.totalManagedCapital;
  // An infinite/non-finite recentVolume must never be treated as "unlimited liquidity" — that
  // would make requestedCapital/Infinity = 0, passing regardless of trade size. Found during the
  // Phase 4 final production audit.
  const volumeFinite = Number.isFinite(liquidity.recentVolume);
  const liquidityOk = volumeFinite && (liquidity.recentVolume <= 0 ? requestedCapital === 0 : requestedCapital / liquidity.recentVolume <= MAX_LIQUIDITY_FRACTION);
  results.push(liquidityOk
    ? pass('risk.liquidity_sufficient', `Requested capital ${requestedCapital.toFixed(2)} is within ${MAX_LIQUIDITY_FRACTION * 100}% of recent volume ${liquidity.recentVolume}.`)
    : fail('risk.liquidity_sufficient', `Requested capital ${requestedCapital.toFixed(2)} exceeds ${MAX_LIQUIDITY_FRACTION * 100}% of recent volume ${liquidity.recentVolume}, or volume is non-finite — liquidity risk.`));

  return results;
}
