// Shared, timestamped Markdown report writer for the E2E harnesses. Reuses the existing
// reasoning-benchmark timestamp/table utilities rather than duplicating them. Never overwrites a
// previous run — every report gets its own timestamped filename.
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { reportTimestamp } from '../reasoning/utils/timestamp.js';
import { toMarkdownTable } from '../reasoning/utils/table.js';

export const E2E_REPORTS_DIR = join(import.meta.dirname, 'reports');

export { toMarkdownTable };

export function writeReport(kind: 'determinism' | 'concurrency' | 'reliability' | 'performance', markdown: string): string {
  mkdirSync(E2E_REPORTS_DIR, { recursive: true });
  const filename = `${kind}-${reportTimestamp()}.md`;
  const path = join(E2E_REPORTS_DIR, filename);
  writeFileSync(path, markdown, 'utf8');
  return path;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export interface LatencyStats {
  avg: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  count: number;
}

export function computeLatencyStats(values: number[]): LatencyStats {
  if (values.length === 0) return { avg: 0, p95: 0, p99: 0, min: 0, max: 0, count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    avg: sum / sorted.length,
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    count: sorted.length,
  };
}
