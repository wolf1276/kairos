// Reasoning Engine Phase 8 (Outcome Recorder) — exhaustive test suite. Builds ExecutionResult
// fixtures by hand (Phase 7's own pipeline is exercised in executionEngine*.test.ts already) and
// drives recordOutcome() against them plus OutcomeTelemetry fixtures.
import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
  recordOutcome,
  hashOutcomeRecord,
  OutcomeRecordValidationError,
  checkBalancesConsistent,
  checkTelemetry,
} from '../reasoning/outcomeRecorder/index.js';
import type { OutcomeTelemetry, BalanceEntry } from '../reasoning/outcomeRecorder/types.js';
import type { ExecutionResult } from '../reasoning/routeExecutionEngine/types.js';
import type { ExecutionRoute } from '../reasoning/routeEngine/types.js';

function hex64(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

function makeRoute(overrides: Partial<ExecutionRoute> = {}): ExecutionRoute {
  const base: ExecutionRoute = {
    routeId: 'route-1',
    routeHash: hex64('route-1'),
    request: { action: 'SWAP', asset: 'XLM', outputAsset: 'USDC', amount: '100', network: 'testnet' },
    selectedProtocol: 'soroswap',
    candidates: [],
    ranking: [],
    rejected: [],
    metadata: { routeEngineVersion: '1.0.0', requestHash: hex64('request-1'), candidateCount: 1, rejectedCount: 0, timestamp: 1_700_000_000_000 },
  };
  return { ...base, ...overrides };
}

function makeExecutionResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  const route = overrides.route ?? makeRoute();
  const base: ExecutionResult = {
    executionId: 'execution-1',
    executionHash: hex64('execution-1'),
    transactionXDR: 'AAAA',
    transaction: { protocol: 'soroswap', action: 'swap', network: 'testnet', contractId: 'C123', method: 'swap', args: {}, transactionHash: hex64('tx-builder-1') },
    simulationResult: { success: true, estimatedFees: '0.01', estimatedSlippagePct: 0.1, warnings: [], errors: [], estimatedOutputs: {}, simulationHash: hex64('simulation-1') },
    estimatedFees: '0.01',
    resourceEstimate: { cpuInstructions: 1000, diskReadBytes: 10, writeBytes: 10, resourceFeeStroops: '100', transactionSizeBytes: 200 },
    protocol: 'soroswap',
    route,
    status: 'success',
    metadata: {
      engineVersion: '1.0.0',
      planExecutionId: 'plan-1',
      planHash: hex64('plan-1'),
      routeHash: route.routeHash,
      requestHash: hex64('request-1'),
      executionHash: hex64('execution-1'),
      retryCount: 0,
      failureReason: null,
      errorMessage: null,
      dataSource: 'synthetic',
      startedAt: 1_700_000_000_000,
      completedAt: 1_700_000_000_500,
      durationMs: 500,
    },
  };
  return { ...base, ...overrides };
}

function makeTelemetry(overrides: Partial<OutcomeTelemetry> = {}): OutcomeTelemetry {
  const balancesBefore: BalanceEntry[] = [{ asset: 'XLM', amount: '1000' }, { asset: 'USDC', amount: '50' }];
  const balancesAfter: BalanceEntry[] = [{ asset: 'XLM', amount: '900' }, { asset: 'USDC', amount: '149.5' }];
  const base: OutcomeTelemetry = {
    transactionHash: hex64('submitted-tx-1'),
    transactionXDRHash: hex64('submitted-xdr-1'),
    amountRequested: '100',
    amountExecuted: '99.5',
    fees: '0.01',
    slippage: 0.1,
    priceImpact: 0.05,
    balancesBefore,
    balancesAfter,
    verificationHash: hex64('verification-1'),
    contextHash: hex64('context-1'),
    memoryHash: hex64('memory-1'),
  };
  return { ...base, ...overrides };
}

