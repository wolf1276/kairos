import { describe, expect, it } from 'vitest';
import { compareBenchmarkSessions } from '../benchmarkComparison/index.js';
import { buildBenchmarkReportBundle } from '../benchmarkReports/index.js';
import { computeTradingMetrics } from '../benchmarkCore/tradingMetrics.js';
import { buildStrategyRanking } from '../strategyEngine/analytics.js';
import { computePipelineLatencyReport } from '../runtimeAnalytics/analytics.js';
import { buildMemoryAnalyticsReport } from '../memoryLayer/analytics.js';
import { buildLearningTrendReport } from '../learningAnalytics/analytics.js';
import { computeReliabilityReport } from '../reliabilityAnalytics/analytics.js';
import type { BenchmarkReportBundle } from '../benchmarkReports/types.js';
import type { LearningTradeRecord } from '../learningAnalytics/analytics.js';

function emptyBundle(sessionId: string): BenchmarkReportBundle {
  return buildBenchmarkReportBundle({
    generatedAt: 1700000000000,
    sessionId,
    trading: computeTradingMetrics([]),
    strategy: buildStrategyRanking([], ['meanReversion']),
    runtime: computePipelineLatencyReport([]),
    memory: buildMemoryAnalyticsReport({ episodic: [], semantic: [], working: [], now: 1700000000000 }),
    learning: buildLearningTrendReport([]),
    reliability: computeReliabilityReport([], 10),
  });
}

describe('compareBenchmarkSessions', () => {
  it('is deterministic and reports zero deltas for identical empty bundles', () => {
    const baseline = emptyBundle('session-a');
    const current = emptyBundle('session-b');
    const report = compareBenchmarkSessions({ generatedAt: 1700000001000, baseline, current });
    expect(report.baselineSessionId).toBe('session-a');
    expect(report.currentSessionId).toBe('session-b');
    expect(report.pnlDelta).toEqual({ baseline: 0, current: 0, delta: 0, percentChange: null });
    expect(report.winRateDelta.delta).toBe(0);
    expect(report.strategyDelta).toEqual([{ strategyId: 'meanReversion', baselineScore: 0, currentScore: 0, delta: 0 }]);
    expect(report.learningDelta.latestCohortWinRate).toBeNull();
    expect(report.improvementScore).toBe(50);
  });

  it('scores an all-around improvement above 50', () => {
    const trades: LearningTradeRecord[] = Array.from({ length: 100 }, (_, i) => ({
      strategyId: 'meanReversion',
      confidence: 0.6,
      pnl: 10,
      memoryInfluenced: true,
      timestamp: i,
    }));
    const improvedTrades: LearningTradeRecord[] = Array.from({ length: 100 }, (_, i) => ({
      strategyId: 'meanReversion',
      confidence: 0.8,
      pnl: 20,
      memoryInfluenced: true,
      timestamp: i,
    }));

    const baseline: BenchmarkReportBundle = buildBenchmarkReportBundle({
      generatedAt: 1700000000000,
      sessionId: 'session-a',
      trading: computeTradingMetrics([]),
      strategy: buildStrategyRanking(
        [
          { strategyId: 'meanReversion', signal: 'BUY', confidence: 0.5, regime: 'ranging', pnl: 1 },
        ],
        ['meanReversion']
      ),
      runtime: computePipelineLatencyReport([]),
      memory: buildMemoryAnalyticsReport({ episodic: [], semantic: [], working: [], now: 1700000000000 }),
      learning: buildLearningTrendReport(trades),
      reliability: computeReliabilityReport([], 10),
    });

    const current: BenchmarkReportBundle = buildBenchmarkReportBundle({
      generatedAt: 1700000000000,
      sessionId: 'session-b',
      trading: computeTradingMetrics([]),
      strategy: buildStrategyRanking(
        [
          { strategyId: 'meanReversion', signal: 'BUY', confidence: 0.9, regime: 'ranging', pnl: 5 },
        ],
        ['meanReversion']
      ),
      runtime: computePipelineLatencyReport([]),
      memory: buildMemoryAnalyticsReport({ episodic: [], semantic: [], working: [], now: 1700000000000 }),
      learning: buildLearningTrendReport(improvedTrades),
      reliability: computeReliabilityReport([], 10),
    });

    const report = compareBenchmarkSessions({ generatedAt: 1700000001000, baseline, current });
    expect(report.learningDelta.latestCohortWinRate?.delta).toBe(0);
    expect(report.learningDelta.latestCohortAveragePnl?.delta).toBeGreaterThan(0);
    expect(report.strategyDelta[0].delta).toBeGreaterThan(0);
    expect(report.improvementScore).toBeGreaterThan(50);

    const again = compareBenchmarkSessions({ generatedAt: 1700000001000, baseline, current });
    expect(again).toEqual(report);
  });
});
