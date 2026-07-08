// Public surface of Benchmark Reports (Phase 8). Callers import only from here.
export { buildBenchmarkReportBundle, exportBenchmarkReportJson } from './report.js';
export { exportBenchmarkReportMarkdown } from './markdown.js';
export { buildReportBundle } from './fromRecords.js';
export { BENCHMARK_REPORTS_VERSION } from './types.js';
export type { BenchmarkReportInput, BenchmarkReportBundle } from './types.js';
