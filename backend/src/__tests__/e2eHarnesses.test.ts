// Regression coverage for the E2E production test harnesses (benchmarks/e2e/*). Runs each
// harness at a small scale suitable for CI — the full-scale runs (500 iterations / up to 250
// concurrency) are exercised via `npm run benchmark:determinism` / `benchmark:concurrency` /
// `benchmark:reliability`, not here.
import { describe, it, expect } from 'vitest';
import { runPipeline } from '../../benchmarks/e2e/pipeline.js';
import { buildFixtures } from '../../benchmarks/e2e/fixtures.js';
import { buildProtocolRegistry } from '../../benchmarks/e2e/registry.js';
import { runDeterminismHarness } from '../../benchmarks/e2e/runners/determinism.js';
import { runConcurrencyLevel } from '../../benchmarks/e2e/runners/concurrency.js';
import { runReliabilityHarness } from '../../benchmarks/e2e/runners/reliability.js';
import { PIPELINE_STAGES } from '../../benchmarks/e2e/pipeline.js';

describe('E2E pipeline runner', () => {
  it('runs the full backend pipeline end-to-end and produces every stage hash', async () => {
    const result = await runPipeline();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const stage of PIPELINE_STAGES) {
      expect(result.hashes[stage]).toMatch(/^[0-9a-f]{64,}$/);
    }
    expect(result.executionStatus).toBe('success');
  });

  it('upstream-of-plan stages are deterministic across repeated runs against identical fixtures', async () => {
    const fixtures = buildFixtures();
    const registry = buildProtocolRegistry();
    const r1 = await runPipeline(fixtures, { registry, now: 1_700_000_000_000 });
    const r2 = await runPipeline(fixtures, { registry, now: 1_700_000_000_000 });
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    for (const stage of ['context', 'memory', 'reasoningContext', 'prompt', 'decisionIntelligence', 'decisionVerification', 'executionPlan', 'route'] as const) {
      expect(r1.hashes[stage]).toBe(r2.hashes[stage]);
    }
  });
});

describe('Determinism Harness', () => {
  it('reports deterministic hashes for every stage upstream of plan.executionId, at small scale', async () => {
    const report = await runDeterminismHarness(5);
    expect(report.successCount).toBe(5);
    expect(report.failureCount).toBe(0);
    const upstream = report.stageResults.filter((s) => !['executionResult', 'outcomeRecord', 'memoryWrite'].includes(s.stage));
    for (const stage of upstream) {
      expect(stage.deterministic).toBe(true);
    }
  }, 30000);
});

describe('Concurrency Harness', () => {
  it('runs 10-way concurrent pipelines with no errors and no pre-execution-stage contamination', async () => {
    const result = await runConcurrencyLevel(10);
    expect(result.errorCount).toBe(0);
    expect(result.successCount).toBe(10);
    expect(result.crossContamination).toBe(false);
  }, 30000);

  it("verifies the Memory Writer's dedup guarantee under real concurrency (1 written + (N-1) duplicate)", async () => {
    const result = await runConcurrencyLevel(25);
    expect(result.dedupCorrect).toBe(true);
    expect(result.dedupProbe.written).toBe(1);
    expect(result.dedupProbe.duplicate).toBe(24);
    expect(result.dedupProbe.errors).toBe(0);
  }, 30000);
});

describe('Reliability Harness', () => {
  it('fails closed on every injected fault scenario', async () => {
    const results = await runReliabilityHarness();
    const failedOpen = results.filter((r) => !r.passed);
    expect(failedOpen).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(17);
  }, 30000);
});
