// Policy Context domain — the business rules the AI is allowed to operate under. Sourced from
// the agent's own strategy config + delegation state; exposes only business rules (objective,
// risk profile, limits, allowed protocols/assets), never the underlying delegation object,
// signatures, or wallet addresses.
import { isProtocolExecutionEnabled } from '../../config.js';
import type { AgentRow, AgentRole } from '../../db.js';
import type { RoleStrategyConfig } from '../../types.js';
import type { FeatureBuildResult } from '../featureEngine.js';

export interface PolicyContextView {
  objective: AgentRole | 'unassigned';
  riskProfile: string;
  allowedAssets: string[];
  allowedProtocols: string[];
  delegationActive: boolean;
  spendingLimitPerTrade: string | null;
  minConfidence: number | null;
  positionLimit: {
    maxCapital: string | null;
  };
  /** 0-1 — how complete/authoritative this domain's rules are: a role with a parsed strategy
   *  config and an active delegation is fully authoritative; anything missing lowers confidence
   *  since a future agent would be reasoning against an incomplete rule set. */
  confidence: number;
}

/** role assigned (0.4) + strategy config present (0.3) + delegation active (0.3) — each missing
 *  piece means the policy this domain reports is partial, not fully authoritative. */
function policyConfidence(hasRole: boolean, hasConfig: boolean, delegationActive: boolean): number {
  return (hasRole ? 0.4 : 0) + (hasConfig ? 0.3 : 0) + (delegationActive ? 0.3 : 0);
}

function parseStrategyConfig(row: AgentRow): RoleStrategyConfig | null {
  if (!row.strategy_config_json) return null;
  try {
    const parsed = JSON.parse(row.strategy_config_json);
    return parsed?.type === 'role' ? (parsed as RoleStrategyConfig) : null;
  } catch {
    return null;
  }
}

function allowedAssetsForPair(pair: string): string[] {
  return pair.split('/').filter(Boolean);
}

function allowedProtocolsForRole(role: AgentRole | null): string[] {
  if (role !== 'yield') return [];
  return isProtocolExecutionEnabled() ? ['blend'] : [];
}

export function buildPolicyContextView(agentRow: AgentRow, result: FeatureBuildResult): PolicyContextView {
  const config = parseStrategyConfig(agentRow);
  const delegationActive = result.featureSet.wallet.delegationActive;
  return {
    objective: agentRow.role ?? 'unassigned',
    riskProfile: agentRow.risk_level ?? 'unspecified',
    allowedAssets: allowedAssetsForPair(config?.pair ?? result.featureSet.pair),
    allowedProtocols: allowedProtocolsForRole(agentRow.role),
    delegationActive,
    spendingLimitPerTrade: config?.amountPerTrade ?? null,
    minConfidence: config?.minConfidence ?? null,
    positionLimit: {
      maxCapital: agentRow.capital,
    },
    confidence: policyConfidence(agentRow.role !== null, config !== null, delegationActive),
  };
}
