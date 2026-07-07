// Deterministic fee/slippage/balance/state-change estimation — arithmetic only, no oracle call,
// no blockchain simulation. "Estimated" means computed from a documented formula over
// AgentContext fields already in hand, not a live quote.
import type { ReasoningContext } from '../types.js';
import type { PrimaryDecision } from '../decisionIntelligence/types.js';
import type { FeeEstimate, SlippageEstimate, BalanceChange, StateChange } from './types.js';

/** Flat protocol fee rate (10 bps) — a documented, tunable constant, not a live quote. */
export const PROTOCOL_FEE_RATE = 0.001;
/** Slippage estimate coefficient: slippagePct = (requestedCapital / recentVolume) * COEFFICIENT,
 *  clamped to [0, MAX_SLIPPAGE_PCT]. Purely a function of trade size vs. observed recent volume. */
export const SLIPPAGE_COEFFICIENT = 50;
export const MAX_SLIPPAGE_PCT = 25;

export function estimateFee(primaryDecision: PrimaryDecision, context: ReasoningContext): FeeEstimate {
  const requestedCapital = primaryDecision.allocation * context.agentContext.capital.totalManagedCapital;
  const fee = Number.isFinite(requestedCapital) ? requestedCapital * PROTOCOL_FEE_RATE : 0;
  return {
    protocol: primaryDecision.protocol,
    estimatedFee: fee.toFixed(6),
    feeAsset: primaryDecision.asset,
    basis: `flat ${PROTOCOL_FEE_RATE * 100}% of requested capital`,
  };
}

export function estimateSlippage(primaryDecision: PrimaryDecision, context: ReasoningContext): SlippageEstimate {
  const requestedCapital = primaryDecision.allocation * context.agentContext.capital.totalManagedCapital;
  const recentVolume = context.agentContext.features.liquidity.recentVolume;
  let pct = 0;
  if (Number.isFinite(requestedCapital) && Number.isFinite(recentVolume) && recentVolume > 0) {
    pct = Math.min(MAX_SLIPPAGE_PCT, (requestedCapital / recentVolume) * SLIPPAGE_COEFFICIENT);
  } else if (requestedCapital > 0) {
    pct = MAX_SLIPPAGE_PCT; // no reliable volume data — assume worst case rather than zero
  }
  return {
    asset: primaryDecision.asset,
    estimatedSlippagePct: Math.round(pct * 100) / 100,
    basis: `(requestedCapital / recentVolume) * ${SLIPPAGE_COEFFICIENT}, capped at ${MAX_SLIPPAGE_PCT}%`,
  };
}

/** Two-asset portfolio model (matches AgentContext.features.portfolio's own xlmPct/usdcPct
 *  shape) — a documented limitation, not a bug: this codebase's portfolio fixtures are XLM/USDC
 *  throughout, and a genuinely N-asset portfolio model would require extending AgentContext,
 *  which is frozen this phase. */
function currentHoldingFraction(asset: string, portfolio: ReasoningContext['agentContext']['features']['portfolio']): number {
  if (asset.toUpperCase() === 'XLM') return portfolio.xlmPct / 100;
  if (asset.toUpperCase() === 'USDC') return portfolio.usdcPct / 100;
  return 0;
}

export function estimateBalanceChanges(primaryDecision: PrimaryDecision, context: ReasoningContext): BalanceChange[] {
  const { portfolio } = context.agentContext.features;
  const { totalManagedCapital } = context.agentContext.capital;
  const currentFraction = currentHoldingFraction(primaryDecision.asset, portfolio);
  const before = currentFraction * totalManagedCapital;

  let after = before;
  if (primaryDecision.action === 'DEPOSIT') after = before + primaryDecision.allocation * totalManagedCapital;
  else if (primaryDecision.action === 'WITHDRAW') after = before - primaryDecision.allocation * totalManagedCapital;
  else if (primaryDecision.action === 'REBALANCE' || primaryDecision.action === 'SWAP') after = primaryDecision.allocation * totalManagedCapital;
  // HOLD: after === before (no change).

  return [{ asset: primaryDecision.asset, before: before.toFixed(6), after: after.toFixed(6), delta: (after - before).toFixed(6) }];
}

export function estimateStateChanges(primaryDecision: PrimaryDecision, context: ReasoningContext): StateChange[] {
  const { protocolExposure } = context.agentContext.capital;
  const hadExposure = protocolExposure.some((e) => e.protocolId === primaryDecision.protocol);
  return [
    {
      field: `protocolExposure.${primaryDecision.protocol}`,
      before: hadExposure ? 'present' : 'absent',
      after: primaryDecision.action === 'HOLD' ? (hadExposure ? 'present' : 'absent') : 'present',
    },
    {
      field: 'portfolio.driftPct',
      before: String(context.agentContext.features.portfolio.driftPct),
      after: primaryDecision.action === 'HOLD' ? String(context.agentContext.features.portfolio.driftPct) : 'recalculated_post_execution',
    },
  ];
}
