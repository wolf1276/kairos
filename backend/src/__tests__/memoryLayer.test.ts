// Unit + integration tests for the Memory Engine foundation: providers, validation, and the
// orchestrator's assembly of an immutable MemoryPackage.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  assembleMemoryPackage,
  resetAllMemoryProviders,
  getEpisodicMemoryProvider,
  getSemanticMemoryProvider,
  getWorkingMemoryProvider,
  setEpisodicMemoryProvider,
  setWorkingMemoryProvider,
  validateMemoryPackage,
  MEMORY_PACKAGE_SCHEMA_VERSION,
  InMemoryEpisodicProvider,
  InMemoryWorkingProvider,
} from '../memoryLayer/index.js';
import { stableStringify } from '../stableStringify.js';
import type { EpisodicRecord, SemanticFact } from '../memoryLayer/index.js';

const AGENT_ID = 'agent-1';

function makeEpisode(overrides: Partial<EpisodicRecord> = {}): EpisodicRecord {
  return {
    id: 'ep-1',
    agentId: AGENT_ID,
    timestamp: Date.now(),
    contextRef: 'snapshot-1',
    decisionRef: 'decision-1',
    executionRef: 'exec-1',
    outcome: 'win',
    pnl: 12.5,
    holdingTimeSeconds: 300,
    confidence: 0.8,
    quality: 'high',
    tags: ['xlm'],
    ...overrides,
  };
}

function makeFact(overrides: Partial<SemanticFact> = {}): SemanticFact {
  return {
    id: 'fact-1',
    agentId: AGENT_ID,
    key: 'preferred-pair',
    value: 'XLM/USDC',
    confidence: 1,
    updatedAt: Date.now(),
    tags: [],
    ...overrides,
  };
}

beforeEach(() => {
  resetAllMemoryProviders();
});

