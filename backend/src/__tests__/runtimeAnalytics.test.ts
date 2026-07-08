// Runtime Analytics (Phase 6) tests, pure half. No `os`/`process` sampling and no live scheduler
// here — see snapshot.ts for the live-reading side, deliberately untested by unit tests.
import { describe, expect, it } from 'vitest';
import {
  computePipelineLatencyReport,
  computeTokenThroughput,
  evaluateSchedulerHealth,
} from '../runtimeAnalytics/analytics.js';
import type { PipelineResult } from '../runtime/pipelineRunner/types.js';
import type { SchedulerStatus } from '../runner.js';

function result(overrides: Partial<PipelineResult> = {}): PipelineResult {
  return {
    success: true,
    startedAt: 0,
    finishedAt: 100,
    totalDurationMs: 100,
    stageDurations: {
      context: 10,
      memory: 10,
      reasoning: 30,
      decision: 10,
      verification: 10,
      plan: 10,
      route: 5,
      execution: 10,
      outcome: 3,
      memoryWrite: 1,
      learning: 1,
    },
    ...overrides,
  };
}

describe('computePipelineLatencyReport', () => {
  it('returns zeroed report for no runs', () => {
    const report = computePipelineLatencyReport([]);
    expect(report.runCount).toBe(0);
    expect(report.avgTotalMs).toBe(0);
    expect(report.stages.find((s) => s.stage === 'reasoning')).toMatchObject({ runCount: 0, avgMs: 0 });
  });

  it('aggregates total and per-stage durations across runs', () => {
    const results = [
      result({ totalDurationMs: 100, stageDurations: { reasoning: 20 } }),
      result({ totalDurationMs: 200, stageDurations: { reasoning: 40 } }),
    ];
    const report = computePipelineLatencyReport(results);
    expect(report.runCount).toBe(2);
    expect(report.successCount).toBe(2);
    expect(report.failureCount).toBe(0);
    expect(report.avgTotalMs).toBe(150);
    expect(report.minTotalMs).toBe(100);
    expect(report.maxTotalMs).toBe(200);
    const reasoning = report.stages.find((s) => s.stage === 'reasoning')!;
    expect(reasoning.runCount).toBe(2);
    expect(reasoning.avgMs).toBe(30);
    expect(reasoning.minMs).toBe(20);
    expect(reasoning.maxMs).toBe(40);
  });

  it('excludes a stage from its samples when a run has no duration recorded for it', () => {
    const results = [
      result({ success: false, stageDurations: { context: 10 }, failureStage: 'memory' }),
      result({ stageDurations: { context: 10, memory: 20 } }),
    ];
    const report = computePipelineLatencyReport(results);
    expect(report.failureCount).toBe(1);
    const memory = report.stages.find((s) => s.stage === 'memory')!;
    expect(memory.runCount).toBe(1);
    expect(memory.avgMs).toBe(20);
  });
});

describe('computeTokenThroughput', () => {
  it('derives tokens/sec from totals, sorted by provider:model', () => {
    const throughput = computeTokenThroughput([
      { provider: 'openai', model: 'gpt-4o-mini', totalTokens: 1000, totalProviderLatencyMs: 2000 },
      { provider: 'anthropic', model: 'claude', totalTokens: 500, totalProviderLatencyMs: 500 },
    ]);
    expect(throughput.map((t) => `${t.provider}:${t.model}`)).toEqual(['anthropic:claude', 'openai:gpt-4o-mini']);
    expect(throughput[0].tokensPerSec).toBeCloseTo(1000);
    expect(throughput[1].tokensPerSec).toBeCloseTo(500);
  });

  it('reports null tokensPerSec when no latency has been observed', () => {
    const [entry] = computeTokenThroughput([
      { provider: 'openai', model: 'gpt-4o-mini', totalTokens: 0, totalProviderLatencyMs: 0 },
    ]);
    expect(entry.tokensPerSec).toBeNull();
  });
});

function schedulerStatus(overrides: Partial<SchedulerStatus> = {}): SchedulerStatus {
  return {
    running: true,
    cycleInProgress: false,
    cycleCount: 5,
    lastCycleStartedAt: 1000,
    lastCycleFinishedAt: 1100,
    lastCycleDurationMs: 100,
    intervalMs: 1000,
    ...overrides,
  };
}

describe('evaluateSchedulerHealth', () => {
  it('reports stopped when the scheduler is not running', () => {
    const health = evaluateSchedulerHealth(schedulerStatus({ running: false }), 5000);
    expect(health.level).toBe('stopped');
    expect(health.msSinceLastCycle).toBeNull();
  });

  it('reports unknown when running but no cycle has ever completed', () => {
    const health = evaluateSchedulerHealth(
      schedulerStatus({ lastCycleFinishedAt: null, lastCycleStartedAt: null }),
      5000
    );
    expect(health.level).toBe('unknown');
  });

  it('reports healthy within the stale window', () => {
    const health = evaluateSchedulerHealth(schedulerStatus({ lastCycleFinishedAt: 1000, intervalMs: 1000 }), 2500);
    expect(health.level).toBe('healthy');
    expect(health.msSinceLastCycle).toBe(1500);
  });

  it('reports stalled once the gap exceeds staleFactor * intervalMs', () => {
    const health = evaluateSchedulerHealth(schedulerStatus({ lastCycleFinishedAt: 1000, intervalMs: 1000 }), 5000);
    expect(health.level).toBe('stalled');
    expect(health.msSinceLastCycle).toBe(4000);
  });
});
