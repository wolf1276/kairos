// Determinism Harness: runs the complete backend pipeline N times (default 500) against one
// fixed, frozen set of inputs, and verifies that every stage's own canonical hash (the hash each
// phase already computes and stores on its output — see each phase's hashing.ts) is identical
// across every run. Any distinct hash value for a stage is reported as a failure for that stage,
// with root-cause context — this harness never hides or "fixes up" a mismatch, it measures and
// reports it.
import { runPipeline, PIPELINE_STAGES, type PipelineStage } from '../pipeline.js';
import { buildFixtures } from '../fixtures.js';
import { buildProtocolRegistry } from '../registry.js';
import { writeReport, toMarkdownTable, computeLatencyStats } from '../reportWriter.js';

export interface DeterminismStageResult {
  stage: PipelineStage;
  distinctHashes: number;
  sampleHashes: string[];
  deterministic: boolean;
}

export interface DeterminismReport {
  iterations: number;
  successCount: number;
  failureCount: number;
  failures: { iteration: number; failedStage: string; errorName: string; errorMessage: string }[];
  stageResults: DeterminismStageResult[];
  overallDeterministic: boolean;
  timingsByStage: Record<PipelineStage, number[]>;
  totalDurationsMs: number[];
}

export async function runDeterminismHarness(iterations = 500): Promise<DeterminismReport> {
  const fixtures = buildFixtures();
  const registry = buildProtocolRegistry();

  const hashesByStage: Record<string, Set<string>> = {};
  const sampleByStage: Record<string, string[]> = {};
  for (const stage of PIPELINE_STAGES) {
    hashesByStage[stage] = new Set();
    sampleByStage[stage] = [];
  }
  const timingsByStage: Record<string, number[]> = {};
  for (const stage of PIPELINE_STAGES) timingsByStage[stage] = [];
  const totalDurationsMs: number[] = [];

  const failures: DeterminismReport['failures'] = [];
  let successCount = 0;

  for (let i = 0; i < iterations; i++) {
    const result = await runPipeline(fixtures, { registry, now: 1_700_000_000_000 });
    totalDurationsMs.push(result.totalDurationMs);
    for (const t of result.timings) timingsByStage[t.stage].push(t.durationMs);

    if (!result.ok) {
      failures.push({ iteration: i, failedStage: result.failedStage, errorName: result.errorName, errorMessage: result.errorMessage });
      continue;
    }
    successCount++;
    for (const stage of PIPELINE_STAGES) {
      const hash = result.hashes[stage];
      hashesByStage[stage].add(hash);
      if (sampleByStage[stage].length < 3 && !sampleByStage[stage].includes(hash)) sampleByStage[stage].push(hash);
    }
  }

  const stageResults: DeterminismStageResult[] = PIPELINE_STAGES.map((stage) => ({
    stage,
    distinctHashes: hashesByStage[stage].size,
    sampleHashes: sampleByStage[stage],
    deterministic: hashesByStage[stage].size <= 1,
  }));

  return {
    iterations,
    successCount,
    failureCount: failures.length,
    failures,
    stageResults,
    overallDeterministic: failures.length === 0 && stageResults.every((s) => s.deterministic),
    timingsByStage: timingsByStage as Record<PipelineStage, number[]>,
    totalDurationsMs,
  };
}

