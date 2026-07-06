// Unit + integration tests for Memory Engine Phase 2: query building, relevance scoring,
// ranking, Top-K selection, and the retrieval orchestrator's assembly of a MemoryRetrievalPackage.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  retrieveMemoryPackage,
  resetAllMemoryProviders,
  getEpisodicMemoryProvider,
  getSemanticMemoryProvider,
  getWorkingMemoryProvider,
  buildRetrievalQuery,
  SCORE_WEIGHTS,
} from '../memoryLayer/index.js';
import type { EpisodicRecord, SemanticFact } from '../memoryLayer/index.js';
import type { AgentContext } from '../agentContext/types.js';

const AGENT_ID = 'agent-retrieval-1';
const CONTEXT_TIMESTAMP = 1_700_000_000_000;

function makeEpisode(overrides: Partial<EpisodicRecord> = {}): EpisodicRecord {
  return {
    id: 'ep-1',
    agentId: AGENT_ID,
    timestamp: CONTEXT_TIMESTAMP - 60_000,
    contextRef: 'snapshot-1',
    decisionRef: 'decision-1',
    executionRef: 'exec-1',
    outcome: 'win',
    pnl: 12.5,
    holdingTimeSeconds: 300,
    confidence: 0.8,
    quality: 'high',
    tags: ['xlm', 'trending', 'yield', 'blend'],
    ...overrides,
  };
}

