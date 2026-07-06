// Managed Capital Context domain — represents the delegated Smart Wallet's capital like a
// portfolio manager would: total/idle/deployed capital, allocations, positions, PnL, pending
// executions. Deliberately excludes blockchain implementation details (addresses, contract ids,
// signatures, nonces, tx hashes) — the AI reasons over capital, not chain plumbing.
import { getDb } from '../../db.js';
import type { AgentRow } from '../../db.js';
import type { FeatureBuildResult } from '../featureEngine.js';

export interface PendingExecutionSummary {
  kind: 'spot' | 'protocol';
  status: string;
  ageSeconds: number;
}

export interface ManagedCapitalContextView {
  totalManagedCapital: number;
  idleCapital: number;
  deployableCapital: number;
  allocation: {
    xlmPct: number;
    usdcPct: number;
  };
  protocolExposure: FeatureBuildResult['featureSet']['protocolExposure'];
  realizedPnl: number;
  unrealizedPnl: number;
  pendingExecutions: PendingExecutionSummary[];
  /** 0-1 — data-quality signal for this domain: capital figures loaded, and how much is still
   *  in flight (a pending execution means the true post-settlement state isn't known yet). */
  confidence: number;
}

/** Every pending execution shaves a fixed amount off confidence (settlement is uncertain until
 *  it clears) — capped so a handful of in-flight executions never drives this below 0.5; capital
 *  totals/allocations themselves are always known synchronously from the DB, so the floor
 *  reflects "somewhat stale," never "unknown." */
function capitalConfidence(totalManagedCapital: number, pendingCount: number): number {
  if (!Number.isFinite(totalManagedCapital)) return 0;
  const penalty = Math.min(pendingCount * 0.15, 0.5);
  return 1 - penalty;
}

/** deployableCapital must always be a finite, non-negative number — a NaN/Infinity idleUsd
 *  (e.g. from a corrupt portfolio snapshot) must never propagate into the context. */
function safeDeployableCapital(idleUsd: number): number {
  if (!Number.isFinite(idleUsd)) return 0;
  return Math.max(idleUsd, 0);
}

interface PendingExecutionRow {
  kind: 'spot' | 'protocol';
  status: string;
  created_at: number;
}

// Every buildAgentContext() call needs pending-execution state, but it rarely changes between
// consecutive ticks — a short-lived cache avoids two DB round trips (execution_journal +
// protocol_execution_journal) per build. TTL is intentionally short: a real fill/broadcast
// should be visible again within a couple seconds, not held stale for the lifetime of the
// (much longer) feature cache.
const PENDING_EXECUTIONS_TTL_MS = 2_000;
const pendingExecutionsCache = new Map<string, { rows: PendingExecutionRow[]; expiresAt: number }>();

function queryPendingExecutionRows(agentId: string): PendingExecutionRow[] {
  const spot = getDb()
    .prepare(`SELECT status, created_at FROM execution_journal WHERE agent_id = ? AND status IN ('pending','broadcast')`)
    .all(agentId) as { status: string; created_at: number }[];
  const protocol = getDb()
    .prepare(`SELECT status, created_at FROM protocol_execution_journal WHERE agent_id = ? AND status IN ('pending','broadcast')`)
    .all(agentId) as { status: string; created_at: number }[];
  return [
    ...spot.map((r) => ({ kind: 'spot' as const, status: r.status, created_at: r.created_at })),
    ...protocol.map((r) => ({ kind: 'protocol' as const, status: r.status, created_at: r.created_at })),
  ];
}

function getPendingExecutionRows(agentId: string, now: number): PendingExecutionRow[] {
  const cached = pendingExecutionsCache.get(agentId);
  if (cached && now < cached.expiresAt) return cached.rows;
  const rows = queryPendingExecutionRows(agentId);
  pendingExecutionsCache.set(agentId, { rows, expiresAt: now + PENDING_EXECUTIONS_TTL_MS });
  return rows;
}

/** Test/invalidation hook — drops all cached pending-execution rows so the next build re-reads
 *  the DB regardless of TTL. */
export function clearPendingExecutionsCache(): void {
  pendingExecutionsCache.clear();
}

export function buildManagedCapitalContextView(agentRow: AgentRow, result: FeatureBuildResult, now = Date.now()): ManagedCapitalContextView {
  const { featureSet } = result;
  const parsedCapital = agentRow.capital ? parseFloat(agentRow.capital) : featureSet.portfolio.totalValue;
  const totalManagedCapital = Number.isFinite(parsedCapital) ? parsedCapital : NaN;
  const pendingExecutions = getPendingExecutionRows(agentRow.id, now).map((r) => ({
    kind: r.kind,
    status: r.status,
    ageSeconds: Math.round((now - r.created_at) / 1000),
  }));
  return {
    totalManagedCapital,
    idleCapital: Number.isFinite(featureSet.portfolio.idleUsd) ? featureSet.portfolio.idleUsd : 0,
    deployableCapital: safeDeployableCapital(featureSet.portfolio.idleUsd),
    allocation: {
      xlmPct: featureSet.portfolio.xlmPct,
      usdcPct: featureSet.portfolio.usdcPct,
    },
    protocolExposure: featureSet.protocolExposure,
    realizedPnl: featureSet.risk.realizedPnl,
    unrealizedPnl: featureSet.risk.unrealizedPnl,
    pendingExecutions,
    confidence: capitalConfidence(totalManagedCapital, pendingExecutions.length),
  };
}
