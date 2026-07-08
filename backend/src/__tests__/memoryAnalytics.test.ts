// Memory Analytics (Phase 4) tests. Pure aggregation over caller-supplied memory state — no
// provider, orchestrator, or retrieval call is invoked here.
import { describe, expect, it } from 'vitest';
import {
  computeEpisodicGrowth,
  computeSemanticGrowth,
  computeEpisodicDuplicateStats,
  computeSemanticDuplicateStats,
  computeWorkingMemoryUsage,
  computeRetrievalPerformance,
  buildMemoryAnalyticsReport,
  getMemoryEngineMetricsSnapshot,
} from '../memoryLayer/analytics.js';
import type { RetrievalOutcomeRecord } from '../memoryLayer/analytics.js';
import type { EpisodicRecord, SemanticFact, WorkingMemoryEntry } from '../memoryLayer/types.js';

const AGENT_ID = 'agent-1';

function makeEpisode(overrides: Partial<EpisodicRecord> = {}): EpisodicRecord {
  return {
    id: 'ep-1',
    agentId: AGENT_ID,
    timestamp: 1_000,
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
    key: 'preferred-asset',
    value: 'XLM',
    confidence: 0.7,
    updatedAt: 1_000,
    tags: ['xlm'],
    ...overrides,
  };
}

function makeWorkingEntry(overrides: Partial<WorkingMemoryEntry> = {}): WorkingMemoryEntry {
  return {
    agentId: AGENT_ID,
    key: 'scratch',
    value: 42,
    setAt: 1_000,
    expiresAt: null,
    ...overrides,
  };
}

describe('computeEpisodicGrowth', () => {
  it('returns all-zero/null stats for no records', () => {
    const growth = computeEpisodicGrowth([], 10_000, 24 * 60 * 60 * 1000);
    expect(growth).toEqual({
      totalCount: 0,
      windowCount: 0,
      ratePerHour: 0,
      firstTimestamp: null,
      lastTimestamp: null,
    });
  });

  it('counts only timestamps within the window and reports first/last across all records', () => {
    const now = 10 * 60 * 60 * 1000; // 10h
    const windowMs = 5 * 60 * 60 * 1000; // 5h
    const records = [
      makeEpisode({ id: 'a', timestamp: 0 }), // outside window
      makeEpisode({ id: 'b', timestamp: 8 * 60 * 60 * 1000 }), // inside window
      makeEpisode({ id: 'c', timestamp: 9 * 60 * 60 * 1000 }), // inside window
    ];
    const growth = computeEpisodicGrowth(records, now, windowMs);
    expect(growth.totalCount).toBe(3);
    expect(growth.windowCount).toBe(2);
    expect(growth.ratePerHour).toBeCloseTo(2 / 5);
    expect(growth.firstTimestamp).toBe(0);
    expect(growth.lastTimestamp).toBe(9 * 60 * 60 * 1000);
  });
});

describe('computeSemanticGrowth', () => {
  it('keys growth off updatedAt, not id', () => {
    const now = 10_000;
    const facts = [makeFact({ updatedAt: 5_000 }), makeFact({ updatedAt: 9_000 })];
    const growth = computeSemanticGrowth(facts, now, 10_000);
    expect(growth.totalCount).toBe(2);
    expect(growth.windowCount).toBe(2);
    expect(growth.firstTimestamp).toBe(5_000);
    expect(growth.lastTimestamp).toBe(9_000);
  });
});

describe('computeEpisodicDuplicateStats', () => {
  it('reports no duplicates for distinct content', () => {
    const records = [makeEpisode({ id: 'a', tags: ['x'] }), makeEpisode({ id: 'b', tags: ['y'] })];
    const stats = computeEpisodicDuplicateStats(records);
    expect(stats.totalCount).toBe(2);
    expect(stats.uniqueCount).toBe(2);
    expect(stats.duplicateCount).toBe(0);
    expect(stats.duplicateRatio).toBe(0);
    expect(stats.topDuplicateHashes).toEqual([]);
  });

  it('treats records with different id/timestamp but identical content as duplicates', () => {
    const records = [
      makeEpisode({ id: 'a', timestamp: 1_000 }),
      makeEpisode({ id: 'b', timestamp: 2_000 }),
      makeEpisode({ id: 'c', timestamp: 3_000 }),
    ];
    const stats = computeEpisodicDuplicateStats(records);
    expect(stats.totalCount).toBe(3);
    expect(stats.uniqueCount).toBe(1);
    expect(stats.duplicateCount).toBe(2);
    expect(stats.duplicateRatio).toBeCloseTo(2 / 3);
    expect(stats.topDuplicateHashes).toHaveLength(1);
    expect(stats.topDuplicateHashes[0].count).toBe(3);
  });

  it('returns all-zero stats for an empty list', () => {
    const stats = computeEpisodicDuplicateStats([]);
    expect(stats).toEqual({
      totalCount: 0,
      uniqueCount: 0,
      duplicateCount: 0,
      duplicateRatio: 0,
      topDuplicateHashes: [],
    });
  });
});