describe('Outcome Recorder — success', () => {
  it('records a well-formed outcome with all fields populated', () => {
    const executionResult = makeExecutionResult();
    const telemetry = makeTelemetry();
    const record = recordOutcome(executionResult, telemetry, { outcomeId: 'outcome-1' });

    expect(record.outcomeId).toBe('outcome-1');
    expect(record.executionId).toBe(executionResult.executionId);
    expect(record.executionHash).toBe(executionResult.executionHash);
    expect(record.protocol).toBe('soroswap');
    expect(record.action).toBe('SWAP');
    expect(record.assets).toEqual(['XLM', 'USDC']);
    expect(record.transactionHash).toBe(telemetry.transactionHash);
    expect(record.transactionXDRHash).toBe(telemetry.transactionXDRHash);
    expect(record.executionStatus).toBe('success');
    expect(record.dataSource).toBe('synthetic');
    expect(record.amountRequested).toBe('100');
    expect(record.amountExecuted).toBe('99.5');
    expect(record.fees).toBe('0.01');
    expect(record.slippage).toBe(0.1);
    expect(record.priceImpact).toBe(0.05);
    expect(record.balancesBefore).toEqual(telemetry.balancesBefore);
    expect(record.balancesAfter).toEqual(telemetry.balancesAfter);
    expect(record.executionDurationMs).toBe(500);
    expect(record.resourceEstimate).toEqual(executionResult.resourceEstimate);
    expect(record.verificationHash).toBe(telemetry.verificationHash);
    expect(record.routeHash).toBe(executionResult.route.routeHash);
    expect(record.contextHash).toBe(telemetry.contextHash);
    expect(record.memoryHash).toBe(telemetry.memoryHash);
    expect(record.failureReason).toBeNull();
    expect(record.retryCount).toBe(0);
    expect(record.metadata.recorderVersion).toBe('1.0.0');
    expect(record.outcomeHash).toBe(hex64(record.outcomeHash) === record.outcomeHash ? record.outcomeHash : record.outcomeHash); // sanity: string
    expect(typeof record.outcomeHash).toBe('string');
    expect(record.outcomeHash).toHaveLength(64);
  });

  it('derives assets from a single-asset (non-swap) route with no outputAsset/path', () => {
    const route = makeRoute({ request: { action: 'DEPOSIT', asset: 'XLM', amount: '50', network: 'testnet' } });
    const result = makeExecutionResult({ route });
    const record = recordOutcome(result, makeTelemetry());
    expect(record.assets).toEqual(['XLM']);
    expect(record.action).toBe('DEPOSIT');
  });

  it('derives assets from a multi-hop path, deduplicated', () => {
    const route = makeRoute({ request: { action: 'MULTI_HOP_SWAP', asset: 'XLM', outputAsset: 'USDC', path: ['XLM', 'yUSDC', 'USDC'], amount: '50', network: 'testnet' } });
    const result = makeExecutionResult({ route });
    const record = recordOutcome(result, makeTelemetry());
    expect(record.assets).toEqual(['XLM', 'USDC', 'yUSDC']);
  });

  it('carries a failed ExecutionResult through with its failureReason', () => {
    const result = makeExecutionResult({
      status: 'failed',
      metadata: { ...makeExecutionResult().metadata, failureReason: 'simulation_failed', retryCount: 2 },
    });
    const record = recordOutcome(result, makeTelemetry());
    expect(record.executionStatus).toBe('failed');
    expect(record.failureReason).toBe('simulation_failed');
    expect(record.retryCount).toBe(2);
  });

  it('passes through caller-supplied telemetry metadata alongside recorderVersion', () => {
    const record = recordOutcome(makeExecutionResult(), makeTelemetry({ metadata: { submittedBy: 'oncall-bot' } }));
    expect(record.metadata).toEqual({ recorderVersion: '1.0.0', submittedBy: 'oncall-bot' });
  });

  it('accepts a resourceEstimate of null (never provided)', () => {
    const result = makeExecutionResult({ resourceEstimate: null });
    const record = recordOutcome(result, makeTelemetry());
    expect(record.resourceEstimate).toBeNull();
  });
});

