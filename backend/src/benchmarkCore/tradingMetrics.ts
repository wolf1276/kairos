// Trading Metrics (Phase 2). Extends Benchmark Core only — computes purely over
// `BenchmarkExecutionRecord[]` already recorded by a `BenchmarkSession` (see session.ts). Imports
// no frozen engine, calls no engine, re-executes nothing. Every number here is derived strictly
// from what Benchmark Core already stored; a record whose `outcome` doesn't look like an
// `OutcomeRecord` (see reasoning/outcomeRecorder/types.ts — duck-typed here, not imported, since
// Benchmark Core must not depend on that phase's types) is simply excluded from PnL-based
// metrics rather than guessed at.
import type { BenchmarkExecutionRecord } from './types.js';

export interface TradingMetrics {
  /** Number of records with a usable outcome (amountRequested/amountExecuted/fees all parse as
   *  finite numbers). Every ratio/statistic below is computed over exactly this subset. */
  tradeCount: number;
  totalReturn: number;
  pnl: number;
  winRate: number;
  lossRate: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  sortinoRatio: number;
  totalFees: number;
  averageSlippage: number;
  /** Average wall-clock gap (ms) between consecutive recorded executions' `timestamp` — a proxy
   *  for "how far apart trades were," NOT true position-open-to-close holding time (Benchmark
   *  Core's history has no open/close pairing to derive that from). Named `averageHoldingTimeMs`
   *  per the requested field, with this caveat documented rather than fabricating a truer number
   *  the data doesn't support. */
  averageHoldingTimeMs: number;
}

interface UsableOutcome {
  timestamp: number;
  netPnl: number;
  fees: number;
  slippage: number;
}

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Duck-types a record's `outcome` field into net PnL / fees / slippage. Returns null (excluded,
 *  never fabricated) if the shape doesn't have what's needed. Net PnL per execution is defined as
 *  amountExecuted - amountRequested - fees — the only PnL signal Benchmark Core's recorded data
 *  supports without engine changes or an open/close trade-pairing model. */
function extractUsableOutcome(record: BenchmarkExecutionRecord): UsableOutcome | null {
  const outcome = record.outcome as Record<string, unknown> | undefined;
  if (!outcome || typeof outcome !== 'object') return null;

  const amountRequested = toFiniteNumber(outcome.amountRequested);
  const amountExecuted = toFiniteNumber(outcome.amountExecuted);
  const fees = toFiniteNumber(outcome.fees);
  const slippage = toFiniteNumber(outcome.slippage);
  if (amountRequested === null || amountExecuted === null || fees === null || slippage === null) return null;

  return {
    timestamp: record.timestamp,
    netPnl: amountExecuted - amountRequested - fees,
    fees,
    slippage,
  };
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function stdDev(values: number[], meanValue: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((acc, v) => acc + (v - meanValue) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function maxDrawdown(cumulative: number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const value of cumulative) {
    if (value > peak) peak = value;
    const drawdown = peak - value;
    if (drawdown > worst) worst = drawdown;
  }
  return worst;
}

/** Computes trading metrics over one BenchmarkSession's recorded history (or any explicit list of
 *  BenchmarkExecutionRecords). Pure function — no I/O, no store access; caller supplies the
 *  records (typically via `session.getRecords()`). */
export function computeTradingMetrics(records: BenchmarkExecutionRecord[]): TradingMetrics {
  const ordered = [...records].sort((a, b) => a.timestamp - b.timestamp);
  const usable = ordered.map(extractUsableOutcome).filter((u): u is UsableOutcome => u !== null);

  const tradeCount = usable.length;
  const pnls = usable.map((u) => u.netPnl);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);

  const pnl = pnls.reduce((a, b) => a + b, 0);

  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = losses.reduce((a, b) => a + b, 0); // negative

  const cumulative: number[] = [];
  let running = 0;
  for (const p of pnls) {
    running += p;
    cumulative.push(running);
  }

  const meanPnl = mean(pnls);
  const sdAll = stdDev(pnls, meanPnl);
  const downside = pnls.filter((p) => p < 0);
  const sdDownside = stdDev(downside, mean(downside));

  const gaps: number[] = [];
  for (let i = 1; i < ordered.length; i++) {
    gaps.push(ordered[i].timestamp - ordered[i - 1].timestamp);
  }

  const totalFees = usable.reduce((acc, u) => acc + u.fees, 0);

  // "Total Return" — net PnL as a fraction of total fees+|PnL| exposure isn't well-defined without
  // a starting balance (Benchmark Core records executions, not account balances). Defined here as
  // net PnL relative to gross capital moved (sum of |netPnl| + fees), the closest proxy available
  // from recorded history alone; 0 when no usable trades exist.
  const grossExposure = usable.reduce((acc, u) => acc + Math.abs(u.netPnl) + u.fees, 0);

  return {
    tradeCount,
    totalReturn: grossExposure > 0 ? pnl / grossExposure : 0,
    pnl,
    winRate: tradeCount > 0 ? wins.length / tradeCount : 0,
    lossRate: tradeCount > 0 ? losses.length / tradeCount : 0,
    averageWin: wins.length > 0 ? mean(wins) : 0,
    averageLoss: losses.length > 0 ? mean(losses) : 0,
    profitFactor: grossLoss !== 0 ? grossWin / Math.abs(grossLoss) : grossWin > 0 ? Infinity : 0,
    maxDrawdown: maxDrawdown(cumulative),
    sharpeRatio: sdAll > 0 ? meanPnl / sdAll : 0,
    sortinoRatio: sdDownside > 0 ? meanPnl / sdDownside : 0,
    totalFees,
    averageSlippage: usable.length > 0 ? mean(usable.map((u) => u.slippage)) : 0,
    averageHoldingTimeMs: gaps.length > 0 ? mean(gaps) : 0,
  };
}
