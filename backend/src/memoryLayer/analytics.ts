// Memory Analytics (Phase 4). Pure aggregation over externally-supplied memory state — this
// module never reads a provider, never calls the orchestrator, and never fabricates a metric it
// doesn't have data for. Same philosophy as `strategyEngine/analytics.ts`: a caller (a route
// handler, a scheduled job, a test) is responsible for pulling `list()` off the providers (or
// passing raw retrieval-call records) and handing the results here to be aggregated. Duration/
// count *counters* already tracked in-process by `metrics.ts`, `retrieval/metrics.ts`, and
// `intelligence/metrics.ts` are reused via `getMemoryEngineMetricsSnapshot`, not reimplemented.
import { sha256 } from '../reasoning/hashing.js';
import { getMemoryMetricsSnapshot } from './metrics.js';
import { getRetrievalMetricsSnapshot } from './retrieval/metrics.js';
import { getIntelligenceMetricsSnapshot } from './intelligence/metrics.js';
import type { EpisodicRecord, SemanticFact, WorkingMemoryEntry } from './types.js';

const DEFAULT_GROWTH_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface GrowthStats {
  totalCount: number;
  /** Count of items whose timestamp falls within `(now - windowMs, now]`. */
  windowCount: number;
  ratePerHour: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
}

function computeGrowthStats(timestamps: number[], now: number, windowMs: number): GrowthStats {
  const totalCount = timestamps.length;
  const windowCount = timestamps.filter((t) => t > now - windowMs && t <= now).length;
  const windowHours = windowMs / (60 * 60 * 1000);
  return {
    totalCount,
    windowCount,
    ratePerHour: windowHours > 0 ? windowCount / windowHours : 0,
    firstTimestamp: totalCount === 0 ? null : Math.min(...timestamps),
    lastTimestamp: totalCount === 0 ? null : Math.max(...timestamps),
  };
}

/** Growth of the episodic store, keyed by `EpisodicRecord.timestamp` (append time). */
export function computeEpisodicGrowth(
  records: EpisodicRecord[],
  now: number = Date.now(),
  windowMs: number = DEFAULT_GROWTH_WINDOW_MS
): GrowthStats {
  return computeGrowthStats(records.map((r) => r.timestamp), now, windowMs);
}

/** Growth of the semantic store, keyed by `SemanticFact.updatedAt` — a fact that gets upserted
 *  again counts as fresh growth at its new `updatedAt`, matching how the provider itself treats
 *  an upsert as replacing rather than appending. */
export function computeSemanticGrowth(
  facts: SemanticFact[],
  now: number = Date.now(),
  windowMs: number = DEFAULT_GROWTH_WINDOW_MS
): GrowthStats {
  return computeGrowthStats(facts.map((f) => f.updatedAt), now, windowMs);
}

export interface DuplicateStats {
  totalCount: number;
  uniqueCount: number;
  duplicateCount: number;
  duplicateRatio: number;
  /** Content hashes that occurred more than once, most-repeated first, capped at 10. */
  topDuplicateHashes: { hash: string; count: number }[];
}

function computeDuplicateStatsFromHashes(hashes: string[]): DuplicateStats {
  const counts = new Map<string, number>();
  for (const hash of hashes) counts.set(hash, (counts.get(hash) ?? 0) + 1);
  const totalCount = hashes.length;
  const uniqueCount = counts.size;
  return {
    totalCount,
    uniqueCount,
    duplicateCount: totalCount - uniqueCount,
    duplicateRatio: totalCount === 0 ? 0 : (totalCount - uniqueCount) / totalCount,
    topDuplicateHashes: [...counts.entries()]
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([hash, count]) => ({ hash, count })),
  };
}

/** Duplicate detection over episodic content — hashes every field except `id`/`timestamp`, so
 *  two episodes appended at different times (and therefore different ids/wall-clock times) but
 *  otherwise identical content still count as duplicates. Same SHA-256-over-canonical-JSON
 *  technique as `reasoning/memoryWriter/hashing.ts`. */
export function computeEpisodicDuplicateStats(records: EpisodicRecord[]): DuplicateStats {
  const hashes = records.map((r) => {
    const { id: _id, timestamp: _timestamp, ...rest } = r;
    return sha256(rest);
  });
  return computeDuplicateStatsFromHashes(hashes);
}

/** Duplicate detection over semantic content — hashes every field except `id`/`updatedAt`. A
 *  single provider already de-duplicates by `(agentId, key)` via upsert, so this mainly surfaces
 *  the same `(agentId, key, value)` re-derived and re-written under a fresh id, or the same fact
 *  independently written for two agents. */
