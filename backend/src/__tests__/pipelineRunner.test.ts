// Pipeline Runner (Phase 12) — exhaustive test suite. Drives runPipelineOnce()/KairosPipelineRunner
// against fully faked stage functions (no frozen engine is imported here — DI only).
import { describe, expect, it, vi } from 'vitest';
import {
  KairosPipelineRunner,
  PIPELINE_STAGE_NAMES,
  runPipelineOnce,
  type PipelineAccumulator,
  type PipelineStageName,
  type PipelineStages,
} from '../runtime/pipelineRunner/index.js';

function makeStages(overrides: Partial<PipelineStages> = {}): PipelineStages {
  const base = {} as PipelineStages;
  for (const name of PIPELINE_STAGE_NAMES) {
    base[name] = vi.fn(async (acc: PipelineAccumulator) => ({ stage: name, sawKeys: Object.keys(acc) }));
  }
  return { ...base, ...overrides };
}

describe('success path', () => {
  it('runs every stage in order, threading outputs forward', async () => {
    const callOrder: string[] = [];
    const stages = makeStages();
    for (const name of PIPELINE_STAGE_NAMES) {
      const original = stages[name] as ReturnType<typeof vi.fn>;
      stages[name] = vi.fn(async (acc: PipelineAccumulator) => {
        callOrder.push(name);
        return original(acc);
      });
    }
    const result = await runPipelineOnce(stages);
    expect(result.success).toBe(true);
    expect(callOrder).toEqual([...PIPELINE_STAGE_NAMES]);
    // last stage (learning) should have seen every prior stage's key in the accumulator
    const learningOutput = result.learning as { sawKeys: string[] };
    expect(learningOutput.sawKeys).toEqual(PIPELINE_STAGE_NAMES.slice(0, -1));
  });

  it('populates every PipelineResult field, timings, and no failure fields', async () => {
    const result = await runPipelineOnce(makeStages());
    expect(result.success).toBe(true);
    expect(result.failureStage).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.finishedAt).toBeGreaterThanOrEqual(result.startedAt);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    for (const name of PIPELINE_STAGE_NAMES) {
      expect(result[name]).toBeDefined();
      expect(result.stageDurations[name]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('failure on every stage', () => {
  it.each(PIPELINE_STAGE_NAMES)('stops immediately when %s throws, running no later stage', async (failingStage) => {
    const calledAfterFailure: string[] = [];
    const stages = makeStages();
    stages[failingStage] = vi.fn(async () => {
      throw new Error(`${failingStage} exploded`);
    });
    const failIndex = PIPELINE_STAGE_NAMES.indexOf(failingStage);
    for (const name of PIPELINE_STAGE_NAMES.slice(failIndex + 1)) {
      const original = stages[name] as ReturnType<typeof vi.fn>;
      stages[name] = vi.fn(async (acc: PipelineAccumulator) => {
        calledAfterFailure.push(name);
        return original(acc);
      });
    }

    const result = await runPipelineOnce(stages);

    expect(result.success).toBe(false);
    expect(result.failureStage).toBe(failingStage);
    expect(result.error).toBe(`${failingStage} exploded`);
    expect(calledAfterFailure).toEqual([]);

    // Every stage strictly before the failing one completed and is present on the result.
    for (const name of PIPELINE_STAGE_NAMES.slice(0, failIndex)) {
      expect(result[name]).toBeDefined();
    }
    // The failing stage and everything after must be absent (never fabricate partial output).
    for (const name of PIPELINE_STAGE_NAMES.slice(failIndex)) {
      expect(result[name]).toBeUndefined();
    }
  });

  it('propagates non-Error throw values as a string message', async () => {
    const stages = makeStages({ verification: vi.fn(async () => { throw 'not-an-error-object'; }) });
    const result = await runPipelineOnce(stages);
    expect(result.success).toBe(false);
    expect(result.failureStage).toBe('verification');
    expect(result.error).toBe('not-an-error-object');
  });

  it('treats a stage that rejects (async throw) the same as a synchronous throw', async () => {
    const stages = makeStages({ route: vi.fn(() => Promise.reject(new Error('route rejected'))) });
    const result = await runPipelineOnce(stages);
    expect(result.success).toBe(false);
    expect(result.failureStage).toBe('route');
    expect(result.error).toBe('route rejected');
  });
});

describe('immutability', () => {
  it('freezes the returned PipelineResult and its nested stage outputs', async () => {
    const result = await runPipelineOnce(makeStages());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.context)).toBe(true);
    expect(() => {
      (result as { success: boolean }).success = false;
    }).toThrow();
  });

  it('freezes a failure result too', async () => {
    const stages = makeStages({ plan: vi.fn(async () => { throw new Error('boom'); }) });
    const result = await runPipelineOnce(stages);
    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe('malformed stage output', () => {
  it('passes through whatever a stage returns without validating its shape (validation is the frozen stage’s job)', async () => {
    const stages = makeStages({ decision: vi.fn(async () => undefined) });
    const result = await runPipelineOnce(stages);
    expect(result.success).toBe(true);
    expect(result.decision).toBeUndefined();
    // downstream stage still ran and received the accumulator including the undefined decision key
    expect(result.verification).toBeDefined();
  });
});

describe('dependency injection', () => {
  it('never calls a stage function the caller did not provide for that name — fully caller-controlled', async () => {
    const contextFn = vi.fn(async () => 'ctx-output');
    const stages = makeStages({ context: contextFn });
    await runPipelineOnce(stages);
    expect(contextFn).toHaveBeenCalledTimes(1);
    expect(contextFn).toHaveBeenCalledWith({});
  });
});

describe('deterministic output', () => {
  it('produces the same result shape across repeated runs with pure stage functions', async () => {
    const pureStages: PipelineStages = {} as PipelineStages;
    for (const name of PIPELINE_STAGE_NAMES) {
      pureStages[name] = async () => `${name}-fixed-output`;
    }
    const r1 = await runPipelineOnce(pureStages);
    const r2 = await runPipelineOnce(pureStages);
    for (const name of PIPELINE_STAGE_NAMES) {
      expect(r1[name]).toBe(r2[name]);
    }
    expect(r1.success).toBe(r2.success);
  });
});

describe('KairosPipelineRunner adapter (satisfies AutonomousRuntime PipelineRunner contract)', () => {
  it('maps a successful run to { success: true }', async () => {
    const runner = new KairosPipelineRunner(makeStages());
    const outcome = await runner.runPipeline();
    expect(outcome).toEqual({ success: true });
  });

  it('maps a failing run to { success: false, error }', async () => {
    const stages = makeStages({ execution: vi.fn(async () => { throw new Error('exec down'); }) });
    const runner = new KairosPipelineRunner(stages);
    const outcome = await runner.runPipeline();
    expect(outcome.success).toBe(false);
    expect(outcome.error).toBe('exec down');
  });

  it('exposes the full PipelineResult via run()', async () => {
    const runner = new KairosPipelineRunner(makeStages());
    const result = await runner.run();
    expect(result.stageDurations.learning).toBeGreaterThanOrEqual(0);
  });
});

describe('stress: parallel executions', () => {
  it.each([10, 50, 100, 250])('runs %i fully parallel, independent pipeline executions without cross-contamination', async (n) => {
    const runs = Array.from({ length: n }, (_, i) => {
      const stages = makeStages();
      stages.context = vi.fn(async () => `context-${i}`);
      return runPipelineOnce(stages);
    });
    const results = await Promise.all(runs);
    expect(results).toHaveLength(n);
    results.forEach((result, i) => {
      expect(result.success).toBe(true);
      expect(result.context).toBe(`context-${i}`);
    });
  });
});
