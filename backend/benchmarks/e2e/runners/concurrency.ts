// Concurrency Harness: fires the complete backend pipeline N-way in parallel (10 / 50 / 100 /
// 250) against one shared, frozen fixture set, one shared ProtocolRegistry, and one shared
// in-memory MemoryWriter provider set — the same shared-state topology a real single-process
// deployment would have — and verifies: no thrown exceptions (no race conditions), every
// successful run's per-stage hashes agree with every other run's (no cross-request
// contamination), and the memory writer's documented idempotent-dedup guarantee holds under
// real concurrency (exactly one 'written', the rest 'duplicate', never a corrupted/partial write).
import { installFetch, restoreFetch } from '../fetchStub.js';
import { runPipeline, PIPELINE_STAGES, type PipelineStage } from '../pipeline.js';
import { buildFixtures } from '../fixtures.js';
import { buildProtocolRegistry } from '../registry.js';
import { InMemoryEpisodicProvider } from '../../../src/memoryLayer/providers/inMemoryEpisodicProvider.js';
import { InMemorySemanticProvider } from '../../../src/memoryLayer/providers/inMemorySemanticProvider.js';
import { InMemoryWorkingProvider } from '../../../src/memoryLayer/providers/inMemoryWorkingProvider.js';
import { writeMemory } from '../../../src/reasoning/memoryWriter/writer.js';
import { writeReport, toMarkdownTable, computeLatencyStats } from '../reportWriter.js';
import { randomUUID } from 'crypto';
import type { OutcomeRecord } from '../../../src/reasoning/outcomeRecorder/types.js';

export const CONCURRENCY_LEVELS = [10, 50, 100, 250] as const;

export interface ConcurrencyLevelResult {
  level: number;
  successCount: number;
  errorCount: number;
  errors: { errorName: string; errorMessage: string }[];
  crossContamination: boolean;
  stageAgreement: Record<PipelineStage, { distinctHashes: number; agree: boolean }>;
  writtenCount: number;
  duplicateCount: number;
  otherStatusCount: number;
  dedupCorrect: boolean;
  dedupProbe: { written: number; duplicate: number; other: number; errors: number; correct: boolean };
  timingsByStage: Record<PipelineStage, number[]>;
  totalDurationsMs: number[];
}

const HEX64 = 'c'.repeat(64);

function fixedOutcomeRecord(): OutcomeRecord {
  return {
    outcomeId: randomUUID(), outcomeHash: HEX64, executionId: 'exec-dedup-probe', executionHash: HEX64,
    protocol: 'soroswap', action: 'SWAP', assets: ['XLM', 'USDC'],
    transactionHash: HEX64, transactionXDRHash: HEX64, executionStatus: 'success', dataSource: 'synthetic',
    amountRequested: '10', amountExecuted: '9.99', fees: '0.01', slippage: 0.1, priceImpact: 0.05,
    balancesBefore: [{ asset: 'XLM', amount: '1000' }], balancesAfter: [{ asset: 'XLM', amount: '990' }],
    executionDurationMs: 1, resourceEstimate: null, verificationHash: HEX64, routeHash: HEX64,
    contextHash: HEX64, memoryHash: HEX64, failureReason: null, retryCount: 0,
    metadata: { recorderVersion: '1.0.0' },
  };
}

/** Direct concurrency probe of the Memory Writer's own documented idempotent-dedup guarantee
 *  (writer.ts's header comment): N concurrent `writeMemory` calls for the *identical* OutcomeRecord
 *  + agentId must resolve to exactly one 'written' and (N-1) 'duplicate' — never a corrupted or
 *  partial write, and never more than one 'written'. Decoupled from the full pipeline run so this
 *  test isn't confounded by the (separately documented, unrelated) `plan.executionId` determinism
 *  gap that makes every pipeline run mint its own distinct OutcomeRecord. */
async function runMemoryWriteDedupProbe(level: number): Promise<{ written: number; duplicate: number; other: number; errors: number; correct: boolean }> {
  const providers = { episodic: new InMemoryEpisodicProvider(), semantic: new InMemorySemanticProvider(), working: new InMemoryWorkingProvider() };
  const record = fixedOutcomeRecord();
  const outcomes = await Promise.allSettled(
    Array.from({ length: level }, () => writeMemory(record, { agentId: 'agent-dedup-probe', timestamp: 1_700_000_000_000 }, providers))
  );
  let written = 0, duplicate = 0, other = 0, errors = 0;
  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') { errors++; continue; }
    if (outcome.value.status === 'written') written++;
    else if (outcome.value.status === 'duplicate') duplicate++;
    else other++;
  }
  return { written, duplicate, other, errors, correct: errors === 0 && written === 1 && duplicate === level - 1 && other === 0 };
}

