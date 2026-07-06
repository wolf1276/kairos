// Orchestration for the three autonomous role agents. Each tick runs the full required
// pipeline exactly once:
//
//   Live Oracle → Agent Analysis → LLM Decision → Policy Validation → Delegation Validation
//   → Risk Checks → Execute → Update Positions → Audit Log (+ Decision record) → Live UI (SSE)
//
// Everything after the decision is shared across roles (validate → execute → persist), so the
// three roles differ only in (a) which decision function they call and (b) how that decision
// maps to a concrete trade side. Reuses the existing executors, tradeService, positionService,
// pnl, auditService — no duplicate execution paths.
import type { AgentRow } from './db.js';
import type { AgentDecision, MarketContext, RoleStrategyConfig } from './types.js';
import { recordTick } from './agentService.js';
import { buildMarketContext, decideBalancer, decideStrategic, decideYield } from './decisionEngine.js';
import { riskChecks, validateDelegation, validatePolicy } from './validation.js';
import { computePnlSummary } from './pnl.js';
import { getPosition } from './positionService.js';
import { computeAllocation, getTargets } from './portfolioService.js';
import { snapshotPerformance } from './performanceService.js';
import { recordDecision } from './decisionService.js';
import { logEvent } from './auditService.js';
import { executeQuantTrade } from './tick.js';
import { executePaperQuantTrade } from './paperExecutor.js';
import { mapThrownError } from './errors.js';
import { recordCompletedTrade } from './executionEngine.js';
import { openExecution, markBroadcast, markRecorded } from './executionJournal.js';
import { executeProtocolAction } from './protocolExecutionService.js';
import { isProtocolExecutionEnabled } from './config.js';
import { BLEND_TESTNET_ASSETS } from '@wolf1276/kairos-sdk';

/** stroops (integer string) → decimal asset units string, matching tick.ts's convention. */
function stroopsToAmount(stroops: string): string {
  const s = BigInt(stroops);
  return `${s / 10_000_000n}.${(s % 10_000_000n).toString().padStart(7, '0')}`;
}