export function buildDeterminismMarkdown(report: DeterminismReport): string {
  const lines: string[] = [];
  lines.push('# Determinism Harness Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Iterations: ${report.iterations}`);
  lines.push(`Successful runs: ${report.successCount} / ${report.iterations}`);
  lines.push(`Failed runs: ${report.failureCount}`);
  lines.push(`Overall verdict: ${report.overallDeterministic ? '✅ DETERMINISTIC' : '❌ NON-DETERMINISTIC'}`);
  lines.push('');
  lines.push('## Per-Stage Hash Stability');
  lines.push('');
  lines.push(
    toMarkdownTable(
      ['Stage', 'Distinct Hashes', 'Deterministic', 'Sample Hashes'],
      report.stageResults.map((s) => [s.stage, s.distinctHashes, s.deterministic ? 'yes' : 'NO', s.sampleHashes.map((h) => h.slice(0, 12)).join(', ')])
    )
  );
  lines.push('');

  const nonDeterministic = report.stageResults.filter((s) => !s.deterministic);
  if (nonDeterministic.length > 0) {
    lines.push('## Non-Determinism Findings');
    lines.push('');
    for (const s of nonDeterministic) {
      lines.push(`- **${s.stage}**: ${s.distinctHashes} distinct hash values observed across ${report.successCount} identical-input runs.`);
    }
    lines.push('');
    lines.push(
      '> Root cause (executionResult / outcomeRecord / memoryWrite): `buildExecutionPlan` (executionPlanner/planner.ts) mints a fresh ' +
      '`randomUUID()` for `plan.executionId` on every call with no injectable override. `hashExecutionResult` ' +
      '(routeExecutionEngine/hashing.ts) embeds the upstream plan\'s `executionId` via `metadata.planExecutionId` without excluding it, ' +
      'so replaying the *same decision* through a freshly-rebuilt plan (rather than reusing the same in-memory plan object) always yields a ' +
      'different `executionHash`, which then cascades into `outcomeRecord.executionId`/`outcomeHash` and `memoryWrite` content. ' +
      'Confirmed non-architectural: reusing the identical plan+route object across repeated `executeRoute` calls **does** produce an identical ' +
      '`executionHash` — the gap is specifically end-to-end replay-from-decision, not the execution engine\'s own hashing logic in isolation. ' +
      'Recommended fix (out of scope for this harness — Planner/Execution Engine phases are frozen per this audit\'s brief): either accept an ' +
      'injectable `executionId` in `buildExecutionPlan` (mirroring `executeRoute`\'s own `options.executionId`), or exclude `metadata.planExecutionId` ' +
      'from `hashExecutionResult` the same way every other phase excludes its own upstream volatile ids.'
    );
    lines.push('');
  }

  lines.push('## Failures');
  lines.push('');
  if (report.failures.length === 0) {
    lines.push('None.');
  } else {
    lines.push(toMarkdownTable(['Iteration', 'Stage', 'Error', 'Message'], report.failures.slice(0, 20).map((f) => [f.iteration, f.failedStage, f.errorName, f.errorMessage])));
    if (report.failures.length > 20) lines.push(`\n...and ${report.failures.length - 20} more.`);
  }
  lines.push('');

  lines.push('## Stage Latency (measured, this run)');
  lines.push('');
  lines.push(
    toMarkdownTable(
      ['Stage', 'Avg (ms)', 'P95 (ms)', 'P99 (ms)', 'Min (ms)', 'Max (ms)', 'Samples'],
      PIPELINE_STAGES.map((stage) => {
        const stats = computeLatencyStats(report.timingsByStage[stage] ?? []);
        return [stage, stats.avg.toFixed(3), stats.p95.toFixed(3), stats.p99.toFixed(3), stats.min.toFixed(3), stats.max.toFixed(3), stats.count];
      })
    )
  );
  lines.push('');
  const totalStats = computeLatencyStats(report.totalDurationsMs);
  lines.push(`Total pipeline duration — avg ${totalStats.avg.toFixed(3)}ms, P95 ${totalStats.p95.toFixed(3)}ms, P99 ${totalStats.p99.toFixed(3)}ms (n=${totalStats.count}).`);
  lines.push('');

  return lines.join('\n');
}

async function main() {
  const iterationsArg = process.argv.find((a) => a.startsWith('--iterations='));
  const iterations = iterationsArg ? Number(iterationsArg.split('=')[1]) : 500;
  console.log(`Running Determinism Harness: ${iterations} iterations...`);
  const report = await runDeterminismHarness(iterations);
  const markdown = buildDeterminismMarkdown(report);
  const path = writeReport('determinism', markdown);
  console.log(`Determinism report written to ${path}`);
  console.log(`Overall: ${report.overallDeterministic ? 'DETERMINISTIC' : 'NON-DETERMINISTIC'} (${report.successCount}/${report.iterations} succeeded)`);
  if (!report.overallDeterministic) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
