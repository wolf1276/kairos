// Production audit tests for Memory Engine Phase 2: corrupted providers, malformed records,
// cross-agent isolation under corruption, duplicate ids, and concurrency/perf at scale.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  retrieveMemoryPackage,
  resetAllMemoryProviders,
  getEpisodicMemoryProvider,
  getSemanticMemoryProvider,
  getWorkingMemoryProvider,
  setEpisodicMemoryProvider,
  setSemanticMemoryProvider,
  setWorkingMemoryProvider,
  resetEpisodicMemoryProvider,
  resetSemanticMemoryProvider,
  resetWorkingMemoryProvider,
} from '../memoryLayer/index.js';
import type { EpisodicRecord, SemanticFact, WorkingMemoryEntry } from '../memoryLayer/index.js';
import type { AgentContext } from '../agentContext/types.js';

const AGENT_ID = 'agent-audit-1';
const CONTEXT_TIMESTAMP = 1_700_000_000_000;

/** query.tags empty -> filterCandidatesByTags falls back to the full candidate list (see
 *  tagIndex.ts), so malformed-tag records reach scoring/validation instead of being excluded
 *  by the tag-overlap filter first — that's what the malformed-input tests below want to probe. */
function makeEmptyTagContext(): AgentContext {
  return makeContext({
    regime: { base: '', label: '' as never, breakout: false, volatilityBand: 'normal' },
    policy: {
      objective: '',
      riskProfile: '',
      allowedAssets: [],
      allowedProtocols: [],
      delegationActive: false,
      spendingLimitPerTrade: null,
      minConfidence: null,
      positionLimit: { maxCapital: null },
      confidence: 0,
    },
  } as unknown as Partial<AgentContext>);
}

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  const base = {
    agentId: AGENT_ID,
    owner: 'owner-1',
    role: 'yield',
    pair: 'XLM/USDC',
    regime: { base: 'trending', label: 'trending', breakout: false, volatilityBand: 'normal' },
    meta: { version: '2.1.0', timestamp: CONTEXT_TIMESTAMP, marketId: 'm-1', snapshotId: 's-1', contextHash: 'h-1' },
    policy: {
      objective: 'yield',
      riskProfile: 'moderate',
      allowedAssets: ['xlm', 'usdc'],
      allowedProtocols: ['blend'],
      delegationActive: true,
      spendingLimitPerTrade: null,
      minConfidence: null,
      positionLimit: { maxCapital: null },
      confidence: 1,
    },
  };
  return { ...base, ...overrides } as unknown as AgentContext;
}

function makeEpisode(overrides: Partial<EpisodicRecord> = {}): EpisodicRecord {
  return {
    id: 'ep-1',
    agentId: AGENT_ID,
    timestamp: CONTEXT_TIMESTAMP - 60_000,
    contextRef: 'snapshot-1',
    decisionRef: null,
    executionRef: null,
    outcome: 'win',
    pnl: 1,
    holdingTimeSeconds: 60,
    confidence: 0.8,
    quality: 'high',
    tags: ['xlm', 'yield', 'blend', 'trending'],
    ...overrides,
  };
}

/** A minimal provider double whose list() returns whatever fixture array it's given verbatim —
 *  used to simulate a corrupted/misbehaving backing store without touching the frozen Phase 1
 *  in-memory implementations. */
function fakeEpisodicProvider(records: unknown[]) {
  return {
    async append() {},
    async list() {
      return records as EpisodicRecord[];
    },
    async get() {
      return null;
    },
    async size() {
      return records.length;
    },
  };
}

function fakeSemanticProvider(facts: unknown[]) {
  return {
    async upsert() {},
    async list() {
      return facts as SemanticFact[];
    },
    async get() {
      return null;
    },
    async clear() {},
    async size() {
      return facts.length;
    },
  };
}

function fakeWorkingProvider(entries: unknown[]) {
  return {
    async get() {
      return null;
    },
    async set() {},
    async invalidate() {},
    async clear() {},
    async list() {
      return entries as WorkingMemoryEntry[];
    },
    async size() {
      return entries.length;
    },
  };
}

