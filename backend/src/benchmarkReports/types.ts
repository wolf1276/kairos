// Types for Benchmark Reports (Phase 8). Assembles the six existing analytics reports
// (Trading/Strategy/Runtime/Memory/Learning/Reliability) into one bundle and exports it as JSON or
// Markdown. This module computes nothing itself — every report is already produced by its own
// phase's `compute*`/`build*` function; a caller (route handler, CLI, scheduled job) hands the
// already-built reports here. `generatedAt` is caller-supplied (never `Date.now()`) so building and
// exporting the same input always produces byte-identical output.
import type { TradingMetrics } from '../benchmarkCore/tradingMetrics.js';
import type { RankedStrategy } from '../strategyEngine/analytics.js';
import type { PipelineLatencyReport } from '../runtimeAnalytics/types.js';
import type { MemoryAnalyticsReport } from '../memoryLayer/analytics.js';
import type { LearningTrendReport } from '../learningAnalytics/analytics.js';
import type { ReliabilityReport } from '../reliabilityAnalytics/types.js';

export const BENCHMARK_REPORTS_VERSION = '1.0.0';

export interface BenchmarkReportInput {
  generatedAt: number;
  sessionId: string;
  trading: TradingMetrics;
  strategy: RankedStrategy[];
  runtime: PipelineLatencyReport;
  memory: MemoryAnalyticsReport;
  learning: LearningTrendReport;
  reliability: ReliabilityReport;
}

export interface BenchmarkReportBundle {
  version: string;
  generatedAt: number;
  sessionId: string;
  trading: TradingMetrics;
  strategy: RankedStrategy[];
  runtime: PipelineLatencyReport;
  memory: MemoryAnalyticsReport;
  learning: LearningTrendReport;
  reliability: ReliabilityReport;
}
