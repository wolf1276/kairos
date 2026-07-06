// Determinism/replay tests for the Memory Engine: two assemblies over identical underlying
// records must hash identically regardless of wall-clock time or insertion order, and metadata
// fields that are inherently build-specific (packageId/timestamp) must still vary per call.
import { describe, it, expect, beforeEach } from 'vitest';
import { assembleMemoryPackage, resetAllMemoryProviders, getEpisodicMemoryProvider, getSemanticMemoryProvider } from '../memoryLayer/index.js';
import type { EpisodicRecord, SemanticFact } from '../memoryLayer/index.js';

const AGENT_ID = 'agent-replay';

function makeEpisode(id: string): EpisodicRecord {
  return {
    id,
    agentId: AGENT_ID,
    timestamp: 1_700_000_000_000,
    contextRef: 'snapshot-1',
    decisionRef: null,
    executionRef: null,
    outcome: 'neutral',
    pnl: null,
    holdingTimeSeconds: null,
    confidence: 0.5,
    quality: 'medium',
    tags: [],
  };
}

function makeFact(key: string): SemanticFact {
  return { id: `fact-${key}`, agentId: AGENT_ID, key, value: 'v', confidence: 1, updatedAt: 1_700_000_000_000, tags: [] };
}

beforeEach(() => {
  resetAllMemoryProviders();
});

describe('MemoryPackage determinism', () => {
  it('produces the same packageHash for two assemblies over identical underlying records', async () => {
    await getEpisodicMemoryProvider().append(makeEpisode('ep-1'));
    await getSemanticMemoryProvider().upsert(makeFact('k1'));

    const first = await assembleMemoryPackage(AGENT_ID);
    const second = await assembleMemoryPackage(AGENT_ID);

    expect(first.meta.packageHash).toBe(second.meta.packageHash);
    // Build-specific fields must still differ per call.
    expect(first.meta.packageId).not.toBe(second.meta.packageId);
  });

  it('is insensitive to record insertion order (stable stringify sorts object keys)', async () => {
    await getEpisodicMemoryProvider().append(makeEpisode('ep-a'));
    await getEpisodicMemoryProvider().append(makeEpisode('ep-b'));
    const orderedForward = await assembleMemoryPackage(AGENT_ID);

    resetAllMemoryProviders();
    await getEpisodicMemoryProvider().append(makeEpisode('ep-a'));
    await getEpisodicMemoryProvider().append(makeEpisode('ep-b'));
    const orderedAgain = await assembleMemoryPackage(AGENT_ID);

    expect(orderedForward.meta.packageHash).toBe(orderedAgain.meta.packageHash);
  });

  it('produces a different packageHash when the underlying records differ', async () => {
    await getEpisodicMemoryProvider().append(makeEpisode('ep-1'));
    const before = await assembleMemoryPackage(AGENT_ID);

    await getEpisodicMemoryProvider().append(makeEpisode('ep-2'));
    const after = await assembleMemoryPackage(AGENT_ID);

    expect(before.meta.packageHash).not.toBe(after.meta.packageHash);
  });
});