export async function runConcurrencyLevel(level: number): Promise<ConcurrencyLevelResult> {
  const fixtures = buildFixtures();
  const registry = buildProtocolRegistry();
  const sharedMemoryProviders = { episodic: new InMemoryEpisodicProvider(), semantic: new InMemorySemanticProvider(), working: new InMemoryWorkingProvider() };

  installFetch('none');
  let outcomes;
  try {
    outcomes = await Promise.allSettled(
      Array.from({ length: level }, () =>
        runPipeline(fixtures, { registry, now: 1_700_000_000_000, memoryProviders: sharedMemoryProviders, manageFetch: false }))
    );
  } finally {
    restoreFetch();
  }

  const errors: ConcurrencyLevelResult['errors'] = [];
  const hashesByStage: Record<string, Set<string>> = {};
  for (const stage of PIPELINE_STAGES) hashesByStage[stage] = new Set();
  const timingsByStage: Record<string, number[]> = {};
  for (const stage of PIPELINE_STAGES) timingsByStage[stage] = [];
  const totalDurationsMs: number[] = [];

  let successCount = 0;
  let writtenCount = 0;
  let duplicateCount = 0;
  let otherStatusCount = 0;

  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') {
      errors.push({ errorName: 'UnhandledRejection', errorMessage: String(outcome.reason) });
      continue;
    }
    const result = outcome.value;
    totalDurationsMs.push(result.totalDurationMs);
    for (const t of result.timings) timingsByStage[t.stage].push(t.durationMs);

    if (!result.ok) {
      errors.push({ errorName: result.errorName, errorMessage: result.errorMessage });
      continue;
    }
    successCount++;
    for (const stage of PIPELINE_STAGES) hashesByStage[stage].add(result.hashes[stage]);
    if (result.memoryWriteStatus === 'written') writtenCount++;
    else if (result.memoryWriteStatus === 'duplicate') duplicateCount++;
    else otherStatusCount++;
  }

  // Stages upstream of `executionPlan`'s randomly-minted `executionId` (see determinism.ts's
  // finding) are expected to agree exactly across every concurrent run of identical input;
  // stages downstream of it are known to vary per-run for a reason unrelated to concurrency
  // (confirmed in the Determinism Harness), so they're reported but not treated as a
  // concurrency-specific contamination signal on their own.
  const stageAgreement: ConcurrencyLevelResult['stageAgreement'] = {} as ConcurrencyLevelResult['stageAgreement'];
  for (const stage of PIPELINE_STAGES) {
    const distinct = hashesByStage[stage].size;
    stageAgreement[stage] = { distinctHashes: distinct, agree: distinct <= 1 };
  }
  const preExecutionStages: PipelineStage[] = ['context', 'memory', 'reasoningContext', 'prompt', 'decisionIntelligence', 'decisionVerification', 'executionPlan', 'route'];
  const crossContamination = preExecutionStages.some((stage) => !stageAgreement[stage].agree);

  const dedupProbe = await runMemoryWriteDedupProbe(level);

  return {
    level,
    successCount,
    errorCount: errors.length,
    errors: errors.slice(0, 10),
    crossContamination,
    stageAgreement,
    writtenCount,
    duplicateCount,
    otherStatusCount,
    dedupCorrect: dedupProbe.correct,
    dedupProbe,
    timingsByStage: timingsByStage as Record<PipelineStage, number[]>,
    totalDurationsMs,
  };
}

export async function runConcurrencyHarness(levels: readonly number[] = CONCURRENCY_LEVELS): Promise<ConcurrencyLevelResult[]> {
  const results: ConcurrencyLevelResult[] = [];
  for (const level of levels) {
    results.push(await runConcurrencyLevel(level));
  }
  return results;
}

