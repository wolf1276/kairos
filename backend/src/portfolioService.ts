// Portfolio aggregation across an owner's autonomous role agents. Values open XLM positions at
// the live price and treats undeployed managed capital as the USDC (idle) leg, producing the
// current allocation the Portfolio Balancer and Yield agents reason against. Targets/drift live
// in portfolio_state (get/upsert in db.ts).
import { getDb, getPortfolioState, type AgentRow } from './db.js';
import { listPositionsForOwner } from './positionService.js';

export interface PortfolioAllocation {
  xlmValue: number;
  usdcValue: number;
  totalValue: number;
  xlmPct: number;
  usdcPct: number;
  idleUsd: number;
  xlmAmount: number;
}

export interface PortfolioTargets {
  xlmPct: number;
  usdcPct: number;
  driftThresholdPct: number;
}

function ownerRoleAgents(owner: string): AgentRow[] {
  return getDb().prepare("SELECT * FROM agents WHERE owner = ? AND role IS NOT NULL").all(owner) as AgentRow[];
}

/** Total capital placed under management across the owner's role agents (USD). */
export function managedCapitalUsd(owner: string): number {
  return ownerRoleAgents(owner).reduce((s, a) => s + (a.capital ? parseFloat(a.capital) : 0), 0);
}

export function computeAllocation(owner: string, price: number): PortfolioAllocation {
  const positions = listPositionsForOwner(owner);
  let xlmAmount = 0;
  let deployedCost = 0;
  for (const p of positions) {
    const amt = parseFloat(p.open_amount);
    xlmAmount += amt;
    deployedCost += amt * parseFloat(p.avg_cost);
  }
  const xlmValue = xlmAmount * price;
  const totalCapital = managedCapitalUsd(owner);
  // Idle (USDC) leg = managed capital not currently deployed into XLM. Fall back to XLM value
  // alone when no capital figure is configured, so pct math still works.
  const usdcValue = Math.max(totalCapital - deployedCost, 0);
  const totalValue = xlmValue + usdcValue || xlmValue || 1;
  return {
    xlmValue,
    usdcValue,
    totalValue,
    xlmPct: (xlmValue / totalValue) * 100,
    usdcPct: (usdcValue / totalValue) * 100,
    idleUsd: usdcValue,
    xlmAmount,
  };
}

export function getTargets(owner: string): PortfolioTargets {
  const row = getPortfolioState(owner);
  return {
    xlmPct: row?.target_xlm_pct ?? 50,
    usdcPct: row?.target_usdc_pct ?? 50,
    driftThresholdPct: row?.drift_threshold_pct ?? 10,
  };
}