beforeEach(() => {
  resetAllMemoryProviders();
});

describe('malformed input — fail closed, never crash', () => {
  it('handles a record with tags: null without throwing, and flags it invalid', async () => {
    setEpisodicMemoryProvider(fakeEpisodicProvider([makeEpisode({ id: 'bad-tags', tags: null as unknown as string[] })]));
    const pkg = await retrieveMemoryPackage(makeEmptyTagContext());
    expect(pkg.episodic.length).toBe(1);
    expect(pkg.episodic[0].score).toBeGreaterThanOrEqual(0);
    expect(pkg.status).toBe('invalid');
    expect(pkg.validation.errors.some((e) => e.includes('malformed tags'))).toBe(true);
    resetEpisodicMemoryProvider();
  });

  it('handles a record with tags: undefined (missing field) without throwing', async () => {
    const record = makeEpisode({ id: 'no-tags' });
    delete (record as { tags?: string[] }).tags;
    setEpisodicMemoryProvider(fakeEpisodicProvider([record]));
    const pkg = await retrieveMemoryPackage(makeEmptyTagContext());
    expect(pkg.episodic.length).toBe(1);
    expect(pkg.status).toBe('invalid');
    resetEpisodicMemoryProvider();
  });

  it('handles tags containing non-string entries without throwing', async () => {
    setEpisodicMemoryProvider(fakeEpisodicProvider([makeEpisode({ id: 'mixed-tags', tags: ['xlm', 123, null] as unknown as string[] })]));
    const pkg = await retrieveMemoryPackage(makeEmptyTagContext());
    expect(pkg.episodic.length).toBe(1);
    expect(pkg.status).toBe('invalid');
    resetEpisodicMemoryProvider();
  });

  it('clamps NaN confidence to a safe score component instead of propagating NaN', async () => {
    setEpisodicMemoryProvider(fakeEpisodicProvider([makeEpisode({ id: 'nan-conf', confidence: NaN })]));
    const pkg = await retrieveMemoryPackage(makeEmptyTagContext());
    expect(Number.isFinite(pkg.episodic[0].score)).toBe(true);
    expect(pkg.status).toBe('invalid'); // Phase 1 validation catches invalid confidence
    resetEpisodicMemoryProvider();
  });

  it('clamps Infinity confidence to a safe score component instead of propagating Infinity', async () => {
    setEpisodicMemoryProvider(fakeEpisodicProvider([makeEpisode({ id: 'inf-conf', confidence: Infinity })]));
    const pkg = await retrieveMemoryPackage(makeEmptyTagContext());
    expect(Number.isFinite(pkg.episodic[0].score)).toBe(true);
    expect(pkg.status).toBe('invalid');
    resetEpisodicMemoryProvider();
  });

  it('handles a semantic fact with malformed tags without throwing', async () => {
    setSemanticMemoryProvider(
      fakeSemanticProvider([
        { id: 'f-1', agentId: AGENT_ID, key: 'k', value: 'v', confidence: 0.5, updatedAt: CONTEXT_TIMESTAMP, tags: 'not-an-array' },
      ])
    );
    const pkg = await retrieveMemoryPackage(makeEmptyTagContext());
    expect(pkg.semantic.length).toBe(1);
    expect(pkg.status).toBe('invalid');
    resetSemanticMemoryProvider();
  });

  it('flags duplicate episodic ids from a corrupted provider and marks the package invalid', async () => {
    setEpisodicMemoryProvider(fakeEpisodicProvider([makeEpisode({ id: 'dup' }), makeEpisode({ id: 'dup' })]));
    const pkg = await retrieveMemoryPackage(makeEmptyTagContext());
    expect(pkg.status).toBe('invalid');
    expect(pkg.validation.errors.some((e) => e.includes('Duplicate'))).toBe(true);
    resetEpisodicMemoryProvider();
  });

  it('never returns NaN/Infinity in any selected score, even given adversarial inputs', async () => {
    setEpisodicMemoryProvider(
      fakeEpisodicProvider([
        makeEpisode({ id: 'a', confidence: NaN, timestamp: NaN }),
        makeEpisode({ id: 'b', confidence: Infinity, timestamp: -Infinity }),
        makeEpisode({ id: 'c', quality: 'not-a-real-quality' as unknown as EpisodicRecord['quality'] }),
      ])
    );
    const pkg = await retrieveMemoryPackage(makeEmptyTagContext());
    for (const record of pkg.episodic) {
      expect(Number.isFinite(record.score)).toBe(true);
      expect(record.score).toBeGreaterThanOrEqual(0);
      expect(record.score).toBeLessThanOrEqual(1);
    }
    resetEpisodicMemoryProvider();
  });
});

