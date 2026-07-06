// Phase 4 — Memory Engine Production Hardening: write-time validation on providers, opt-in
// bounded memory (capacity + oldest-first eviction), and a frozen public-contract check.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetAllMemoryProviders,
  InMemoryEpisodicProvider,
  InMemorySemanticProvider,
  InMemoryWorkingProvider,
} from '../memoryLayer/index.js';
import type { EpisodicRecord, SemanticFact } from '../memoryLayer/index.js';
import * as memoryLayerIndex from '../memoryLayer/index.js';

const AGENT_ID = 'agent-hardening-1';

function makeEpisode(overrides: Partial<EpisodicRecord> = {}): EpisodicRecord {
  return {
    id: 'ep-1',
    agentId: AGENT_ID,
    timestamp: Date.now(),
    contextRef: 'snapshot-1',
    decisionRef: null,
    executionRef: null,
    outcome: 'win',
    pnl: 10,
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
    key: 'k',
    value: 'v',
    confidence: 1,
    updatedAt: Date.now(),
    tags: [],
    ...overrides,
  };
}

beforeEach(() => {
  resetAllMemoryProviders();
});

describe('write-time validation', () => {
  it('InMemoryEpisodicProvider.append() rejects a malformed record instead of silently admitting it', async () => {
    await expect(new InMemoryEpisodicProvider().append(makeEpisode({ confidence: Number.NaN }))).rejects.toThrow(/Invalid EpisodicRecord.*confidence/);
    await expect(new InMemoryEpisodicProvider().append(makeEpisode({ outcome: 'bogus' as never }))).rejects.toThrow(/Invalid EpisodicRecord.*outcome/);
    await expect(new InMemoryEpisodicProvider().append(makeEpisode({ pnl: Number.NaN }))).rejects.toThrow(/Invalid EpisodicRecord.*pnl/);
  });

  it('InMemorySemanticProvider.upsert() rejects a malformed fact', async () => {
    await expect(new InMemorySemanticProvider().upsert(makeFact({ confidence: 2 }))).rejects.toThrow(/Invalid SemanticFact.*confidence/);
    await expect(new InMemorySemanticProvider().upsert(makeFact({ key: '' }))).rejects.toThrow(/Invalid SemanticFact.*key/);
  });

  it('InMemoryWorkingProvider.set() rejects a malformed entry (negative ttl -> invalid expiresAt is not reachable, so test via direct construction guard)', async () => {
    const provider = new InMemoryWorkingProvider();
    // A non-string/empty key is the one malformed shape reachable through the public set() signature.
    await expect(provider.set(AGENT_ID, '', 'value')).rejects.toThrow(/Invalid WorkingMemoryEntry/);
    provider.dispose();
  });

  it('a valid write still succeeds normally (no regression for well-formed data)', async () => {
    const episodic = new InMemoryEpisodicProvider();
    await episodic.append(makeEpisode());
    expect(await episodic.size(AGENT_ID)).toBe(1);
  });
});