function makeFact(overrides: Partial<SemanticFact> = {}): SemanticFact {
  return {
    id: 'fact-1',
    agentId: AGENT_ID,
    key: 'blend-liquidity-limit',
    value: 'Blend pool caps single-asset deposits at 250k USDC',
    confidence: 0.9,
    updatedAt: CONTEXT_TIMESTAMP - 120_000,
    tags: ['blend', 'yield'],
    ...overrides,
  };
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

beforeEach(() => {
  resetAllMemoryProviders();
});

describe('buildRetrievalQuery', () => {
  it('derives a normalized, deduplicated, sorted tag set from AgentContext', () => {
    const query = buildRetrievalQuery(makeContext());
    expect(query.agentId).toBe(AGENT_ID);
    expect(query.regime).toBe('trending');
    expect(query.assets).toEqual(['xlm', 'usdc']);
    expect(query.protocols).toEqual(['blend']);
    expect(query.objective).toBe('yield');
    expect(query.riskProfile).toBe('moderate');
    expect(query.tags).toEqual(['blend', 'moderate', 'trending', 'usdc', 'xlm', 'yield']);
    expect(query.now).toBe(CONTEXT_TIMESTAMP);
  });
});

describe('retrieveMemoryPackage', () => {
  it('returns a valid package scoring a fully-matching episode higher than a non-matching one', async () => {
    await getEpisodicMemoryProvider().append(makeEpisode({ id: 'ep-match' }));
    await getEpisodicMemoryProvider().append(
      makeEpisode({ id: 'ep-nomatch', tags: ['btc', 'ranging'], timestamp: CONTEXT_TIMESTAMP - 500_000 })
    );

    const pkg = await retrieveMemoryPackage(makeContext());
    expect(pkg.status).toBe('valid');
    expect(pkg.episodic.length).toBe(1); // the non-matching record shares no tags with the query
    expect(pkg.episodic[0].id).toBe('ep-match');
    expect(pkg.episodic[0].score).toBeGreaterThan(0);
    expect(pkg.episodic[0].scoreBreakdown.total).toBe(pkg.episodic[0].score);
  });

  it('retrieves semantic facts and active working memory', async () => {
    await getSemanticMemoryProvider().upsert(makeFact());
    await getWorkingMemoryProvider().set(AGENT_ID, 'open-position', { size: 100 });

    const pkg = await retrieveMemoryPackage(makeContext());
    expect(pkg.semantic.length).toBe(1);
    expect(pkg.semantic[0].id).toBe('fact-1');
    expect(pkg.working.length).toBe(1);
    expect(pkg.working[0].key).toBe('open-position');
  });

  it('excludes expired working memory entries', async () => {
    await getWorkingMemoryProvider().set(AGENT_ID, 'stale', { x: 1 }, -1);
    const pkg = await retrieveMemoryPackage(makeContext());
    expect(pkg.working.find((w) => w.key === 'stale')).toBeUndefined();
  });

  it('respects configurable Top-K limits', async () => {
    for (let i = 0; i < 15; i++) {
      await getEpisodicMemoryProvider().append(makeEpisode({ id: `ep-${i}` }));
    }
    const defaultPkg = await retrieveMemoryPackage(makeContext());
    expect(defaultPkg.episodic.length).toBe(10);

    const customPkg = await retrieveMemoryPackage(makeContext(), { topKEpisodic: 3 });
    expect(customPkg.episodic.length).toBe(3);
  });

  it('ranks strictly descending by score with a deterministic tie-break', async () => {
    await getEpisodicMemoryProvider().append(makeEpisode({ id: 'ep-a', confidence: 0.9, timestamp: CONTEXT_TIMESTAMP - 10_000 }));
    await getEpisodicMemoryProvider().append(makeEpisode({ id: 'ep-b', confidence: 0.9, timestamp: CONTEXT_TIMESTAMP - 10_000 }));
    await getEpisodicMemoryProvider().append(makeEpisode({ id: 'ep-c', confidence: 0.1, timestamp: CONTEXT_TIMESTAMP - 999_999 }));

    const pkg = await retrieveMemoryPackage(makeContext());
    const scores = pkg.episodic.map((e) => e.score);
    for (let i = 1; i < scores.length; i++) expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    // ep-a and ep-b are identical in every scoring input — tie-break falls to id order.
    const aIdx = pkg.episodic.findIndex((e) => e.id === 'ep-a');
    const bIdx = pkg.episodic.findIndex((e) => e.id === 'ep-b');
    expect(aIdx).toBeLessThan(bIdx);
  });

  it('stamps retrieval metadata: scanned/selected counts and a ranking version', async () => {
    await getEpisodicMemoryProvider().append(makeEpisode());
    const pkg = await retrieveMemoryPackage(makeContext());
    expect(pkg.retrieval.episodicScanned).toBe(1);
    expect(pkg.retrieval.episodicSelected).toBe(1);
    expect(pkg.retrieval.rankingVersion).toBeTruthy();
    expect(pkg.retrieval.retrievalHash).toMatch(/^[0-9a-f]{64}$/);
    expect(pkg.retrieval.retrievalDurationMs).toBeGreaterThanOrEqual(0);
    expect(pkg.retrieval.rankingDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('isolates agents — records from another agent never appear in a package', async () => {
    await getEpisodicMemoryProvider().append(makeEpisode({ id: 'other-agent-ep', agentId: 'agent-other' }));
    await getEpisodicMemoryProvider().append(makeEpisode({ id: 'own-ep' }));
    const pkg = await retrieveMemoryPackage(makeContext());
    expect(pkg.episodic.map((e) => e.id)).toEqual(['own-ep']);
  });

  it('is immutable — the returned package cannot be mutated', async () => {
    await getEpisodicMemoryProvider().append(makeEpisode());
    const pkg = await retrieveMemoryPackage(makeContext());
    expect(() => {
      (pkg as unknown as { status: string }).status = 'invalid';
    }).toThrow();
    expect(() => {
      (pkg.episodic as unknown[]).push({});
    }).toThrow();
  });

  it('rejects a context with no agentId', async () => {
    await expect(retrieveMemoryPackage(makeContext({ agentId: '' }))).rejects.toThrow();
  });
});

describe('determinism', () => {
  it('produces identical ordering, scores, and retrievalHash across repeated retrievals', async () => {
    await getEpisodicMemoryProvider().append(makeEpisode({ id: 'ep-1' }));
    await getEpisodicMemoryProvider().append(makeEpisode({ id: 'ep-2', confidence: 0.5 }));
    await getSemanticMemoryProvider().upsert(makeFact());

    const context = makeContext();
    const first = await retrieveMemoryPackage(context);
    const second = await retrieveMemoryPackage(context);

    expect(second.episodic.map((e) => e.id)).toEqual(first.episodic.map((e) => e.id));
    expect(second.episodic.map((e) => e.score)).toEqual(first.episodic.map((e) => e.score));
    expect(second.retrieval.retrievalHash).toBe(first.retrieval.retrievalHash);
  });

  it('is insensitive to provider insertion order', async () => {
    const context = makeContext();

    await getEpisodicMemoryProvider().append(makeEpisode({ id: 'ep-1' }));
    await getEpisodicMemoryProvider().append(makeEpisode({ id: 'ep-2', confidence: 0.5 }));
    const forward = await retrieveMemoryPackage(context);

    resetAllMemoryProviders();
    await getEpisodicMemoryProvider().append(makeEpisode({ id: 'ep-2', confidence: 0.5 }));
    await getEpisodicMemoryProvider().append(makeEpisode({ id: 'ep-1' }));
    const reversed = await retrieveMemoryPackage(context);

    expect(reversed.episodic.map((e) => e.id)).toEqual(forward.episodic.map((e) => e.id));
    expect(reversed.retrieval.retrievalHash).toBe(forward.retrieval.retrievalHash);
  });

  it('changes retrievalHash when the underlying record set changes', async () => {
    const context = makeContext();
    await getEpisodicMemoryProvider().append(makeEpisode({ id: 'ep-1' }));
    const before = await retrieveMemoryPackage(context);

    await getEpisodicMemoryProvider().append(makeEpisode({ id: 'ep-2', confidence: 0.4 }));
    const after = await retrieveMemoryPackage(context);

    expect(after.retrieval.retrievalHash).not.toBe(before.retrieval.retrievalHash);
  });

  it('runs concurrent retrievals without cross-talk or race conditions', async () => {
    await getEpisodicMemoryProvider().append(makeEpisode({ id: 'ep-1' }));
    const context = makeContext();
    const results = await Promise.all(Array.from({ length: 20 }, () => retrieveMemoryPackage(context)));
    const hashes = new Set(results.map((r) => r.retrieval.retrievalHash));
    expect(hashes.size).toBe(1);
    for (const r of results) expect(r.episodic.map((e) => e.id)).toEqual(['ep-1']);
  });
});

describe('score weights', () => {
  it('sum to 1.0', () => {
    const total = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 9);
  });
});