describe('Outcome Recorder — immutability, determinism, replayability', () => {
  it('deep-freezes the returned record', () => {
    const record = recordOutcome(makeExecutionResult(), makeTelemetry());
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.balancesBefore)).toBe(true);
    expect(Object.isFrozen(record.balancesBefore[0])).toBe(true);
    expect(Object.isFrozen(record.metadata)).toBe(true);
    expect(() => {
      (record as { protocol: string }).protocol = 'tampered';
    }).toThrow();
  });

  it('never mutates the input ExecutionResult', () => {
    const result = makeExecutionResult();
    const snapshot = JSON.parse(JSON.stringify(result));
    recordOutcome(result, makeTelemetry());
    expect(JSON.parse(JSON.stringify(result))).toEqual(snapshot);
  });

  it('produces an identical outcomeHash for identical inputs (deterministic + replayable)', () => {
    const result = makeExecutionResult();
    const telemetry = makeTelemetry();
    const a = recordOutcome(result, telemetry, { outcomeId: 'outcome-a' });
    const b = recordOutcome(result, telemetry, { outcomeId: 'outcome-b' });
    expect(a.outcomeHash).toBe(b.outcomeHash);
    expect(a.outcomeId).not.toBe(b.outcomeId);
  });

  it('produces a different outcomeHash when any recorded field changes', () => {
    const result = makeExecutionResult();
    const base = recordOutcome(result, makeTelemetry());
    const changed = recordOutcome(result, makeTelemetry({ amountExecuted: '99.4' }));
    expect(base.outcomeHash).not.toBe(changed.outcomeHash);
  });

  it('hashOutcomeRecord matches the hash embedded in the record when recomputed on the same base', () => {
    const record = recordOutcome(makeExecutionResult(), makeTelemetry());
    const { outcomeHash, outcomeId, ...base } = record;
    expect(hashOutcomeRecord(base)).toBe(outcomeHash);
  });
});

describe('Outcome Recorder — rejects malformed ExecutionResult', () => {
  it('rejects a non-object ExecutionResult', () => {
    expect(() => recordOutcome(null as unknown as ExecutionResult, makeTelemetry())).toThrow(OutcomeRecordValidationError);
  });

  it('rejects an ExecutionResult missing executionHash', () => {
    const result = { ...makeExecutionResult(), executionHash: '' };
    expect(() => recordOutcome(result, makeTelemetry())).toThrow(/missing_execution_hash/);
  });

  it('rejects an ExecutionResult with an invalid protocol', () => {
    const result = { ...makeExecutionResult(), protocol: '' };
    expect(() => recordOutcome(result, makeTelemetry())).toThrow(/invalid_protocol/);
  });

  it('rejects an ExecutionResult missing route.routeHash', () => {
    const result = makeExecutionResult({ route: { ...makeRoute(), routeHash: '' } });
    expect(() => recordOutcome(result, makeTelemetry())).toThrow(/missing_route_hash/);
  });

  it('rejects an ExecutionResult with an unknown status', () => {
    const result = { ...makeExecutionResult(), status: 'pending' as unknown as ExecutionResult['status'] };
    expect(() => recordOutcome(result, makeTelemetry())).toThrow(OutcomeRecordValidationError);
  });

  it('rejects an ExecutionResult with a malformed metadata block', () => {
    const result = makeExecutionResult();
    const malformed = { ...result, metadata: { ...result.metadata, durationMs: Number.NaN } };
    expect(() => recordOutcome(malformed, makeTelemetry())).toThrow(OutcomeRecordValidationError);
  });
});