describe('computeSemanticDuplicateStats', () => {
  it('treats facts with different id/updatedAt but identical content as duplicates', () => {
    const facts = [
      makeFact({ id: 'a', updatedAt: 1_000 }),
      makeFact({ id: 'b', updatedAt: 2_000 }),
    ];
    const stats = computeSemanticDuplicateStats(facts);
    expect(stats.uniqueCount).toBe(1);
    expect(stats.duplicateCount).toBe(1);
  });

  it('does not treat facts with different values as duplicates', () => {
    const facts = [makeFact({ id: 'a', value: 'XLM' }), makeFact({ id: 'b', value: 'BTC' })];
    const stats = computeSemanticDuplicateStats(facts);
    expect(stats.uniqueCount).toBe(2);
    expect(stats.duplicateCount).toBe(0);
  });
});

describe('computeWorkingMemoryUsage', () => {
  it('reports null utilization when capacity is unknown', () => {
    const usage = computeWorkingMemoryUsage([makeWorkingEntry()]);
    expect(usage.count).toBe(1);
    expect(usage.capacity).toBeNull();
    expect(usage.utilization).toBeNull();
  });

  it('computes utilization against a known capacity', () => {
    const entries = [makeWorkingEntry({ key: 'a' }), makeWorkingEntry({ key: 'b' })];
    const usage = computeWorkingMemoryUsage(entries, 4);
    expect(usage.count).toBe(2);
    expect(usage.capacity).toBe(4);
    expect(usage.utilization).toBeCloseTo(0.5);
  });

  it('does not divide by zero when capacity is 0', () => {
    const usage = computeWorkingMemoryUsage([], 0);
    expect(usage.utilization).toBeNull();
  });
});

describe('computeRetrievalPerformance', () => {
  it('returns all-zero stats for no records', () => {
    const perf = computeRetrievalPerformance([]);
    expect(perf).toEqual({
      count: 0,
      hitCount: 0,
      hitRate: 0,
      avgSelected: 0,
      avgScanned: 0,
      avgDurationMs: 0,
      p50DurationMs: 0,
      p95DurationMs: 0,
    });
  });

  it('computes hit rate as the fraction of calls with at least one selected record', () => {
    const records: RetrievalOutcomeRecord[] = [
      { scanned: 10, selected: 3, durationMs: 5 },
      { scanned: 10, selected: 0, durationMs: 7 },
      { scanned: 10, selected: 1, durationMs: 9 },
    ];
    const perf = computeRetrievalPerformance(records);
    expect(perf.count).toBe(3);
    expect(perf.hitCount).toBe(2);
    expect(perf.hitRate).toBeCloseTo(2 / 3);
    expect(perf.avgSelected).toBeCloseTo(4 / 3);
    expect(perf.avgScanned).toBe(10);
    expect(perf.avgDurationMs).toBe(7);
  });

  it('computes duration percentiles', () => {
    const records: RetrievalOutcomeRecord[] = Array.from({ length: 100 }, (_, i) => ({
      scanned: 1,
      selected: 1,
      durationMs: i + 1,
    }));
    const perf = computeRetrievalPerformance(records);
    expect(perf.p50DurationMs).toBe(51);
    expect(perf.p95DurationMs).toBe(96);
  });
});

describe('buildMemoryAnalyticsReport', () => {
  it('combines every Phase 4 metric off one snapshot of memory state', () => {
    const now = 10_000;
    const report = buildMemoryAnalyticsReport({
      episodic: [makeEpisode({ id: 'a', timestamp: 9_000 })],
      semantic: [makeFact({ id: 'f', updatedAt: 9_000 })],
      working: [makeWorkingEntry()],
      workingCapacity: 10,
      retrievalRecords: [{ scanned: 5, selected: 2, durationMs: 3 }],
      now,
      growthWindowMs: 60_000,
    });
    expect(report.episodicGrowth.totalCount).toBe(1);
    expect(report.semanticGrowth.totalCount).toBe(1);
    expect(report.episodicDuplicates.totalCount).toBe(1);
    expect(report.semanticDuplicates.totalCount).toBe(1);
    expect(report.workingMemoryUsage).toEqual({ count: 1, capacity: 10, utilization: 0.1 });
    expect(report.retrievalPerformance.count).toBe(1);
  });

  it('defaults retrievalRecords to empty and now/growthWindowMs to sane values', () => {
    const report = buildMemoryAnalyticsReport({ episodic: [], semantic: [], working: [] });
    expect(report.retrievalPerformance.count).toBe(0);
    expect(report.episodicGrowth.totalCount).toBe(0);
    expect(report.workingMemoryUsage).toEqual({ count: 0, capacity: null, utilization: null });
  });
});

describe('getMemoryEngineMetricsSnapshot', () => {
  it('combines the package, retrieval, and intelligence metrics snapshots', () => {
    const snapshot = getMemoryEngineMetricsSnapshot();
    expect(snapshot).toHaveProperty('package.assembly');
    expect(snapshot).toHaveProperty('retrieval.retrieval');
    expect(snapshot).toHaveProperty('intelligence.intelligence');
  });
});