describe('bounded memory / eviction (opt-in, oldest-first)', () => {
  it('unbounded by default: capacityPerAgent unset never evicts', async () => {
    const episodic = new InMemoryEpisodicProvider();
    for (let i = 0; i < 50; i++) await episodic.append(makeEpisode({ id: `ep-${i}` }));
    expect(await episodic.size(AGENT_ID)).toBe(50);
  });

  it('InMemoryEpisodicProvider evicts the oldest record once capacityPerAgent is exceeded', async () => {
    const episodic = new InMemoryEpisodicProvider({ capacityPerAgent: 3 });
    for (let i = 0; i < 5; i++) await episodic.append(makeEpisode({ id: `ep-${i}` }));
    const list = await episodic.list(AGENT_ID);
    expect(list.map((r) => r.id)).toEqual(['ep-2', 'ep-3', 'ep-4']);
  });

  it('InMemorySemanticProvider evicts the oldest-touched key once capacityPerAgent is exceeded', async () => {
    const semantic = new InMemorySemanticProvider({ capacityPerAgent: 2 });
    await semantic.upsert(makeFact({ id: 'f1', key: 'k1' }));
    await semantic.upsert(makeFact({ id: 'f2', key: 'k2' }));
    await semantic.upsert(makeFact({ id: 'f3', key: 'k3' }));
    const list = await semantic.list(AGENT_ID);
    expect(list.map((f) => f.key).sort()).toEqual(['k2', 'k3']);
  });

  it('re-upserting an existing key counts as a touch, not eviction bait', async () => {
    const semantic = new InMemorySemanticProvider({ capacityPerAgent: 2 });
    await semantic.upsert(makeFact({ id: 'f1', key: 'k1' }));
    await semantic.upsert(makeFact({ id: 'f2', key: 'k2' }));
    await semantic.upsert(makeFact({ id: 'f1', key: 'k1', value: 'updated' }));
    await semantic.upsert(makeFact({ id: 'f3', key: 'k3' }));
    const list = await semantic.list(AGENT_ID);
    expect(list.map((f) => f.key).sort()).toEqual(['k1', 'k3']);
  });

  it('rejects a non-positive-integer capacityPerAgent at construction', () => {
    expect(() => new InMemoryEpisodicProvider({ capacityPerAgent: 0 })).toThrow(/capacityPerAgent/);
    expect(() => new InMemorySemanticProvider({ capacityPerAgent: -1 })).toThrow(/capacityPerAgent/);
    expect(() => new InMemoryWorkingProvider({ capacityPerAgent: 1.5 })).toThrow(/capacityPerAgent/);
  });
});

describe('frozen public contract', () => {
  it('memoryLayer/index.ts exports exactly the frozen Phase 1-3 public surface', () => {
    // Locks the public API surface: an accidental removal/rename here should fail loudly, not
    // silently break a downstream import. Adding a genuinely new, intentional export is expected
    // to require updating this list (and, per Phase 4 policy, the architecture doc) in the same PR.
    const expectedExports = [
      'assembleMemoryPackage',
      'MemoryOrchestratorError',
      'validateMemoryPackage',
      'getEpisodicMemoryProvider',
      'setEpisodicMemoryProvider',
      'resetEpisodicMemoryProvider',
      'getSemanticMemoryProvider',
      'setSemanticMemoryProvider',
      'resetSemanticMemoryProvider',
      'getWorkingMemoryProvider',
      'setWorkingMemoryProvider',
      'resetWorkingMemoryProvider',
      'resetAllMemoryProviders',
      'InMemoryEpisodicProvider',
      'InMemorySemanticProvider',
      'InMemoryWorkingProvider',
      'MEMORY_PACKAGE_SCHEMA_VERSION',
      'getMemoryMetricsSnapshot',
      'resetMemoryMetrics',
      'retrieveMemoryPackage',
      'MemoryRetrievalError',
      'buildRetrievalQuery',
      'validateRetrieval',
      'getRetrievalMetricsSnapshot',
      'resetRetrievalMetrics',
      'SCORE_WEIGHTS',
      'DEFAULT_TOP_K_EPISODIC',
      'DEFAULT_TOP_K_SEMANTIC',
      'DEFAULT_TOP_K_WORKING',
      'RETRIEVAL_RANKING_VERSION',
      'buildMemoryIntelligencePackage',
      'computeStatistics',
      'detectPatterns',
      'analyzeConflicts',
      'buildEvidence',
      'aggregateByTag',
      'validateIntelligence',
      'getIntelligenceMetricsSnapshot',
      'resetIntelligenceMetrics',
      'INTELLIGENCE_VERSION',
      'MIN_PATTERN_SUPPORT',
      'MIN_STREAK_LENGTH',
      'PROFITABLE_WIN_RATE_THRESHOLD',
      'LOSING_WIN_RATE_THRESHOLD',
    ].sort();

    const actualExports = Object.keys(memoryLayerIndex).sort();
    expect(actualExports).toEqual(expectedExports);
  });
});
