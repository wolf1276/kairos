// Persistence + read API for the replayable decision log (decisions table). One row captures a
// role tick's entire reasoning chain — oracle snapshot, indicators, LLM prompt/response, chosen
// action, all three validation results, execution result, and PnL before/after — so the full
// decision history can be replayed after refresh or login. Never throws: a logging failure must
// not abort a tick.
import { randomUUID } from 'crypto';
import { getDb, type AgentRole, type DecisionRow } from './db.js';

export interface RecordDecisionInput {
  agentId: string;
  owner: string;
  role: AgentRole;
  mode: string;
  pair: string;
  marketSnapshot?: unknown;
  oracle?: unknown;
  indicators?: unknown;
  regime?: unknown;
  llmModel?: string | null;
  llmPromptSummary?: string | null;
  llmResponse?: unknown;
  action: string;
  selectedStrategy?: string | null;
  confidence: number;
  reasoning: string;
  policyValidation?: unknown;
  delegationValidation?: unknown;
  risk?: unknown;
  executionResult?: string | null;
  tradeId?: string | null;
  positionBefore?: unknown;
  positionAfter?: unknown;
  pnlBefore?: unknown;
  pnlAfter?: unknown;
}

const j = (v: unknown): string | null => (v === undefined ? null : JSON.stringify(v));

export function recordDecision(input: RecordDecisionInput): string | null {
  try {
    const row: DecisionRow = {
      id: randomUUID(),
      agent_id: input.agentId,
      owner: input.owner,
      role: input.role,
      mode: input.mode,
      pair: input.pair,
      market_snapshot_json: j(input.marketSnapshot),
      oracle_json: j(input.oracle),
      indicators_json: j(input.indicators),
      regime_json: j(input.regime),
      llm_model: input.llmModel ?? null,
      llm_prompt_summary: input.llmPromptSummary ?? null,
      llm_response_json: j(input.llmResponse),
      action: input.action,
      selected_strategy: input.selectedStrategy ?? null,
      confidence: input.confidence,
      reasoning: input.reasoning,
      policy_validation_json: j(input.policyValidation),
      delegation_validation_json: j(input.delegationValidation),
      risk_json: j(input.risk),
      execution_result: input.executionResult ?? null,
      trade_id: input.tradeId ?? null,
      position_before_json: j(input.positionBefore),
      position_after_json: j(input.positionAfter),
      pnl_before_json: j(input.pnlBefore),
      pnl_after_json: j(input.pnlAfter),
      created_at: Date.now(),
    };
    getDb()
      .prepare(
        `INSERT INTO decisions (id, agent_id, owner, role, mode, pair, market_snapshot_json, oracle_json,
          indicators_json, regime_json, llm_model, llm_prompt_summary, llm_response_json, action,
          selected_strategy, confidence, reasoning, policy_validation_json, delegation_validation_json,
          risk_json, execution_result, trade_id, position_before_json, position_after_json,
          pnl_before_json, pnl_after_json, created_at)
         VALUES (@id, @agent_id, @owner, @role, @mode, @pair, @market_snapshot_json, @oracle_json,
          @indicators_json, @regime_json, @llm_model, @llm_prompt_summary, @llm_response_json, @action,
          @selected_strategy, @confidence, @reasoning, @policy_validation_json, @delegation_validation_json,
          @risk_json, @execution_result, @trade_id, @position_before_json, @position_after_json,
          @pnl_before_json, @pnl_after_json, @created_at)`
      )
      .run(row);
    return row.id;
  } catch (error) {
    console.error('Failed to record decision:', error);
    return null;
  }
}

export function listDecisionsForAgent(agentId: string, limit = 100, before?: number): DecisionRow[] {
  const cutoff = before ?? Number.MAX_SAFE_INTEGER;
  return getDb()
    .prepare('SELECT * FROM decisions WHERE agent_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?')
    .all(agentId, cutoff, limit) as DecisionRow[];
}

export function listDecisionsForOwner(owner: string, limit = 100, before?: number): DecisionRow[] {
  const cutoff = before ?? Number.MAX_SAFE_INTEGER;
  return getDb()
    .prepare('SELECT * FROM decisions WHERE owner = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?')
    .all(owner, cutoff, limit) as DecisionRow[];
}

export function getDecision(id: string): DecisionRow | undefined {
  return getDb().prepare('SELECT * FROM decisions WHERE id = ?').get(id) as DecisionRow | undefined;
}