describe('cross-agent isolation under a corrupted provider', () => {
  it('drops episodic/semantic/working records whose agentId does not match the requested agent', async () => {
    setEpisodicMemoryProvider(fakeEpisodicProvider([makeEpisode({ id: 'foreign', agentId: 'someone-else' })]));
    setSemanticMemoryProvider(
      fakeSemanticProvider([{ id: 'f-1', agentId: 'someone-else', key: 'k', value: 'v', confidence: 1, updatedAt: CONTEXT_TIMESTAMP, tags: [] }])
    );
    setWorkingMemoryProvider(fakeWorkingProvider([{ agentId: 'someone-else', key: 'k', value: 1, setAt: CONTEXT_TIMESTAMP, expiresAt: null }]));

    const pkg = await retrieveMemoryPackage(makeContext());
    expect(pkg.episodic).toEqual([]);
    expect(pkg.semantic).toEqual([]);
    expect(pkg.working).toEqual([]);

    resetEpisodicMemoryProvider();
    resetSemanticMemoryProvider();
    resetWorkingMemoryProvider();
  });
});

describe('scale and concurrency', () => {
  it('handles 5000 episodic records without a correctness or ordering regression', async () => {
    const provider = getEpisodicMemoryProvider();
    for (let i = 0; i < 5000; i++) {
      await provider.append(makeEpisode({ id: `ep-${i}`, confidence: (i % 100) / 100, timestamp: CONTEXT_TIMESTAMP - i * 1000 }));
    }
    const start = performance.now();
    const pkg = await retrieveMemoryPackage(makeContext());
    const elapsedMs = performance.now() - start;

    expect(pkg.episodic.length).toBe(10);
    expect(pkg.retrieval.episodicScanned).toBe(5000);
    for (let i = 1; i < pkg.episodic.length; i++) expect(pkg.episodic[i - 1].score).toBeGreaterThanOrEqual(pkg.episodic[i].score);
    // Generous bound — this is a regression guard against accidental O(n^2)/O(n log n * k) blowups,
    // not a strict perf SLA.
    expect(elapsedMs).toBeLessThan(1000);
  });

  it('produces identical, race-free results under 100 concurrent retrievals', async () => {
    await getEpisodicMemoryProvider().append(makeEpisode({ id: 'ep-1' }));
    await getEpisodicMemoryProvider().append(makeEpisode({ id: 'ep-2', confidence: 0.4 }));
    const context = makeContext();

    const results = await Promise.all(Array.from({ length: 100 }, () => retrieveMemoryPackage(context)));
    const hashes = new Set(results.map((r) => r.retrieval.retrievalHash));
    expect(hashes.size).toBe(1);
    for (const r of results) expect(r.episodic.map((e) => e.id)).toEqual(['ep-1', 'ep-2']);
  });

  it('keeps distinct agents fully isolated under concurrent cross-agent retrieval', async () => {
    await getEpisodicMemoryProvider().append(makeEpisode({ id: 'a1' }));
    await getEpisodicMemoryProvider().append(makeEpisode({ id: 'b1', agentId: 'agent-b' }));

    const [pkgA, pkgB] = await Promise.all([
      retrieveMemoryPackage(makeContext({ agentId: AGENT_ID })),
      retrieveMemoryPackage(makeContext({ agentId: 'agent-b' })),
    ]);

    expect(pkgA.episodic.map((e) => e.id)).toEqual(['a1']);
    expect(pkgB.episodic.map((e) => e.id)).toEqual(['b1']);
  });
});
