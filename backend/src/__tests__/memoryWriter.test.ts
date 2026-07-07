// Reasoning Engine Phase 9 (Memory Writer) — exhaustive test suite.
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { writeMemory, MemoryWriteValidationError, hashEpisodicId, checkOutcomeRecordWellFormed, checkAgentId } from '../reasoning/memoryWriter/index.js';
import type { OutcomeRecordInput } from '../reasoning/memoryWriter/types.js';
import { InMemoryEpisodicProvider } from '../memoryLayer/providers/inMemoryEpisodicProvider.js';
import { InMemorySemanticProvider } from '../memoryLayer/providers/inMemorySemanticProvider.js';
import { InMemoryWorkingProvider } from '../memoryLayer/providers/inMemoryWorkingProvider.js';

function hex64(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

function makeOutcomeRecord(overrides: Partial<OutcomeRecordInput> = {}): OutcomeRecordInput {
  const base: OutcomeRecordInput = {
    outcomeId: 'outcome-1',
    outcomeHash: hex64('outcome-1'),
    executionId: 'execution-1',
    executionHash: hex64('execution-1'),
    protocol: 'soroswap',
    action: 'SWAP',
    assets: ['XLM', 'USDC'],
    transactionHash: hex64('tx-1'),
    transactionXDRHash: hex64('xdr-1'),
    executionStatus: 'success',
    dataSource: 'synthetic',
    amountRequested: '100',
    amountExecuted: '99.5',
    fees: '0.01',
    slippage: 0.1,
    priceImpact: 0.05,
    balancesBefore: [{ asset: 'XLM', amount: '1000' }, { asset: 'USDC', amount: '50' }],
    balancesAfter: [{ asset: 'XLM', amount: '900' }, { asset: 'USDC', amount: '149.5' }],
    verificationHash: hex64('verification-1'),
    routeHash: hex64('route-1'),
    contextHash: hex64('context-1'),
    memoryHash: hex64('memory-1'),
    failureReason: null,
    retryCount: 0,
  };
  return { ...base, ...overrides };
}

function freshProviders() {
  return { episodic: new InMemoryEpisodicProvider(), semantic: new InMemorySemanticProvider(), working: new InMemoryWorkingProvider() };
}

describe('Memory Writer — success', () => {
  it('writes episodic, semantic, and working memory for a well-formed OutcomeRecord', async () => {
    const providers = freshProviders();
    const record = makeOutcomeRecord();
    const result = await writeMemory(record, { agentId: 'agent-1', timestamp: 1_700_000_000_000, writeId: 'write-1' }, providers);

    expect(result.status).toBe('written');
    expect(result.writeId).toBe('write-1');
    expect(result.outcomeId).toBe('outcome-1');
    expect(result.outcomeHash).toBe(record.outcomeHash);
    expect(result.agentId).toBe('agent-1');

    expect(result.episodic.agentId).toBe('agent-1');
    expect(result.episodic.outcome).toBe('win');
    expect(result.episodic.quality).toBe('medium');
    expect(result.episodic.contextRef).toBe(record.contextHash);
    expect(result.episodic.decisionRef).toBe(record.verificationHash);
    expect(result.episodic.executionRef).toBe(record.executionHash);
    expect(result.episodic.tags).toEqual(['soroswap', 'SWAP', 'success', 'synthetic', 'XLM', 'USDC']);

    expect(result.semantic).toHaveLength(4);
    expect(result.working).toHaveLength(1);
    expect(result.working[0].key).toBe('last_outcome:soroswap:SWAP');

    const storedEpisodic = await providers.episodic.list('agent-1');
    expect(storedEpisodic).toHaveLength(1);
    const storedSemantic = await providers.semantic.list('agent-1');
    expect(storedSemantic).toHaveLength(4);
    const storedWorking = await providers.working.list('agent-1');
    expect(storedWorking).toHaveLength(1);
  });

  it('maps a failed execution to a loss episode', async () => {
    const providers = freshProviders();
    const record = makeOutcomeRecord({ executionStatus: 'failed', failureReason: 'simulation_failed' });
    const result = await writeMemory(record, { agentId: 'agent-1' }, providers);
    expect(result.episodic.outcome).toBe('loss');
  });

  it('maps real dataSource to high quality', async () => {
    const providers = freshProviders();
    const record = makeOutcomeRecord({ dataSource: 'real' });
    const result = await writeMemory(record, { agentId: 'agent-1' }, providers);
    expect(result.episodic.quality).toBe('high');
  });
});

describe('Memory Writer — determinism, replayability, hashing', () => {
  it('produces an identical writeHash for identical inputs regardless of timestamp/writeId', async () => {
    const record = makeOutcomeRecord();
    const a = await writeMemory(record, { agentId: 'agent-1', timestamp: 1, writeId: 'a' }, freshProviders());
    const b = await writeMemory(record, { agentId: 'agent-1', timestamp: 999_999, writeId: 'b' }, freshProviders());
    expect(a.writeHash).toBe(b.writeHash);
    expect(a.episodic.id).toBe(b.episodic.id);
  });

  it('produces different episodic ids for different agents on the same outcome', async () => {
    const record = makeOutcomeRecord();
    const a = await writeMemory(record, { agentId: 'agent-1' }, freshProviders());
    const b = await writeMemory(record, { agentId: 'agent-2' }, freshProviders());
    expect(a.episodic.id).not.toBe(b.episodic.id);
    expect(a.writeHash).not.toBe(b.writeHash);
  });

  it('produces a different writeHash when a recorded field changes', async () => {
    const base = await writeMemory(makeOutcomeRecord(), { agentId: 'agent-1' }, freshProviders());
    const changed = await writeMemory(makeOutcomeRecord({ amountExecuted: '50' }), { agentId: 'agent-1' }, freshProviders());
    expect(base.writeHash).not.toBe(changed.writeHash);
  });

  it('episodic id matches the deterministic hashEpisodicId helper', async () => {
    const record = makeOutcomeRecord();
    const result = await writeMemory(record, { agentId: 'agent-1' }, freshProviders());
    expect(result.episodic.id).toBe(hashEpisodicId(record.outcomeHash, 'agent-1'));
  });

  it('never mutates the input OutcomeRecord', async () => {
    const record = makeOutcomeRecord();
    const snapshot = JSON.parse(JSON.stringify(record));
    await writeMemory(record, { agentId: 'agent-1' }, freshProviders());
    expect(JSON.parse(JSON.stringify(record))).toEqual(snapshot);
  });
});

describe('Memory Writer — idempotency / duplicate writes', () => {
  it('reports duplicate on the second identical write and does not create a second episodic record', async () => {
    const providers = freshProviders();
    const record = makeOutcomeRecord();
    const first = await writeMemory(record, { agentId: 'agent-1' }, providers);
    const second = await writeMemory(record, { agentId: 'agent-1' }, providers);

    expect(first.status).toBe('written');
    expect(second.status).toBe('duplicate');
    expect(first.episodic.id).toBe(second.episodic.id);

    const stored = await providers.episodic.list('agent-1');
    expect(stored).toHaveLength(1);
  });

  it('semantic/working writes are harmlessly re-applied on a duplicate write, still without growth', async () => {
    const providers = freshProviders();
    const record = makeOutcomeRecord();
    await writeMemory(record, { agentId: 'agent-1' }, providers);
    await writeMemory(record, { agentId: 'agent-1' }, providers);

    const semantic = await providers.semantic.list('agent-1');
    expect(semantic).toHaveLength(4);
    const working = await providers.working.list('agent-1');
    expect(working).toHaveLength(1);
  });
});

describe('Memory Writer — rejects malformed input (fail closed)', () => {
  it('rejects a non-object OutcomeRecord', async () => {
    await expect(writeMemory(null as unknown as OutcomeRecordInput, { agentId: 'agent-1' })).rejects.toThrow(MemoryWriteValidationError);
  });

  it('rejects a missing/invalid outcomeHash', async () => {
    const record = makeOutcomeRecord({ outcomeHash: 'not-a-hash' });
    await expect(writeMemory(record, { agentId: 'agent-1' })).rejects.toThrow(/missing_outcome_hash/);
  });

  it('rejects an empty agentId', async () => {
    await expect(writeMemory(makeOutcomeRecord(), { agentId: '' })).rejects.toThrow(/invalid_agent_id/);
  });

  it('rejects an invalid protocol', async () => {
    const record = makeOutcomeRecord({ protocol: '' });
    await expect(writeMemory(record, { agentId: 'agent-1' })).rejects.toThrow(/invalid_protocol/);
  });

  it('rejects an invalid action', async () => {
    const record = makeOutcomeRecord({ action: '' });
    await expect(writeMemory(record, { agentId: 'agent-1' })).rejects.toThrow(/invalid_action/);
  });

  it('rejects an unknown executionStatus', async () => {
    const record = makeOutcomeRecord({ executionStatus: 'pending' as unknown as OutcomeRecordInput['executionStatus'] });
    await expect(writeMemory(record, { agentId: 'agent-1' })).rejects.toThrow(/invalid_status/);
  });

  it('rejects a negative amountExecuted', async () => {
    const record = makeOutcomeRecord({ amountExecuted: '-1' });
    await expect(writeMemory(record, { agentId: 'agent-1' })).rejects.toThrow(/invalid_amount/);
  });

  it('rejects NaN slippage', async () => {
    const record = makeOutcomeRecord({ slippage: Number.NaN });
    await expect(writeMemory(record, { agentId: 'agent-1' })).rejects.toThrow(/invalid_numeric_field/);
  });

  it('rejects Infinity priceImpact', async () => {
    const record = makeOutcomeRecord({ priceImpact: Number.POSITIVE_INFINITY });
    await expect(writeMemory(record, { agentId: 'agent-1' })).rejects.toThrow(/invalid_numeric_field/);
  });

  it('rejects inconsistent balances (mismatched asset sets)', async () => {
    const record = makeOutcomeRecord({ balancesAfter: [{ asset: 'XLM', amount: '900' }] });
    await expect(writeMemory(record, { agentId: 'agent-1' })).rejects.toThrow(/inconsistent_balances/);
  });

  it('rejects duplicate balance entries for the same asset', async () => {
    const record = makeOutcomeRecord({ balancesBefore: [{ asset: 'XLM', amount: '1000' }, { asset: 'XLM', amount: '1000' }] });
    await expect(writeMemory(record, { agentId: 'agent-1' })).rejects.toThrow(/inconsistent_balances/);
  });

  it('rejects an invalid transactionHash', async () => {
    const record = makeOutcomeRecord({ transactionHash: 'short' });
    await expect(writeMemory(record, { agentId: 'agent-1' })).rejects.toThrow(/invalid_hash/);
  });

  it('rejects an invalid verificationHash', async () => {
    const record = makeOutcomeRecord({ verificationHash: '' });
    await expect(writeMemory(record, { agentId: 'agent-1' })).rejects.toThrow(/invalid_hash/);
  });

  it('rejects an empty assets array', async () => {
    const record = makeOutcomeRecord({ assets: [] });
    await expect(writeMemory(record, { agentId: 'agent-1' })).rejects.toThrow(MemoryWriteValidationError);
  });
});

describe('checkOutcomeRecordWellFormed / checkAgentId (unit)', () => {
  it('accepts a well-formed record', () => {
    expect(checkOutcomeRecordWellFormed(makeOutcomeRecord())).toBeNull();
  });

  it('rejects a non-object', () => {
    expect(checkOutcomeRecordWellFormed(42)?.reason).toBe('malformed_outcome_record');
  });

  it('accepts a non-empty agentId', () => {
    expect(checkAgentId('agent-1')).toBeNull();
  });

  it('rejects a whitespace-only agentId', () => {
    expect(checkAgentId('   ')?.reason).toBe('invalid_agent_id');
  });
});

describe('Memory Writer — stress: parallel writes', () => {
  for (const n of [10, 50, 100, 250]) {
    it(`produces exactly one episodic record and deterministic hashes across ${n} parallel writes of the same outcome`, async () => {
      const providers = freshProviders();
      const record = makeOutcomeRecord();
      const results = await Promise.all(
        Array.from({ length: n }, (_, i) => writeMemory(record, { agentId: 'agent-1', writeId: `write-${i}` }, providers))
      );

      const hashes = new Set(results.map((r) => r.writeHash));
      expect(hashes.size).toBe(1);

      const writtenCount = results.filter((r) => r.status === 'written').length;
      const duplicateCount = results.filter((r) => r.status === 'duplicate').length;
      expect(writtenCount).toBe(1);
      expect(duplicateCount).toBe(n - 1);

      const stored = await providers.episodic.list('agent-1');
      expect(stored).toHaveLength(1);
      const semantic = await providers.semantic.list('agent-1');
      expect(semantic).toHaveLength(4);
      const working = await providers.working.list('agent-1');
      expect(working).toHaveLength(1);
    });
  }

  it('handles 100 parallel writes across 5 distinct agents with no cross-agent duplication', async () => {
    const providers = freshProviders();
    const record = makeOutcomeRecord();
    const agents = ['a1', 'a2', 'a3', 'a4', 'a5'];
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) => writeMemory(record, { agentId: agents[i % agents.length] }, providers))
    );
    for (const agentId of agents) {
      const stored = await providers.episodic.list(agentId);
      expect(stored).toHaveLength(1);
    }
    expect(results).toHaveLength(100);
  });
});
