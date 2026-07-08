// Strategy Engine — public entry point. Sits between the (frozen) Context Engine's already-
// computed FeatureSet and (frozen) Decision Intelligence: produces deterministic, quantitative
// StrategySignal[] for the LLM to *evaluate*, never invent. No AI/LLM inside this engine, no
// network/database calls, no mutation of anything outside a single evaluate() call's own return
// value — every strategy is a pure function of its StrategyInput.
//
// Adding a new strategy requires exactly one thing: implement `Strategy` and call
// `registry.register(yourStrategy)` — nothing else in this engine, or in any frozen layer,
// needs to change.
export type {
  Strategy,
  StrategyInput,
  StrategySignal,
  StrategySignalAction,
  StrategyRiskLevel,
} from './types.js';
export {
  STRATEGY_ENGINE_VERSION,
  STRATEGY_SIGNAL_ACTIONS,
  STRATEGY_RISK_LEVELS,
  StrategySignalValidationError,
  DuplicateStrategyError,
  StrategyNotFoundError,
  MalformedStrategyError,
} from './types.js';
export { StrategyRegistry } from './registry.js';
export { validateStrategySignal, assertValidStrategySignal } from './validation.js';
export { normalizeConfidence, hashStrategySignal, sha256 } from './util.js';
export { computeStrategyAnalytics, rankStrategies, buildStrategyRanking } from './analytics.js';
export type { StrategyRunRecord, StrategyAnalytics, RankedStrategy } from './analytics.js';

import { StrategyRegistry } from './registry.js';
import { emaCrossStrategy } from './strategies/emaCross.js';
import { smaCrossStrategy } from './strategies/smaCross.js';
import { rsiMeanReversionStrategy } from './strategies/rsiMeanReversion.js';
import { macdTrendStrategy } from './strategies/macdTrend.js';
import { bollingerBandsStrategy } from './strategies/bollingerBands.js';
import { momentumStrategy } from './strategies/momentum.js';
import { atrVolatilityStrategy } from './strategies/atrVolatility.js';
import { breakoutStrategy } from './strategies/breakout.js';
import { dcaStrategy } from './strategies/dca.js';
import { portfolioRebalancingStrategy } from './strategies/portfolioRebalancing.js';
import { yieldAllocationStrategy } from './strategies/yieldAllocation.js';
import { stablecoinAllocationStrategy } from './strategies/stablecoinAllocation.js';

export {
  emaCrossStrategy, EMA_CROSS_STRATEGY_ID,
} from './strategies/emaCross.js';
export {
  smaCrossStrategy, SMA_CROSS_STRATEGY_ID,
} from './strategies/smaCross.js';
export {
  rsiMeanReversionStrategy, RSI_MEAN_REVERSION_STRATEGY_ID,
} from './strategies/rsiMeanReversion.js';
export {
  macdTrendStrategy, MACD_TREND_STRATEGY_ID,
} from './strategies/macdTrend.js';
export {
  bollingerBandsStrategy, BOLLINGER_BANDS_STRATEGY_ID,
} from './strategies/bollingerBands.js';
export {
  momentumStrategy, MOMENTUM_STRATEGY_ID,
} from './strategies/momentum.js';
export {
  atrVolatilityStrategy, ATR_VOLATILITY_STRATEGY_ID,
} from './strategies/atrVolatility.js';
export {
  breakoutStrategy, BREAKOUT_STRATEGY_ID,
} from './strategies/breakout.js';
export {
  dcaStrategy, DCA_STRATEGY_ID,
} from './strategies/dca.js';
export {
  portfolioRebalancingStrategy, PORTFOLIO_REBALANCING_STRATEGY_ID,
} from './strategies/portfolioRebalancing.js';
export {
  yieldAllocationStrategy, YIELD_ALLOCATION_STRATEGY_ID,
} from './strategies/yieldAllocation.js';
export {
  stablecoinAllocationStrategy, STABLECOIN_ALLOCATION_STRATEGY_ID,
} from './strategies/stablecoinAllocation.js';

/** Builds a registry with every built-in strategy already registered. Callers that only want a
 *  subset, or want to add their own, should construct a bare `new StrategyRegistry()` and
 *  register selectively instead — this helper is purely a convenience for "give me everything
 *  built in". */
export function createDefaultStrategyRegistry(): StrategyRegistry {
  const registry = new StrategyRegistry();
  registry.register(emaCrossStrategy);
  registry.register(smaCrossStrategy);
  registry.register(rsiMeanReversionStrategy);
  registry.register(macdTrendStrategy);
  registry.register(bollingerBandsStrategy);
  registry.register(momentumStrategy);
  registry.register(atrVolatilityStrategy);
  registry.register(breakoutStrategy);
  registry.register(dcaStrategy);
  registry.register(portfolioRebalancingStrategy);
  registry.register(yieldAllocationStrategy);
  registry.register(stablecoinAllocationStrategy);
  return registry;
}