export function computeSemanticDuplicateStats(facts: SemanticFact[]): DuplicateStats {
  const hashes = facts.map((f) => {
    const { id: _id, updatedAt: _updatedAt, ...rest } = f;
    return sha256(rest);
  });
  return computeDuplicateStatsFromHashes(hashes);
}

export interface WorkingMemoryUsage {
  count: number;
  capacity: number | null;
  /** `null` when `capacity` is unknown/unset (matches provider default of unbounded capacity). */
  utilization: number | null;
}

/** Occupancy of the working memory store. `entries` should already be the live (non-expired)
 *  set — e.g. `WorkingMemoryProvider.list(agentId)`, which filters out expired entries itself. */
export function computeWorkingMemoryUsage(entries: WorkingMemoryEntry[], capacity?: number): WorkingMemoryUsage {
  const count = entries.length;
  return {
    count,
    capacity: capacity ?? null,
    utilization: capacity !== undefined && capacity > 0 ? count / capacity : null,
  };
}

/** One retrieval call's outcome, as a caller would derive it from `retrieveMemoryPackage`'s
 *  `RetrievalMetadata` (`retrievalDurationMs`, scanned/selected totals across all three stores). */
export interface RetrievalOutcomeRecord {
  scanned: number;
  selected: number;
  durationMs: number;
}

export interface RetrievalPerformance {
  count: number;
  /** Calls that returned at least one selected record. */
  hitCount: number;
  hitRate: number;
  avgSelected: number;
  avgScanned: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function percentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  const index = Math.min(sortedAscending.length - 1, Math.floor(p * sortedAscending.length));
  return sortedAscending[index];
}

/** Memory hit rate + latency distribution over a set of retrieval calls. Complements the
 *  in-process running averages in `retrieval/metrics.ts` (which only tracks mean/max/min) with
 *  per-call hit rate and percentiles, computed over whatever calls the caller hands in. */
export function computeRetrievalPerformance(records: RetrievalOutcomeRecord[]): RetrievalPerformance {
  const count = records.length;
  const hitCount = records.filter((r) => r.selected > 0).length;
  const sortedDurations = [...records.map((r) => r.durationMs)].sort((a, b) => a - b);
  return {
    count,
    hitCount,
    hitRate: count === 0 ? 0 : hitCount / count,
    avgSelected: mean(records.map((r) => r.selected)),
    avgScanned: mean(records.map((r) => r.scanned)),
    avgDurationMs: mean(sortedDurations),
    p50DurationMs: percentile(sortedDurations, 0.5),
    p95DurationMs: percentile(sortedDurations, 0.95),
  };
}

export interface MemoryAnalyticsInput {
  episodic: EpisodicRecord[];
  semantic: SemanticFact[];
  working: WorkingMemoryEntry[];
  workingCapacity?: number;
  retrievalRecords?: RetrievalOutcomeRecord[];
  now?: number;
  growthWindowMs?: number;
}

export interface MemoryAnalyticsReport {
  episodicGrowth: GrowthStats;
  semanticGrowth: GrowthStats;
  episodicDuplicates: DuplicateStats;
  semanticDuplicates: DuplicateStats;
  workingMemoryUsage: WorkingMemoryUsage;
  retrievalPerformance: RetrievalPerformance;
}

/** Convenience one-shot: computes every Phase 4 metric off a single snapshot of memory state.
 *  Equivalent to calling each `compute*` function individually. */
export function buildMemoryAnalyticsReport(input: MemoryAnalyticsInput): MemoryAnalyticsReport {
  const now = input.now ?? Date.now();
  const windowMs = input.growthWindowMs ?? DEFAULT_GROWTH_WINDOW_MS;
  return {
    episodicGrowth: computeEpisodicGrowth(input.episodic, now, windowMs),
    semanticGrowth: computeSemanticGrowth(input.semantic, now, windowMs),
    episodicDuplicates: computeEpisodicDuplicateStats(input.episodic),
    semanticDuplicates: computeSemanticDuplicateStats(input.semantic),
    workingMemoryUsage: computeWorkingMemoryUsage(input.working, input.workingCapacity),
    retrievalPerformance: computeRetrievalPerformance(input.retrievalRecords ?? []),
  };
}

/** Combines the three existing in-process metrics snapshots (`memoryLayer/metrics.ts`,
 *  `retrieval/metrics.ts`, `intelligence/metrics.ts`) into one object — reuses those modules'
 *  counters rather than re-tracking assembly/retrieval/intelligence duration here. */
export function getMemoryEngineMetricsSnapshot() {
  return {
    package: getMemoryMetricsSnapshot(),
    retrieval: getRetrievalMetricsSnapshot(),
    intelligence: getIntelligenceMetricsSnapshot(),
  };
}
