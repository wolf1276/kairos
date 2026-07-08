// Learning Analytics (Phase 5) tests. Pure aggregation over caller-supplied
// LearningTradeRecord[] — no trade is queried, no strategy is run, no memory is retrieved here.
import { describe, expect, it } from 'vitest';
import { computeCohortStats, buildLearningTrendReport } from '../learningAnalytics/analytics.js';
import type { LearningTradeRecord } from '../learningAnalytics/analytics.js';

function trade(overrides: Partial<LearningTradeRecord> = {}): LearningTradeRecord {
  return {
    strategyId: 'ema-cross',
    confidence: 0.5,
    pnl: 1,
    memoryInfluenced: false,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('computeCohortStats', () => {
  it('returns an empty array for no records', () => {
    expect(computeCohortStats([])).toEqual([]);
  });

  it('splits records into fixed-size sequential cohorts, last one partial', () => {
    const records = Array.from({ length: 250 }, () => trade());
    const cohorts = computeCohortStats(records);
    expect(cohorts).toHaveLength(3);
    expect(cohorts[0]).toMatchObject({ cohort: 1, startTrade: 1, endTrade: 100, tradeCount: 100 });
    expect(cohorts[1]).toMatchObject({ cohort: 2, startTrade: 101, endTrade: 200, tradeCount: 100 });
    expect(cohorts[2]).toMatchObject({ cohort: 3, startTrade: 201, endTrade: 250, tradeCount: 50 });
  });

  it('computes win rate, pnl, confidence, strategy changes, and memory influence per cohort', () => {
    const records = [
      trade({ strategyId: 'a', confidence: 0.2, pnl: 1, memoryInfluenced: true }),
      trade({ strategyId: 'a', confidence: 0.4, pnl: -1, memoryInfluenced: false }),
      trade({ strategyId: 'b', confidence: 0.6, pnl: 2, memoryInfluenced: true }),
      trade({ strategyId: 'b', confidence: 0.8, pnl: null, memoryInfluenced: false }),
    ];
    const [cohort] = computeCohortStats(records);
    expect(cohort.tradeCount).toBe(4);
    // resolved pnl: [1, -1, 2] -> 2 wins / 3 resolved
    expect(cohort.winRate).toBeCloseTo(2 / 3);
    expect(cohort.totalPnl).toBe(2);
    expect(cohort.averagePnl).toBeCloseTo(2 / 3);
    expect(cohort.averageConfidence).toBeCloseTo(0.5);
    expect(cohort.strategyChangeCount).toBe(1); // a -> a -> b -> b
    expect(cohort.distinctStrategies).toBe(2);
    expect(cohort.memoryInfluenceRate).toBe(0.5);
  });

  it('excludes unresolved pnl from winRate/averagePnl but still counts confidence and influence', () => {
    const records = [trade({ pnl: undefined }), trade({ pnl: undefined })];
    const [cohort] = computeCohortStats(records);
    expect(cohort.winRate).toBe(0);
    expect(cohort.totalPnl).toBe(0);
    expect(cohort.averagePnl).toBe(0);
    expect(cohort.averageConfidence).toBeCloseTo(0.5);
  });
});

describe('buildLearningTrendReport', () => {
  it('reports no deltas and isImproving=false for a single cohort', () => {
    const report = buildLearningTrendReport(Array.from({ length: 50 }, () => trade()));
    expect(report.cohorts).toHaveLength(1);
    expect(report.deltas).toEqual([]);
    expect(report.isImproving).toBe(false);
  });

  it('computes deltas between successive cohorts', () => {
    const cohort1 = Array.from({ length: 100 }, () => trade({ pnl: -1, confidence: 0.3 }));
    const cohort2 = Array.from({ length: 100 }, () => trade({ pnl: 1, confidence: 0.7 }));
    const report = buildLearningTrendReport([...cohort1, ...cohort2]);
    expect(report.deltas).toHaveLength(1);
    expect(report.deltas[0].toCohort).toBe(2);
    expect(report.deltas[0].winRateDelta).toBeCloseTo(1);
    expect(report.deltas[0].averagePnlDelta).toBeCloseTo(2);
    expect(report.deltas[0].averageConfidenceDelta).toBeCloseTo(0.4);
    expect(report.isImproving).toBe(true);
  });

  it('flags isImproving=false when any metric regresses across cohorts', () => {
    const cohort1 = Array.from({ length: 100 }, () => trade({ pnl: 1, confidence: 0.7 }));
    const cohort2 = Array.from({ length: 100 }, () => trade({ pnl: -1, confidence: 0.3 }));
    const report = buildLearningTrendReport([...cohort1, ...cohort2]);
    expect(report.isImproving).toBe(false);
  });

  it('respects a custom cohort size', () => {
    const records = Array.from({ length: 30 }, () => trade());
    const report = buildLearningTrendReport(records, 10);
    expect(report.cohorts).toHaveLength(3);
    expect(report.cohorts.map((c) => c.tradeCount)).toEqual([10, 10, 10]);
  });
});
