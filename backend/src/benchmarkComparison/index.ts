// Public surface of Benchmark Comparison (Phase 9). Callers import only from here.
export { compareBenchmarkSessions } from './compare.js';
export { BENCHMARK_COMPARISON_VERSION } from './types.js';
export type {
  BenchmarkComparisonInput,
  BenchmarkComparisonReport,
  MetricDelta,
  StrategyScoreDelta,
  RuntimeDelta,
  LearningDelta,
  MemoryDelta,
} from './types.js';
