// Performance report: aggregates real, measured per-stage latency (avg/P95/P99) from an actual
// Determinism Harness run (sequential) and an actual Concurrency Harness run (parallel at every
// stress level) into one report. Never fabricates a number — every statistic here comes from
// `performance.now()` deltas recorded by `pipeline.ts` during a real run of this same process.
import { runDeterminismHarness } from './determinism.js';
import { runConcurrencyHarness, CONCURRENCY_LEVELS } from './concurrency.js';
import { PIPELINE_STAGES, type PipelineStage } from '../pipeline.js';
import { writeReport, toMarkdownTable, computeLatencyStats } from '../reportWriter.js';

export interface PerformanceReport {
  sequential: { iterations: number; byStage: Record<PipelineStage, ReturnType<typeof computeLatencyStats>>; total: ReturnType<typeof computeLatencyStats> };
  concurrent: { level: number; byStage: Record<PipelineStage, ReturnType<typeof computeLatencyStats>>; total: ReturnType<typeof computeLatencyStats> }[];
}

export async function runPerformanceHarness(sequentialIterations = 100): Promise<PerformanceReport> {
  const determinism = await runDeterminismHarness(sequentialIterations);
  const sequentialByStage = {} as Record<PipelineStage, ReturnType<typeof computeLatencyStats>>;
  for (const stage of PIPELINE_STAGES) sequentialByStage[stage] = computeLatencyStats(determinism.timingsByStage[stage] ?? []);

  const concurrencyResults = await runConcurrencyHarness();
  const concurrent = concurrencyResults.map((r) => {
    const byStage = {} as Record<PipelineStage, ReturnType<typeof computeLatencyStats>>;
    for (const stage of PIPELINE_STAGES) byStage[stage] = computeLatencyStats(r.timingsByStage[stage] ?? []);
    return { level: r.level, byStage, total: computeLatencyStats(r.totalDurationsMs) };
  });

  return {
    sequential: { iterations: sequentialIterations, byStage: sequentialByStage, total: computeLatencyStats(determinism.totalDurationsMs) },
    concurrent,
  };
}

export function buildPerformanceMarkdown(report: PerformanceReport): string {
  const lines: string[] = [];
  lines.push('# Performance Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('All figures below are measured from real executions of this process (see Determinism/Concurrency Harnesses) — never fabricated.');
  lines.push('');

  lines.push(`## Sequential Baseline (${report.sequential.iterations} iterations)`);
  lines.push('');
  lines.push(
    toMarkdownTable(
      ['Stage', 'Avg (ms)', 'P95 (ms)', 'P99 (ms)', 'Min (ms)', 'Max (ms)'],
      PIPELINE_STAGES.map((stage) => {
        const s = report.sequential.byStage[stage];
        return [stage, s.avg.toFixed(3), s.p95.toFixed(3), s.p99.toFixed(3), s.min.toFixed(3), s.max.toFixed(3)];
      })
    )
  );
  lines.push('');
  const t = report.sequential.total;
  lines.push(`Total pipeline (sequential) — avg ${t.avg.toFixed(3)}ms, P95 ${t.p95.toFixed(3)}ms, P99 ${t.p99.toFixed(3)}ms.`);
  lines.push('');

  lines.push('## Under Concurrency');
  lines.push('');
  for (const c of report.concurrent) {
    lines.push(`### Level ${c.level}`);
    lines.push('');
    lines.push(
      toMarkdownTable(
        ['Stage', 'Avg (ms)', 'P95 (ms)', 'P99 (ms)'],
        PIPELINE_STAGES.map((stage) => {
          const s = c.byStage[stage];
          return [stage, s.avg.toFixed(3), s.p95.toFixed(3), s.p99.toFixed(3)];
        })
      )
    );
    lines.push('');
    lines.push(`Total pipeline duration at level ${c.level} — avg ${c.total.avg.toFixed(3)}ms, P95 ${c.total.p95.toFixed(3)}ms, P99 ${c.total.p99.toFixed(3)}ms.`);
    lines.push('');
  }

  lines.push('## Total Pipeline Duration vs Concurrency Level');
  lines.push('');
  lines.push(
    toMarkdownTable(
      ['Level', 'Avg (ms)', 'P95 (ms)', 'P99 (ms)'],
      [
        ['1 (sequential)', t.avg.toFixed(3), t.p95.toFixed(3), t.p99.toFixed(3)],
        ...report.concurrent.map((c) => [String(c.level), c.total.avg.toFixed(3), c.total.p95.toFixed(3), c.total.p99.toFixed(3)]),
      ]
    )
  );
  lines.push('');

  return lines.join('\n');
}

async function main() {
  const iterationsArg = process.argv.find((a) => a.startsWith('--iterations='));
  const iterations = iterationsArg ? Number(iterationsArg.split('=')[1]) : 100;
  console.log(`Running Performance Harness (sequential=${iterations}, concurrency levels=${CONCURRENCY_LEVELS.join(',')})...`);
  const report = await runPerformanceHarness(iterations);
  const markdown = buildPerformanceMarkdown(report);
  const path = writeReport('performance', markdown);
  console.log(`Performance report written to ${path}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
