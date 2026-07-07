// Pure, synchronous analytics over an already-validated `MemoryPackage`. Every value here is a
// direct aggregation of fields already present on the package — never an inference, prediction,
// or AI-derived judgment. Same episodic/semantic content always aggregates byte-identically,
// regardless of array order, since every list is sorted by a stable key before being returned.
import type { EpisodicRecord, SemanticFact } from '../../memoryLayer/types.js';
import type {
  AssetUsageStat,
  AverageMetric,
  ConfidenceBucket,
  ExecutionDistributionEntry,
  ProtocolStat,
  ProviderReliability,
} from './types.js';

/** Episode tags are always `[protocol, action, executionStatus, dataSource, ...assets]` — a
 *  fixed convention written by the Memory Writer (Phase 9), never guessed at here. See
 *  `memoryWriter/deriver.ts::buildEpisodicRecord`. */
function tagProtocol(record: EpisodicRecord): string | null {
  return record.tags[0] ?? null;
}

function tagAssets(record: EpisodicRecord): string[] {
  return record.tags.slice(4);
}

export function computeProtocolStats(episodic: EpisodicRecord[]): ProtocolStat[] {
  const byProtocol = new Map<string, { usage: number; success: number; failure: number }>();
  for (const record of episodic) {
    const protocol = tagProtocol(record);
    if (protocol === null) continue;
    const entry = byProtocol.get(protocol) ?? { usage: 0, success: 0, failure: 0 };
    entry.usage += 1;
    if (record.outcome === 'win') entry.success += 1;
    if (record.outcome === 'loss') entry.failure += 1;
    byProtocol.set(protocol, entry);
  }
  return [...byProtocol.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([protocol, { usage, success, failure }]) => ({
      protocol,
      usageCount: usage,
      successCount: success,
      failureCount: failure,
      successRate: usage === 0 ? 0 : success / usage,
      failureRate: usage === 0 ? 0 : failure / usage,
    }));
}

export function computeAssetUsage(episodic: EpisodicRecord[]): AssetUsageStat[] {
  const counts = new Map<string, number>();
  for (const record of episodic) {
    for (const asset of tagAssets(record)) {
      counts.set(asset, (counts.get(asset) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([asset, count]) => ({ asset, count }));
}

/** Averages every semantic fact whose key starts with `prefix`, parsing its `value` as a
 *  decimal number. Facts whose value does not parse to a finite number are skipped (not
 *  fabricated as 0) — this stays generic across whatever prefixed numeric facts a Memory Writer
 *  chooses to emit, without hardcoding today's exact key set beyond the prefix convention. */
export function computeAverageFromSemanticPrefix(semantic: SemanticFact[], prefix: string): AverageMetric | null {
  const values: number[] = [];
  for (const fact of semantic) {
    if (!fact.key.startsWith(prefix)) continue;
    const n = Number(fact.value);
    if (Number.isFinite(n)) values.push(n);
  }
  if (values.length === 0) return null;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return { value: sum / values.length, sampleCount: values.length };
}

/** Confidence calibration: buckets episodes into fixed-width [0, 0.1), [0.1, 0.2), ... [0.9, 1.0]
 *  confidence ranges and reports the observed win rate within each bucket — a direct tally, not
 *  a fitted/predicted curve. Only buckets containing at least one episode are returned. */
export function computeConfidenceCalibration(episodic: EpisodicRecord[]): ConfidenceBucket[] {
  const BUCKET_WIDTH = 0.1;
  const buckets = new Map<number, { count: number; confidenceSum: number; wins: number }>();
  for (const record of episodic) {
    const index = Math.min(9, Math.floor(record.confidence / BUCKET_WIDTH));
    const entry = buckets.get(index) ?? { count: 0, confidenceSum: 0, wins: 0 };
    entry.count += 1;
    entry.confidenceSum += record.confidence;
    if (record.outcome === 'win') entry.wins += 1;
    buckets.set(index, entry);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, { count, confidenceSum, wins }]) => ({
      bucketMin: index * BUCKET_WIDTH,
      bucketMax: index === 9 ? 1 : (index + 1) * BUCKET_WIDTH,
      count,
      avgConfidence: confidenceSum / count,
      winRate: wins / count,
    }));
}

/** Fraction of episodes carrying a non-null `decisionRef` — a decision-layer-authorized episode
 *  is treated as "passed verification"; a null `decisionRef` means no decision ever backed it. */
export function computeVerificationPassRate(episodic: EpisodicRecord[]): number {
  if (episodic.length === 0) return 0;
  const passed = episodic.filter((r) => r.decisionRef !== null).length;
  return passed / episodic.length;
}

export function computeProviderReliability(protocolStats: ProtocolStat[]): ProviderReliability[] {
  return protocolStats
    .map((s) => ({ protocol: s.protocol, reliabilityScore: s.successRate, sampleCount: s.usageCount }))
    .sort((a, b) => a.protocol.localeCompare(b.protocol));
}

export function computeExecutionDistribution(protocolStats: ProtocolStat[]): ExecutionDistributionEntry[] {
  const total = protocolStats.reduce((acc, s) => acc + s.usageCount, 0);
  if (total === 0) return [];
  return protocolStats
    .map((s) => ({ protocol: s.protocol, fraction: s.usageCount / total }))
    .sort((a, b) => a.protocol.localeCompare(b.protocol));
}
