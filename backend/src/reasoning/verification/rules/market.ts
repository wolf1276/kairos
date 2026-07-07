// Stage 5: Market. Stale data, oracle freshness, volatility limits.
import type { ReasoningContext } from '../../types.js';
import type { DecisionIntelligence } from '../../decisionIntelligence/types.js';
import type { RuleResult } from '../types.js';

function pass(rule: string, message: string): RuleResult {
  return { rule, stage: 'market', passed: true, severity: 'error', message };
}
function fail(rule: string, message: string, severity: RuleResult['severity'] = 'error'): RuleResult {
  return { rule, stage: 'market', passed: false, severity, message };
}

/** Oracle price data older than this is considered stale. */
export const MAX_ORACLE_AGE_SECONDS = 300;
/** AgentContext built longer ago than this is considered stale — verifying against an old
 *  snapshot of the world is unsafe regardless of how fresh the oracle itself claims to be. */
export const MAX_CONTEXT_AGE_MS = 5 * 60 * 1000;
/** Hard volatility ceiling — a safety rail independent of any policy setting. */
export const MAX_VOLATILITY_PCT = 50;

export function runMarketRules(_decision: DecisionIntelligence, context: ReasoningContext, now: number = Date.now()): RuleResult[] {
  const results: RuleResult[] = [];
  const { system, market, builtAt, features } = context.agentContext;

  results.push(system.oracleHealthy
    ? pass('market.oracle_healthy', 'Oracle is reporting healthy.')
    : fail('market.oracle_healthy', 'Oracle is not healthy — market data cannot be trusted.'));

  const oracleFresh = market.oracle.ageSeconds <= MAX_ORACLE_AGE_SECONDS;
  results.push(oracleFresh
    ? pass('market.oracle_fresh', `Oracle data is ${market.oracle.ageSeconds}s old (<= ${MAX_ORACLE_AGE_SECONDS}s).`)
    : fail('market.oracle_fresh', `Oracle data is ${market.oracle.ageSeconds}s old, exceeding the ${MAX_ORACLE_AGE_SECONDS}s freshness limit.`));

  const contextAgeMs = now - builtAt;
  const contextFresh = contextAgeMs <= MAX_CONTEXT_AGE_MS;
  results.push(contextFresh
    ? pass('market.context_not_stale', `AgentContext was built ${contextAgeMs}ms ago (<= ${MAX_CONTEXT_AGE_MS}ms).`)
    : fail('market.context_not_stale', `AgentContext was built ${contextAgeMs}ms ago, exceeding the ${MAX_CONTEXT_AGE_MS}ms staleness limit.`));

  const volatilityOk = features.volatility.volatilityPct <= MAX_VOLATILITY_PCT;
  results.push(volatilityOk
    ? pass('market.volatility_within_limits', `Volatility ${features.volatility.volatilityPct}% is within the ${MAX_VOLATILITY_PCT}% hard limit.`)
    : fail('market.volatility_within_limits', `Volatility ${features.volatility.volatilityPct}% exceeds the ${MAX_VOLATILITY_PCT}% hard limit.`));

  return results;
}