describe('EpisodicMemoryProvider — immutability', () => {
  it('appends and lists episodes for an agent', async () => {
    await getEpisodicMemoryProvider().append(makeEpisode());
    const list = await getEpisodicMemoryProvider().list(AGENT_ID);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('ep-1');
  });

  it('rejects appending a duplicate id', async () => {
    await getEpisodicMemoryProvider().append(makeEpisode());
    await expect(getEpisodicMemoryProvider().append(makeEpisode())).rejects.toThrow(/already exists/);
  });

  it('exposes no update or delete method on the interface', () => {
    const provider = new InMemoryEpisodicProvider();
    expect((provider as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((provider as unknown as Record<string, unknown>).delete).toBeUndefined();
  });
});

describe('SemanticMemoryProvider', () => {
  it('upsert replaces the fact for the same key', async () => {
    await getSemanticMemoryProvider().upsert(makeFact({ value: 'XLM/USDC' }));
    await getSemanticMemoryProvider().upsert(makeFact({ value: 'BTC/USDC' }));
    const list = await getSemanticMemoryProvider().list(AGENT_ID);
    expect(list).toHaveLength(1);
    expect(list[0].value).toBe('BTC/USDC');
  });
});

describe('WorkingMemoryProvider', () => {
  it('set/get round-trips a value and invalidate removes it', async () => {
    await getWorkingMemoryProvider().set(AGENT_ID, 'tick-state', { open: true });
    expect((await getWorkingMemoryProvider().get(AGENT_ID, 'tick-state'))?.value).toEqual({ open: true });
    await getWorkingMemoryProvider().invalidate(AGENT_ID, 'tick-state');
    expect(await getWorkingMemoryProvider().get(AGENT_ID, 'tick-state')).toBeNull();
  });

  it('expires entries past their ttl', async () => {
    await getWorkingMemoryProvider().set(AGENT_ID, 'short-lived', 1, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await getWorkingMemoryProvider().get(AGENT_ID, 'short-lived')).toBeNull();
  });
});

describe('validateMemoryPackage', () => {
  it('accepts a well-formed set of records', () => {
    const result = validateMemoryPackage({
      episodic: [makeEpisode()],
      semantic: [makeFact()],
      working: [],
      schemaVersion: MEMORY_PACKAGE_SCHEMA_VERSION,
    });
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it('fails closed on a duplicate episodic id', () => {
    const result = validateMemoryPackage({
      episodic: [makeEpisode(), makeEpisode()],
      semantic: [],
      working: [],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Duplicate episodic record id'))).toBe(true);
  });

  it('fails closed on an invalid outcome', () => {
    const result = validateMemoryPackage({
      episodic: [makeEpisode({ outcome: 'bogus' as EpisodicRecord['outcome'] })],
      semantic: [],
      working: [],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('invalid outcome'))).toBe(true);
  });

  it('fails closed on an out-of-range confidence', () => {
    const result = validateMemoryPackage({
      episodic: [makeEpisode({ confidence: 1.5 })],
      semantic: [],
      working: [],
    });
    expect(result.ok).toBe(false);
  });

  it('fails closed on a schema version mismatch', () => {
    const result = validateMemoryPackage({ episodic: [], semantic: [], working: [], schemaVersion: '0.0.1' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('schema version'))).toBe(true);
  });
});

describe('MemoryOrchestrator — assembleMemoryPackage', () => {
  it('assembles an empty but valid package when no memory exists yet', async () => {
    const pkg = await assembleMemoryPackage(AGENT_ID);
    expect(pkg.status).toBe('valid');
    expect(pkg.episodic).toEqual([]);
    expect(pkg.semantic).toEqual([]);
    expect(pkg.working).toEqual([]);
    expect(pkg.meta.agentId).toBe(AGENT_ID);
    expect(pkg.meta.version).toBe(MEMORY_PACKAGE_SCHEMA_VERSION);
  });

  it('assembles episodic, semantic, and working records from their providers', async () => {
    await getEpisodicMemoryProvider().append(makeEpisode());
    await getSemanticMemoryProvider().upsert(makeFact());
    await getWorkingMemoryProvider().set(AGENT_ID, 'k', 'v');

    const pkg = await assembleMemoryPackage(AGENT_ID);
    expect(pkg.episodic).toHaveLength(1);
    expect(pkg.semantic).toHaveLength(1);
    expect(pkg.working).toHaveLength(1);
    expect(pkg.status).toBe('valid');
  });

  it('returns an invalid package (not a thrown error) when a provider yields a malformed record', async () => {
    setEpisodicMemoryProvider({
      append: async () => {},
      list: async () => [makeEpisode({ confidence: 5 })],
      get: async () => null,
      size: async () => 1,
    });

    const pkg = await assembleMemoryPackage(AGENT_ID);
    expect(pkg.status).toBe('invalid');
    expect(pkg.validation.ok).toBe(false);
  });

  it('freezes the returned package', async () => {
    const pkg = await assembleMemoryPackage(AGENT_ID);
    expect(Object.isFrozen(pkg)).toBe(true);
  });

  it('throws MemoryOrchestratorError for an empty agentId', async () => {
    await expect(assembleMemoryPackage('')).rejects.toThrow(/non-empty agentId/);
  });

  it('rejects a provider swap missing a required method', () => {
    expect(() =>
      setEpisodicMemoryProvider({
        append: async () => {},
        list: async () => [],
      } as never)
    ).toThrow(/missing required method/);
  });

  it('isolates memory between different agents', async () => {
    await getEpisodicMemoryProvider().append(makeEpisode({ agentId: 'agent-a', id: 'ep-a' }));
    await getEpisodicMemoryProvider().append(makeEpisode({ agentId: 'agent-b', id: 'ep-b' }));

    const pkgA = await assembleMemoryPackage('agent-a');
    const pkgB = await assembleMemoryPackage('agent-b');
    expect(pkgA.episodic.map((e) => e.id)).toEqual(['ep-a']);
    expect(pkgB.episodic.map((e) => e.id)).toEqual(['ep-b']);
  });

  it('filters mis-keyed records whose agentId does not match the requested agent', async () => {
    await getEpisodicMemoryProvider().append(makeEpisode({ agentId: 'real-agent', id: 'ep-1' }));
    await getEpisodicMemoryProvider().append(makeEpisode({ agentId: 'wrong-agent', id: 'ep-2' }));

    const pkg = await assembleMemoryPackage('real-agent');
    expect(pkg.episodic).toHaveLength(1);
    expect(pkg.episodic[0].id).toBe('ep-1');
  });

  it('deep-freezes the returned package — nested arrays and objects are immutable', async () => {
    const pkg = await assembleMemoryPackage(AGENT_ID);
    expect(Object.isFrozen(pkg)).toBe(true);
    // Nested arrays must be frozen
    expect(Object.isFrozen(pkg.episodic)).toBe(true);
    expect(Object.isFrozen(pkg.validation.errors)).toBe(true);
  });

  it('rejects swapping an episodic provider during active assembly', async () => {
    // Start an assembly and swap during the same microtask path
    const promise = assembleMemoryPackage(AGENT_ID);
    expect(() => setEpisodicMemoryProvider(new InMemoryEpisodicProvider())).toThrow(/active assembly/);
    await promise;
  });

  it('supports non-expiring working memory entries via Infinity ttl', async () => {
    const provider = new InMemoryWorkingProvider();
    await provider.set(AGENT_ID, 'eternal', 'forever', Infinity);
    const entry = await provider.get(AGENT_ID, 'eternal');
    expect(entry).not.toBeNull();
    expect(entry!.expiresAt).toBeNull();
    // Verify it survives a normal sweep
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await provider.get(AGENT_ID, 'eternal')).not.toBeNull();
  });

  it('rejects working memory entries with negative expiresAt in validation', () => {
    const result = validateMemoryPackage({
      episodic: [],
      semantic: [],
      working: [{ agentId: AGENT_ID, key: 'neg', value: 1, setAt: Date.now(), expiresAt: -1000 }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('expiresAt'))).toBe(true);
  });
});

describe('stableStringify — hash determinism guards', () => {
  it('distinguishes undefined from the string "undefined"', () => {
    const withUndef = stableStringify({ a: undefined });
    const withStr = stableStringify({ a: 'undefined' });
    expect(withUndef).not.toBe(withStr);
  });

  it('serializes Date objects to ISO strings, not empty objects', () => {
    const d = new Date('2024-01-01T00:00:00Z');
    const result = stableStringify({ t: d });
    expect(result).toContain('2024-01-01');
    expect(result).not.toBe('{}');
  });

  it('does not crash on BigInt values', () => {
    expect(() => stableStringify({ n: BigInt(1) })).not.toThrow();
    const result = stableStringify({ n: BigInt(1) });
    expect(result).toBeTruthy();
  });

  it('does not crash on Symbol values', () => {
    expect(() => stableStringify({ s: Symbol('test') })).not.toThrow();
  });

  it('produces identical output for identical inputs', () => {
    const a = stableStringify({ b: 2, a: 1 });
    const b = stableStringify({ a: 1, b: 2 });
    expect(a).toBe(b);
  });
});
