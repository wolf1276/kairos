// Auto-provisions the three fixed autonomous role agents (yield / strategic / balancer) for a
// wallet owner. Idempotent: re-invoking returns the existing role agents rather than minting
// duplicates, so a page refresh or re-login always converges on exactly three. Each agent gets
// a RoleStrategyConfig operating envelope and (in paper mode) is started immediately.
//
// Delegation note: the current wallet_delegations model is one delegation per wallet keyed by
// the delegator, while each agent has its own key — so a single shared delegation cannot cover
// three distinct agent keys. Paper mode (the default) therefore runs without an attached
// delegation and the delegation check is advisory (see roleTick). Live mode requires a
// per-agent delegation attached explicitly before starting that agent.
import { getDb, type AgentMode, type AgentRole, type AgentRow } from './db.js';
import { createAgent, getAgent, getAgentRow, setStrategy, startAgent } from './agentService.js';
import { getRoleIntervalSeconds } from './config.js';
import { logEvent } from './auditService.js';
import type { AgentSummary, RoleStrategyConfig } from './types.js';

const ROLES: AgentRole[] = ['strategic', 'yield', 'balancer'];

// Per-role operating envelope. amountPerTrade is in stroops (7dp) — the max the role may move
// per action; the decision engine chooses whether/which direction to act.
const ROLE_DEFAULTS: Record<AgentRole, { amountPerTrade: string; minConfidence: number }> = {
  strategic: { amountPerTrade: '50000000', minConfidence: 0.55 }, // 5 XLM
  yield: { amountPerTrade: '30000000', minConfidence: 0.55 }, // 3 XLM
  balancer: { amountPerTrade: '40000000', minConfidence: 0.5 }, // 4 XLM
};

function existingRoleAgents(owner: string): Map<AgentRole, AgentRow> {
  const rows = getDb().prepare("SELECT * FROM agents WHERE owner = ? AND role IS NOT NULL").all(owner) as AgentRow[];
  const map = new Map<AgentRole, AgentRow>();
  for (const r of rows) if (r.role) map.set(r.role, r);
  return map;
}

export interface ProvisionOptions {
  mode?: AgentMode;
  capital?: string; // per-agent USD capital under management
}

export async function provisionRoleAgents(owner: string, opts?: ProvisionOptions): Promise<AgentSummary[]> {
  const mode = opts?.mode ?? 'paper';
  const capital = opts?.capital ?? '1000';
  const interval = getRoleIntervalSeconds();
  const existing = existingRoleAgents(owner);
  const summaries: AgentSummary[] = [];

  for (const role of ROLES) {
    let row = existing.get(role);
    if (!row) {
      const created = await createAgent(owner, { mode, capital, role });
      const defaults = ROLE_DEFAULTS[role];
      const config: RoleStrategyConfig = {
        type: 'role',
        role,
        pair: 'XLM/USDC',
        amountPerTrade: defaults.amountPerTrade,
        intervalSeconds: interval,
        minConfidence: defaults.minConfidence,
        destination: '',
      };
      setStrategy(created.id, config);
      logEvent({
        agentId: created.id,
        owner,
        eventType: 'agent_provisioned',
        mode,
        strategyId: 'role',
        mpcAccount: created.publicKey,
        message: `Provisioned ${role} agent`,
      });
      // Paper mode has no funds at risk — start it ticking immediately. Live mode waits for a
      // delegation to be attached and started explicitly.
      if (mode === 'paper') startAgent(created.id);
      row = getAgentRow(created.id)!;
    }
    summaries.push(getAgent(row.id)!);
  }

  return summaries;
}