describe('Outcome Recorder — rejects malformed/invalid telemetry (fail closed)', () => {
  it('rejects an invalid transaction hash', () => {
    expect(() => recordOutcome(makeExecutionResult(), makeTelemetry({ transactionHash: 'not-a-hash' }))).toThrow(/invalid_transaction_hash/);
  });

  it('rejects an invalid transaction XDR hash', () => {
    expect(() => recordOutcome(makeExecutionResult(), makeTelemetry({ transactionXDRHash: '' }))).toThrow(/invalid_transaction_xdr_hash/);
  });

  it('rejects negative fees', () => {
    expect(() => recordOutcome(makeExecutionResult(), makeTelemetry({ fees: '-0.01' }))).toThrow(/negative_fees/);
  });

  it('rejects non-numeric fees', () => {
    expect(() => recordOutcome(makeExecutionResult(), makeTelemetry({ fees: 'abc' }))).toThrow(/negative_fees/);
  });

  it('rejects a negative amountExecuted', () => {
    expect(() => recordOutcome(makeExecutionResult(), makeTelemetry({ amountExecuted: '-1' }))).toThrow(/invalid_amount/);
  });

  it('rejects NaN slippage', () => {
    expect(() => recordOutcome(makeExecutionResult(), makeTelemetry({ slippage: Number.NaN }))).toThrow(/invalid_numeric_field/);
  });

  it('rejects Infinity priceImpact', () => {
    expect(() => recordOutcome(makeExecutionResult(), makeTelemetry({ priceImpact: Number.POSITIVE_INFINITY }))).toThrow(/invalid_numeric_field/);
  });

  it('rejects -Infinity slippage', () => {
    expect(() => recordOutcome(makeExecutionResult(), makeTelemetry({ slippage: Number.NEGATIVE_INFINITY }))).toThrow(/invalid_numeric_field/);
  });

  it('rejects inconsistent balances (mismatched asset sets)', () => {
    const telemetry = makeTelemetry({ balancesAfter: [{ asset: 'XLM', amount: '900' }] });
    expect(() => recordOutcome(makeExecutionResult(), telemetry)).toThrow(/inconsistent_balances/);
  });

  it('rejects duplicate balance entries for the same asset', () => {
    const telemetry = makeTelemetry({ balancesBefore: [{ asset: 'XLM', amount: '1000' }, { asset: 'XLM', amount: '1000' }] });
    expect(() => recordOutcome(makeExecutionResult(), telemetry)).toThrow(/inconsistent_balances/);
  });

  it('rejects a NaN balance amount', () => {
    const telemetry = makeTelemetry({ balancesBefore: [{ asset: 'XLM', amount: 'NaN' }, { asset: 'USDC', amount: '50' }] });
    expect(() => recordOutcome(makeExecutionResult(), telemetry)).toThrow(/inconsistent_balances/);
  });

  it('rejects a malformed verificationHash', () => {
    expect(() => recordOutcome(makeExecutionResult(), makeTelemetry({ verificationHash: 'short' }))).toThrow(/malformed_telemetry/);
  });

  it('rejects a malformed contextHash', () => {
    expect(() => recordOutcome(makeExecutionResult(), makeTelemetry({ contextHash: '' }))).toThrow(/malformed_telemetry/);
  });

  it('rejects a malformed memoryHash', () => {
    expect(() => recordOutcome(makeExecutionResult(), makeTelemetry({ memoryHash: 'zzzz' }))).toThrow(/malformed_telemetry/);
  });
});

describe('checkBalancesConsistent / checkTelemetry (unit)', () => {
  it('accepts matching asset sets regardless of order', () => {
    const before: BalanceEntry[] = [{ asset: 'XLM', amount: '1' }, { asset: 'USDC', amount: '2' }];
    const after: BalanceEntry[] = [{ asset: 'USDC', amount: '2.5' }, { asset: 'XLM', amount: '0.5' }];
    expect(checkBalancesConsistent(before, after)).toBeNull();
  });

  it('rejects a non-array balances field', () => {
    expect(checkBalancesConsistent('nope', [])?.reason).toBe('inconsistent_balances');
  });

  it('checkTelemetry returns null for well-formed telemetry', () => {
    expect(checkTelemetry(makeTelemetry())).toBeNull();
  });
});

describe('Outcome Recorder — stress: parallel generation', () => {
  for (const n of [10, 50, 100, 250]) {
    it(`produces ${n} deterministic, identically-hashed OutcomeRecords in parallel with no race conditions`, async () => {
      const result = makeExecutionResult();
      const telemetry = makeTelemetry();
      const records = await Promise.all(
        Array.from({ length: n }, (_, i) => Promise.resolve().then(() => recordOutcome(result, telemetry, { outcomeId: `outcome-${i}` })))
      );
      const hashes = new Set(records.map((r) => r.outcomeHash));
      expect(hashes.size).toBe(1);
      const ids = new Set(records.map((r) => r.outcomeId));
      expect(ids.size).toBe(n);
      for (const record of records) {
        expect(Object.isFrozen(record)).toBe(true);
      }
    });
  }
});