export async function runRoleTick(row: AgentRow, config: RoleStrategyConfig): Promise<void> {
  try {
    // 1. Live oracle → 2. analysis (indicators + regime bundled into the context).
    const ctx = await buildMarketContext(config.pair, config.intervalSeconds);
    if (!ctx) {
      recordTick(row.id, { ok: true, message: 'Waiting for sufficient market data' });
      return;
    }
    logEvent({
      agentId: row.id,
      owner: row.owner,
      eventType: 'market_analysis',
      mode: row.mode,
      strategyId: config.role,
      mpcAccount: row.public_key,
      pair: config.pair,
      marketSnapshot: { price: ctx.price, change24h: ctx.change24h },
      indicators: ctx.indicators,
      message: `${config.role}: ${ctx.regime.regime} @ ${ctx.price.toFixed(5)} (vol ${ctx.regime.volatilityPct.toFixed(1)}%)`,
    });

    // 3. LLM decision (role-specific) → mapped to a concrete trade side (or none).
    const { decision, side } = await decideForRole(row, config, ctx);

    logEvent({
      agentId: row.id,
      owner: row.owner,
      eventType: decision.selectedStrategy ? 'strategy_selected' : decision.yieldVenue ? 'yield_opportunity' : 'decision_made',
      mode: row.mode,
      strategyId: decision.selectedStrategy ?? config.role,
      mpcAccount: row.public_key,
      pair: config.pair,
      signal: decision.action,
      message: `${config.role}: ${decision.action}${decision.selectedStrategy ? ` via ${decision.selectedStrategy}` : ''} (conf ${decision.confidence.toFixed(2)}) — ${decision.reasoning.slice(0, 140)}`,
    });

    const pnlBefore = computePnlSummary(row.id, config.pair, ctx.price);
    const positionBefore = getPosition(row.id, config.pair) ?? null;

    // 4–6. Validation pipeline: policy → delegation → risk.
    const policy = validatePolicy(config, decision);
    logEvent({ agentId: row.id, owner: row.owner, eventType: 'policy_check', mode: row.mode, mpcAccount: row.public_key, pair: config.pair, policyValidation: policy, message: `Policy ${policy.ok ? 'passed' : `blocked: ${policy.reason}`}` });

    const delegation = validateDelegation(row);
    // Paper mode carries no funds at risk, so a missing delegation is advisory, not blocking.
    const delegationBlocks = !delegation.ok && row.mode === 'live';
    logEvent({ agentId: row.id, owner: row.owner, eventType: 'delegation_check', mode: row.mode, mpcAccount: row.public_key, pair: config.pair, delegationValidation: delegation, message: `Delegation ${delegation.ok ? 'active' : `${row.mode === 'live' ? 'MISSING' : 'advisory'}: ${delegation.reason}`}` });

    const risk = riskChecks(config, decision, ctx, { capital: row.capital, realizedPnl: pnlBefore.realizedPnl, unrealizedPnl: pnlBefore.unrealizedPnl });
    logEvent({ agentId: row.id, owner: row.owner, eventType: 'risk_check', mode: row.mode, mpcAccount: row.public_key, pair: config.pair, message: `Risk ${risk.ok ? 'passed' : `blocked: ${risk.reason}`}` });

    const willExecute = side !== null && policy.ok && !delegationBlocks && risk.ok;

    // The yield role's reallocation deploys idle capital into a real protocol (Blend deposit)
    // rather than a spot buy, when protocol execution is turned on for live agents. Paper mode
    // and the strategic/balancer roles are untouched — they have no real protocol venue mapped
    // yet (see decisionEngine.ts's simulated yield venues), so they keep using the legacy
    // spot-trade path exactly as before.
    const useProtocolExecution = config.role === 'yield' && row.mode === 'live' && isProtocolExecutionEnabled();

    let tradeId: string | null = null;
    let executionResult: string;
    let positionAfter = positionBefore;
    let pnlAfter = pnlBefore;

    if (willExecute && side && useProtocolExecution) {
      // Blend deposit sizing reuses the same base-unit amount the legacy spot-buy path would
      // have used for this agent (config.amountPerTrade), rather than inventing a new sizing
      // rule — see stroopsToAmount's doc for the base-unit convention this assumes.
      const result = await executeProtocolAction(row, {
        protocolId: 'blend',
        action: 'deposit',
        asset: BLEND_TESTNET_ASSETS.USDC,
        amount: BigInt(config.amountPerTrade),
      });
      // executeProtocolAction already journals (protocol_execution_journal), applies the
      // position delta, and audit-logs internally — nothing further to record here. The spot
      // pair position/PnL are untouched by a protocol deposit, so positionAfter/pnlAfter stay
      // at their pre-tick values.
      executionResult = result.ok ? `success:${result.txHash}` : `failed:${result.error}`;
    } else if (willExecute && side) {
      // 7. Execute (paper or live) → 8. update positions. Journaled (outbox pattern) so a
      // crash between broadcast and the DB write is recoverable — see executionJournal.ts.
      const amount = stroopsToAmount(config.amountPerTrade);
      const strategyId = decision.selectedStrategy ?? config.role;
      const journal = openExecution({ row, role: config.role, pair: config.pair, side, amount, price: String(ctx.price), strategyId });

      const txHash = await (row.mode === 'paper'
        ? executePaperQuantTrade(row, { pair: config.pair, amountPerTrade: amount }, side)
        : executeQuantTrade(row, { pair: config.pair, amountPerTrade: amount }, side, ctx.price));
      markBroadcast(journal.id, txHash);

      try {
        const { tradeId: tid, position: pos, pnl } = recordCompletedTrade({
          row,
          strategyId,
          side,
          pair: config.pair,
          amount,
          price: String(ctx.price),
          txHash,
          mode: row.mode,
          eventType: side === 'buy' ? 'trade_opened' : 'trade_closed',
          message: `${config.role}: ${side} ${amount} ${config.pair} @ ${ctx.price.toFixed(5)}. Tx: ${txHash}`,
        });
        markRecorded(journal.id, tid);
        tradeId = tid;
        positionAfter = pos;
        pnlAfter = pnl;
        executionResult = `success:${txHash}`;
      } catch (error) {
        // Broadcast succeeded (tx_hash already captured via markBroadcast above) but the local
        // DB write failed — deliberately leave the journal row at 'broadcast' (not 'failed') so
        // reconcilePendingExecutions() recovers it on next restart instead of the fill being
        // silently lost.
        throw error;
      }
    } else {
      executionResult = side === null ? 'no-action' : !policy.ok ? `blocked:policy` : delegationBlocks ? 'blocked:delegation' : !risk.ok ? 'blocked:risk' : 'held';
      recordTick(row.id, { ok: true, message: `${config.role}: ${decision.action} (${executionResult}) — ${decision.reasoning.slice(0, 100)}` });
    }

    // 9. Persist the full replayable decision record.
    recordDecision({
      agentId: row.id,
      owner: row.owner,
      role: config.role,
      mode: row.mode,
      pair: config.pair,
      marketSnapshot: { price: ctx.price, change24h: ctx.change24h, volume24h: ctx.volume24h },
      oracle: { source: 'horizon-trade-aggregations', pair: config.pair, price: ctx.price },
      indicators: ctx.indicators,
      regime: ctx.regime,
      llmModel: decision.llmModel ?? null,
      llmPromptSummary: decision.llmPromptSummary ?? null,
      llmResponse: decision.llmResponseRaw ?? null,
      action: decision.action,
      selectedStrategy: decision.selectedStrategy ?? null,
      confidence: decision.confidence,
      reasoning: decision.reasoning,
      policyValidation: policy,
      delegationValidation: delegation,
      risk,
      executionResult,
      tradeId,
      positionBefore,
      positionAfter,
      pnlBefore,
      pnlAfter,
    });

    snapshotPerformance(row, config.pair, ctx.price);
  } catch (error) {
    // Role agents run continuously — a transient failure here logs but doesn't halt the
    // agent (see recordTick's keepRunning doc), so it self-heals on the next tick.
    recordTick(row.id, { ok: false, message: mapThrownError(error) }, { keepRunning: true });
  }
}

