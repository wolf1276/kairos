// Builds the deterministic RetrievalQuery from an AgentContext. Pure function, no I/O — the
// only place Phase 2 reaches into AgentContext's shape, so a future AgentContext change only
// requires updating this one file.
import type { AgentContext } from '../../agentContext/types.js';
import type { RetrievalQuery } from './types.js';

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeList(values: readonly string[]): string[] {
  return values.map(normalize).filter((v) => v.length > 0);
}

export function buildRetrievalQuery(context: AgentContext, now?: number): RetrievalQuery {
  const regime = normalize(context.regime.label);
  const assets = normalizeList(context.policy.allowedAssets);
  const protocols = normalizeList(context.policy.allowedProtocols);
  const objective = normalize(context.policy.objective);
  const riskProfile = normalize(context.policy.riskProfile);

  const tagSet = new Set<string>();
  if (regime) tagSet.add(regime);
  for (const asset of assets) tagSet.add(asset);
  for (const protocol of protocols) tagSet.add(protocol);
  if (objective) tagSet.add(objective);
  if (riskProfile) tagSet.add(riskProfile);

  return {
    agentId: context.agentId,
    regime,
    assets,
    protocols,
    objective,
    riskProfile,
    tags: [...tagSet].sort(),
    now: now ?? context.meta.timestamp,
  };
}
