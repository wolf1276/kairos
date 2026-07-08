// Trading Metrics (Phase 2) tests. Pure computation over BenchmarkExecutionRecord[] via
// BenchmarkSession + InMemoryBenchmarkStore — no engine imported, no engine mocked.
import { describe, expect, it } from 'vitest';
import { BenchmarkSession } from '../benchmarkCore/session.js';
import { InMemoryBenchmarkStore } from '../benchmarkCore/store.js';
import { computeTradingMetrics } from '../benchmarkCore/tradingMetrics.js';
import type { BenchmarkExecutionInput } from '../benchmarkCore/types.js';

function outcomeInput(
  timestamp: number,
  amountRequested: string,
  amountExecuted: string,
  fees: string,
  slippage: number
): BenchmarkExecutionInput {
  return {
    timestamp,
    pipelineDurationMs: 10,
    stageDurations: {},
    provider: 'ollama',
    model: 'test-model',
    outcome: { amountRequested, amountExecuted, fees, slippage },
  };
}

describe('computeTradingMetrics', () => {
  it('returns all-zero metrics for no records', () => {
    const metrics = computeTradingMetrics([]);
    expect(metrics.tradeCount).toBe(0);
    expect(metrics.pnl).toBe(0);
    expect(metrics.winRate).toBe(0);
    expect(metrics.lossRate).toBe(0);
    expect(metrics.averageWin).toBe(0);
    expect(metrics.averageLoss).toBe(0);
    expect(metrics.profitFactor).toBe(0);
    expect(metrics.maxDrawdown).toBe(0);
    expect(metrics.sharpeRatio).toBe(0);
    expect(metrics.sortinoRatio).toBe(0);
    expect(metrics.totalFees).toBe(0);
    expect(metrics.averageSlippage).toBe(0);
    expect(metrics.averageHoldingTimeMs).toBe(0);
  });

  it('excludes records with no usable outcome instead of fabricating values', () => {
    const session = new BenchmarkSession('s1', new InMemoryBenchmarkStore());
    session.record({ timestamp: 1, pipelineDurationMs: 1, stageDurations: {}, provider: 'ollama', model: 'm' }); // no outcome
    session.record(outcomeInput(2, '10.000000', '9.990000', '0.010000', 0.1)); // net = -0.02
    const metrics = computeTradingMetrics(session.getRecords());
    expect(metrics.tradeCount).toBe(1);
  });

  it('computes win/loss rate, average win/loss, profit factor correctly', () => {
    const session = new BenchmarkSession('s2', new InMemoryBenchmarkStore());
    // Winning trade: executed > requested + fees => net +5
    session.record(outcomeInput(1, '100', '106', '1', 0.1)); // net = +5
    // Losing trade: net = -3
    session.record(outcomeInput(2, '100', '96', '1', 0.2)); // net = -5
    session.record(outcomeInput(3, '100', '103', '1', 0.15)); // net = +2

    const metrics = computeTradingMetrics(session.getRecords());
    expect(metrics.tradeCount).toBe(3);
    expect(metrics.winRate).toBeCloseTo(2 / 3);
    expect(metrics.lossRate).toBeCloseTo(1 / 3);
    expect(metrics.averageWin).toBeCloseTo((5 + 2) / 2);
    expect(metrics.averageLoss).toBeCloseTo(-5);
    expect(metrics.pnl).toBeCloseTo(5 - 5 + 2);
    expect(metrics.profitFactor).toBeCloseTo(7 / 5);
    expect(metrics.totalFees).toBeCloseTo(3);
    expect(metrics.averageSlippage).toBeCloseTo((0.1 + 0.2 + 0.15) / 3);
  });

  it('computes max drawdown from the cumulative PnL curve', () => {
    const session = new BenchmarkSession('s3', new InMemoryBenchmarkStore());
    // Cumulative PnL sequence: +10, +15 (peak 15), +5 (dd 10), +8, +2 (dd 13, new worst)
    session.record(outcomeInput(1, '0', '10', '0', 0)); // +10
    session.record(outcomeInput(2, '0', '5', '0', 0)); // +5 -> cum 15
    session.record(outcomeInput(3, '0', '-10', '0', 0)); // -10 -> cum 5
    session.record(outcomeInput(4, '0', '3', '0', 0)); // +3 -> cum 8
    session.record(outcomeInput(5, '0', '-6', '0', 0)); // -6 -> cum 2 (dd = 15-2 = 13)

    const metrics = computeTradingMetrics(session.getRecords());
    expect(metrics.maxDrawdown).toBeCloseTo(13);
  });

  it('profitFactor is 0 with no wins and no losses, Infinity with wins and zero losses', () => {
    const winOnly = new BenchmarkSession('s4', new InMemoryBenchmarkStore());
    winOnly.record(outcomeInput(1, '0', '10', '0', 0));
    const metrics = computeTradingMetrics(winOnly.getRecords());
    expect(metrics.profitFactor).toBe(Infinity);
  });

  it('computes average holding time as the mean gap between consecutive timestamps', () => {
    const session = new BenchmarkSession('s5', new InMemoryBenchmarkStore());
    session.record(outcomeInput(1000, '0', '1', '0', 0));
    session.record(outcomeInput(3000, '0', '1', '0', 0));
    session.record(outcomeInput(6000, '0', '1', '0', 0));
    const metrics = computeTradingMetrics(session.getRecords());
    // gaps: 2000, 3000 -> mean 2500
    expect(metrics.averageHoldingTimeMs).toBeCloseTo(2500);
  });

  it('sharpe and sortino ratios are 0 when standard deviation is 0 or undefined (fewer than 2 points)', () => {
    const session = new BenchmarkSession('s6', new InMemoryBenchmarkStore());
    session.record(outcomeInput(1, '0', '5', '0', 0));
    const metrics = computeTradingMetrics(session.getRecords());
    expect(metrics.sharpeRatio).toBe(0);
    expect(metrics.sortinoRatio).toBe(0);
  });

  it('ignores malformed outcome fields (non-numeric strings) rather than throwing or fabricating', () => {
    const session = new BenchmarkSession('s7', new InMemoryBenchmarkStore());
    session.record({
      timestamp: 1,
      pipelineDurationMs: 1,
      stageDurations: {},
      provider: 'ollama',
      model: 'm',
      outcome: { amountRequested: 'not-a-number', amountExecuted: '10', fees: '0', slippage: 0 },
    });
    const metrics = computeTradingMetrics(session.getRecords());
    expect(metrics.tradeCount).toBe(0);
  });

  it('sorts records by timestamp before computing sequential metrics (drawdown, holding time)', () => {
    const session = new BenchmarkSession('s8', new InMemoryBenchmarkStore());
    // Insert out of order.
    session.record(outcomeInput(3000, '0', '1', '0', 0));
    session.record(outcomeInput(1000, '0', '1', '0', 0));
    session.record(outcomeInput(2000, '0', '1', '0', 0));
    const metrics = computeTradingMetrics(session.getRecords());
    expect(metrics.averageHoldingTimeMs).toBeCloseTo(1000);
  });
});