/** Dispatches to the role's decision function and maps the resulting AgentDecision to a concrete
 *  trade side (or null for hold/no-op). */
async function decideForRole(
  row: AgentRow,
  config: RoleStrategyConfig,
  ctx: MarketContext
): Promise<{ decision: AgentDecision; side: 'buy' | 'sell' | null }> {
  if (config.role === 'strategic') {
    const decision = await decideStrategic(ctx);
    const side = decision.action === 'buy' ? 'buy' : decision.action === 'sell' ? 'sell' : null;
    return { decision, side };
  }

  if (config.role === 'yield') {
    const alloc = computeAllocation(row.owner, ctx.price);
    const decision = await decideYield(ctx, alloc.idleUsd);
    // Reallocation deploys idle USDC into the XLM position (a buy). Only act if there's idle
    // capital to deploy.
    const side = decision.action === 'reallocate' && alloc.idleUsd > 1 ? 'buy' : null;
    if (side) {
      logEvent({ agentId: row.id, owner: row.owner, eventType: 'yield_opportunity', mode: row.mode, mpcAccount: row.public_key, pair: config.pair, message: `Yield: deploy $${alloc.idleUsd.toFixed(2)} idle → ${decision.yieldVenue ?? 'XLM'}` });
    }
    return { decision, side };
  }

  // balancer
  const alloc = computeAllocation(row.owner, ctx.price);
  const targets = getTargets(row.owner);
  const decision = await decideBalancer(ctx, { xlmPct: alloc.xlmPct, usdcPct: alloc.usdcPct }, { xlmPct: targets.xlmPct, usdcPct: targets.usdcPct }, targets.driftThresholdPct);
  let side: 'buy' | 'sell' | null = null;
  if (decision.action === 'rebalance') {
    // Under-allocated to XLM → buy; over-allocated → sell.
    side = alloc.xlmPct < targets.xlmPct ? 'buy' : 'sell';
    logEvent({ agentId: row.id, owner: row.owner, eventType: 'portfolio_rebalanced', mode: row.mode, mpcAccount: row.public_key, pair: config.pair, message: `Rebalance: XLM ${alloc.xlmPct.toFixed(1)}% → target ${targets.xlmPct.toFixed(1)}% (${side})` });
  }
  return { decision, side };
}
