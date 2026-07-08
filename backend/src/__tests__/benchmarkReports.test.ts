import { describe, expect, it } from 'vitest';
import { buildBenchmarkReportBundle, exportBenchmarkReportJson, exportBenchmarkReportMarkdown } from '../benchmarkReports/index.js';
import { computeTradingMetrics } from '../benchmarkCore/tradingMetrics.js';
import { buildStrategyRanking } from '../strategyEngine/analytics.js';
import { computePipelineLatencyReport } from '../runtimeAnalytics/analytics.js';
import { buildMemoryAnalyticsReport } from '../memoryLayer/analytics.js';
import { buildLearningTrendReport } from '../learningAnalytics/analytics.js';
import { computeReliabilityReport } from '../reliabilityAnalytics/analytics.js';
import type { BenchmarkReportInput } from '../benchmarkReports/types.js';

function buildInput(): BenchmarkReportInput {
  return {
    generatedAt: 1700000000000,
    sessionId: 'session-1',
    trading: computeTradingMetrics([]),
    strategy: buildStrategyRanking([], ['meanReversion']),
    runtime: computePipelineLatencyReport([]),
    memory: buildMemoryAnalyticsReport({ episodic: [], semantic: [], working: [], now: 1700000000000 }),
    learning: buildLearningTrendReport([]),
    reliability: computeReliabilityReport([{ type: 'timeout', timestamp: 1, recovered: true }], 10),
  };
}

describe('buildBenchmarkReportBundle', () => {
  it('assembles all six reports plus version and generatedAt', () => {
    const bundle = buildBenchmarkReportBundle(buildInput());
    expect(bundle.sessionId).toBe('session-1');
    expect(bundle.generatedAt).toBe(1700000000000);
    expect(bundle.version).toBeTruthy();
    expect(bundle.trading.tradeCount).toBe(0);
    expect(bundle.strategy[0].strategyId).toBe('meanReversion');
    expect(bundle.runtime.runCount).toBe(0);
    expect(bundle.memory.episodicGrowth.totalCount).toBe(0);
    expect(bundle.learning.cohorts).toEqual([]);
    expect(bundle.reliability.counts.timeout).toBe(1);
  });
});

describe('exportBenchmarkReportJson', () => {
  it('is deterministic for identical input', () => {
    const bundle = buildBenchmarkReportBundle(buildInput());
    const a = exportBenchmarkReportJson(bundle);
    const b = exportBenchmarkReportJson(buildBenchmarkReportBundle(buildInput()));
    expect(a).toBe(b);
    expect(() => JSON.parse(a)).not.toThrow();
  });
});

describe('exportBenchmarkReportMarkdown', () => {
  it('is deterministic for identical input and includes all six report sections', () => {
    const bundle = buildBenchmarkReportBundle(buildInput());
    const a = exportBenchmarkReportMarkdown(bundle);
    const b = exportBenchmarkReportMarkdown(buildBenchmarkReportBundle(buildInput()));
    expect(a).toBe(b);
    expect(a).toContain('## Trading Report');
    expect(a).toContain('## Strategy Report');
    expect(a).toContain('## Runtime Report');
    expect(a).toContain('## Memory Report');
    expect(a).toContain('## Learning Report');
    expect(a).toContain('## Reliability Report');
    expect(a).toContain('session-1');
  });
});