export function buildConcurrencyMarkdown(results: ConcurrencyLevelResult[]): string {
  const lines: string[] = [];
  lines.push('# Concurrency Harness Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(
    toMarkdownTable(
      ['Level', 'Success', 'Errors', 'Cross-Contamination (pre-execution stages)', 'Dedup Probe (1 written + (N-1) duplicate)'],
      results.map((r) => [r.level, r.successCount, r.errorCount, r.crossContamination ? 'YES — FAIL' : 'no', r.dedupCorrect ? `yes (${r.dedupProbe.written}w/${r.dedupProbe.duplicate}d)` : `NO (${JSON.stringify(r.dedupProbe)})`])
    )
  );
  lines.push('');
  lines.push(
    '> "Written"/"Duplicate"/"Other" per full-pipeline run (below, per-level) are **not** used for the dedup ' +
    'verdict: each concurrent pipeline run mints its own OutcomeRecord (via the separately-documented ' +
    '`plan.executionId` determinism gap — see the Determinism Harness report), so full-pipeline runs never ' +
    'collide on the same episodic id by design. The dedup verdict instead comes from a direct probe that fires ' +
    'N concurrent `writeMemory` calls for one identical, hand-built OutcomeRecord — the scenario the writer\'s ' +
    'own idempotency guarantee is meant to hold under.'
  );
  lines.push('');

  const overallOk = results.every((r) => r.errorCount === 0 && !r.crossContamination && r.dedupCorrect);
  lines.push(`Overall verdict: ${overallOk ? '✅ THREAD-SAFE (no race conditions / no cross-contamination observed)' : '❌ ISSUES FOUND'}`);
  lines.push('');

  for (const r of results) {
    lines.push(`## Level ${r.level}`);
    lines.push('');
    lines.push('### Per-Stage Hash Agreement');
    lines.push('');
    lines.push(
      toMarkdownTable(
        ['Stage', 'Distinct Hashes', 'Agree'],
        PIPELINE_STAGES.map((stage) => [stage, r.stageAgreement[stage].distinctHashes, r.stageAgreement[stage].agree ? 'yes' : 'NO'])
      )
    );
    lines.push('');
    if (r.errors.length > 0) {
      lines.push('### Errors (first 10)');
      lines.push('');
      lines.push(toMarkdownTable(['Error', 'Message'], r.errors.map((e) => [e.errorName, e.errorMessage])));
      lines.push('');
    }
    lines.push('### Stage Latency Under Concurrency');
    lines.push('');
    lines.push(
      toMarkdownTable(
        ['Stage', 'Avg (ms)', 'P95 (ms)', 'P99 (ms)'],
        PIPELINE_STAGES.map((stage) => {
          const stats = computeLatencyStats(r.timingsByStage[stage] ?? []);
          return [stage, stats.avg.toFixed(3), stats.p95.toFixed(3), stats.p99.toFixed(3)];
        })
      )
    );
    const totalStats = computeLatencyStats(r.totalDurationsMs);
    lines.push('');
    lines.push(`Total pipeline duration — avg ${totalStats.avg.toFixed(3)}ms, P95 ${totalStats.p95.toFixed(3)}ms, P99 ${totalStats.p99.toFixed(3)}ms (n=${totalStats.count}).`);
    lines.push('');
  }

  lines.push(
    '> Note: `executionResult`/`outcomeRecord`/`memoryWrite` are expected to show >1 distinct hash ' +
    'even at concurrency level 1-vs-1 sequential replay — see the Determinism Harness report for the ' +
    'confirmed root cause (`plan.executionId` is a fresh, non-injectable `randomUUID()` per `buildExecutionPlan` ' +
    'call, and `hashExecutionResult` does not exclude the resulting `metadata.planExecutionId`). This is tracked ' +
    'separately from concurrency-specific contamination, which is what `crossContamination` (computed only over ' +
    'the pre-plan/route stages) measures.'
  );
  lines.push('');

  return lines.join('\n');
}

async function main() {
  console.log(`Running Concurrency Harness at levels: ${CONCURRENCY_LEVELS.join(', ')}...`);
  const results = await runConcurrencyHarness();
  const markdown = buildConcurrencyMarkdown(results);
  const path = writeReport('concurrency', markdown);
  console.log(`Concurrency report written to ${path}`);
  const overallOk = results.every((r) => r.errorCount === 0 && !r.crossContamination && r.dedupCorrect);
  console.log(`Overall: ${overallOk ? 'THREAD-SAFE' : 'ISSUES FOUND'}`);
  if (!overallOk) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
