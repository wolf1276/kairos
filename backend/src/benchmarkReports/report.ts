// Benchmark Reports (Phase 8), assembly half. Pure passthrough — bundles the six already-computed
// phase reports into one object plus a version tag. No I/O, no engine calls, no `Date.now()`: the
// caller supplies `generatedAt` and every constituent report, so the same input always yields a
// byte-identical bundle.
import { BENCHMARK_REPORTS_VERSION } from './types.js';
import type { BenchmarkReportBundle, BenchmarkReportInput } from './types.js';

export function buildBenchmarkReportBundle(input: BenchmarkReportInput): BenchmarkReportBundle {
  return {
    version: BENCHMARK_REPORTS_VERSION,
    generatedAt: input.generatedAt,
    sessionId: input.sessionId,
    trading: input.trading,
    strategy: input.strategy,
    runtime: input.runtime,
    memory: input.memory,
    learning: input.learning,
    reliability: input.reliability,
  };
}

/** Deterministic JSON export: fixed key order (matches `BenchmarkReportBundle`'s declared field
 *  order) and 2-space indent. Same input always produces the same string byte-for-byte. */
export function exportBenchmarkReportJson(bundle: BenchmarkReportBundle): string {
  return JSON.stringify(bundle, null, 2);
}
