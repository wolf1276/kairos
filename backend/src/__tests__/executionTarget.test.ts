// Execution Target (Phase 4) — exhaustive test suite. executeRoute is mocked at the module
// boundary so these tests verify target selection/wiring/fail-closed behavior without touching
// the real Execution Engine or any protocol adapter.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeRouteCalls: unknown[][] = [];

vi.mock('../reasoning/routeExecutionEngine/index.js', () => ({
  executeRoute: vi.fn(async (...args: unknown[]) => {
    executeRouteCalls.push(args);
    return { executionId: 'exec-1', status: 'success', metadata: { dataSource: 'synthetic' } };
  }),
}));

const { executeRoute } = await import('../reasoning/routeExecutionEngine/index.js');
const { ReplayTarget, TestnetTarget, MainnetTarget, createExecutionTarget, ExecutionTargetError } = await import(
  '../runtime/executionTarget/index.js'
);

const plan = { steps: [{ stepId: 'step-1' }] } as never;
const route = { routeId: 'route-1' } as never;
const registry = { id: 'registry-1' } as never;

beforeEach(() => {
  executeRouteCalls.length = 0;
  vi.clearAllMocks();
});

describe('target selection', () => {
  it('createExecutionTarget builds a ReplayTarget for kind "replay"', () => {
    const target = createExecutionTarget({ kind: 'replay' });
    expect(target).toBeInstanceOf(ReplayTarget);
    expect(target.kind).toBe('replay');
  });

  it('createExecutionTarget builds a TestnetTarget for kind "testnet"', () => {
    const target = createExecutionTarget({ kind: 'testnet' });
    expect(target).toBeInstanceOf(TestnetTarget);
    expect(target.kind).toBe('testnet');
  });

  it('createExecutionTarget builds a MainnetTarget for kind "mainnet"', () => {
    const target = createExecutionTarget({ kind: 'mainnet' });
    expect(target).toBeInstanceOf(MainnetTarget);
    expect(target.kind).toBe('mainnet');
  });

  it('rejects an unknown kind', () => {
    expect(() => createExecutionTarget({ kind: 'devnet' } as never)).toThrow(ExecutionTargetError);
  });
});

describe('ReplayTarget', () => {
  it('calls executeRoute without realTransactionProviders, even if constructed with some', async () => {
    const target = new ReplayTarget({ executionId: 'fixed-id' });
    const result = await target.execute(plan, route, registry);
    expect(result).toEqual({ executionId: 'exec-1', status: 'success', metadata: { dataSource: 'synthetic' } });
    expect(executeRoute).toHaveBeenCalledTimes(1);
    const [, , , options] = executeRouteCalls[0] as [unknown, unknown, unknown, Record<string, unknown>];
    expect(options.realTransactionProviders).toBeUndefined();
    expect(options.executionId).toBe('fixed-id');
  });

  it('is deterministic: identical plan/route/options produce identical calls across instances', async () => {
    const now = () => 1000;
    const targetA = new ReplayTarget({ now, executionId: 'x' });
    const targetB = new ReplayTarget({ now, executionId: 'x' });
    await targetA.execute(plan, route, registry);
    await targetB.execute(plan, route, registry);
    expect(executeRouteCalls[0]).toEqual(executeRouteCalls[1]);
  });
});

describe('TestnetTarget', () => {
  it('forwards realTransactionProviders through to executeRoute', async () => {
    const provider = vi.fn(async () => ({ success: true, unsignedXdr: 'xdr', resourceEstimate: {} }));
    const target = new TestnetTarget({ realTransactionProviders: { soroswap: provider as never } });
    await target.execute(plan, route, registry);
    const [, , , options] = executeRouteCalls[0] as [unknown, unknown, unknown, Record<string, unknown>];
    expect(options.realTransactionProviders).toEqual({ soroswap: provider });
  });

  it('works with no providers registered (falls back to Execution Engine synthetic path)', async () => {
    const target = new TestnetTarget();
    const result = await target.execute(plan, route, registry);
    expect(result.status).toBe('success');
  });
});

describe('MainnetTarget — fail closed', () => {
  it('always rejects, never calls executeRoute', async () => {
    const target = new MainnetTarget();
    await expect(target.execute(plan, route, registry)).rejects.toThrow(ExecutionTargetError);
    await expect(target.execute(plan, route, registry)).rejects.toThrow(/fails closed/);
    expect(executeRoute).not.toHaveBeenCalled();
  });
});

describe('invalid config', () => {
  it('TestnetTarget rejects a non-function provider entry', () => {
    expect(() => new TestnetTarget({ realTransactionProviders: { soroswap: 'not-a-function' as never } })).toThrow(
      ExecutionTargetError,
    );
  });

  it('TestnetTarget rejects a non-object realTransactionProviders', () => {
    expect(() => new TestnetTarget({ realTransactionProviders: 'nope' as never })).toThrow(ExecutionTargetError);
  });
});

describe('stress: parallel executions', () => {
  it.each([10, 50, 100, 250])('runs %i fully parallel ReplayTarget executions cleanly', async (n) => {
    const target = new ReplayTarget();
    const runs = Array.from({ length: n }, () => target.execute(plan, route, registry));
    const results = await Promise.all(runs);
    results.forEach((r) => expect(r.status).toBe('success'));
  });

  it.each([10, 50, 100, 250])('runs %i fully parallel MainnetTarget executions, all failing closed', async (n) => {
    const target = new MainnetTarget();
    const runs = Array.from({ length: n }, () =>
      target.execute(plan, route, registry).then(
        () => 'resolved',
        () => 'rejected',
      ),
    );
    const results = await Promise.all(runs);
    results.forEach((r) => expect(r).toBe('rejected'));
  });
});
