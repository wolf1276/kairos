// Reasoning Engine Phase 10 (Learning Engine) — exhaustive test suite. Builds MemoryPackage
// fixtures by hand (Memory Engine's own pipeline is exercised elsewhere) and drives
// computeLearningSnapshot() against them.
import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
  computeLearningSnapshot,
  LearningSnapshotValidationError,
  hashLearningSnapshot,
  checkMemoryPackage,
  computeConfidenceCalibration,
} from '../reasoning/learningEngine/index.js';
import type { EpisodicRecord, MemoryPackage, SemanticFact, WorkingMemoryEntry } from '../memoryLayer/types.js';

function hex64(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

const AGENT_ID = 'agent-1';

function makeEpisodic(overrides: Partial<EpisodicRecord> = {}): EpisodicRecord {
  const base: EpisodicRecord = {
    id: hex64(`episode-${Math.random()}`),
    agentId: AGENT_ID,
    timestamp: 1_700_000_000_000,
    contextRef: hex64('context-1'),
    decisionRef: hex64('decision-1'),
    executionRef: hex64('execution-1'),
    outcome: 'win',
    pnl: null,
    holdingTimeSeconds: null,
    confidence: 0.9,
    quality: 'high',
    tags: ['soroswap', 'SWAP', 'success', 'synthetic', 'XLM', 'USDC'],
  };
  return { ...base, ...overrides };
}

function makeSemantic(overrides: Partial<SemanticFact> = {}): SemanticFact {
  const base: SemanticFact = {
    id: hex64(`fact-${Math.random()}`),
    agentId: AGENT_ID,
    key: 'last_fees:soroswap:SWAP',
    value: '0.01',
    confidence: 1,
    updatedAt: 1_700_000_000_000,
    tags: ['soroswap', 'SWAP'],
  };
  return { ...base, ...overrides };
}

function makeWorking(overrides: Partial<WorkingMemoryEntry> = {}): WorkingMemoryEntry {
  const base: WorkingMemoryEntry = {
    agentId: AGENT_ID,
    key: 'last_outcome:soroswap:SWAP',
    value: { outcomeId: 'outcome-1' },
    setAt: 1_700_000_000_000,
    expiresAt: 1_700_086_400_000,
  };
  return { ...base, ...overrides };
}

function makePackage(overrides: {
  episodic?: EpisodicRecord[];
  semantic?: SemanticFact[];
  working?: WorkingMemoryEntry[];
  metaOverrides?: Partial<MemoryPackage['meta']>;
  status?: MemoryPackage['status'];
  validationOk?: boolean;
} = {}): MemoryPackage {
  return {
    meta: {
      version: '1.0.0',
      agentId: AGENT_ID,
      timestamp: 1_700_000_000_000,
      packageId: 'package-1',
      packageHash: hex64('package-1'),
      ...overrides.metaOverrides,
    },
    episodic: overrides.episodic ?? [makeEpisodic({ id: hex64('episode-1') })],
    semantic: overrides.semantic ?? [makeSemantic({ id: hex64('fact-1') })],
    working: overrides.working ?? [makeWorking()],
    validation: { ok: overrides.validationOk ?? true, errors: [] },
    status: overrides.status ?? 'valid',
  };
}

describe('Learning Engine — success', () => {
  it('computes a full snapshot for a well-formed MemoryPackage', () => {
    const pkg = makePackage({
      episodic: [
        makeEpisodic({ id: hex64('e1'), outcome: 'win', confidence: 0.9, tags: ['soroswap', 'SWAP', 'success', 'synthetic', 'XLM', 'USDC'] }),
        makeEpisodic({ id: hex64('e2'), outcome: 'loss', confidence: 0.4, decisionRef: null, tags: ['soroswap', 'SWAP', 'failed', 'synthetic', 'XLM'] }),
        makeEpisodic({ id: hex64('e3'), outcome: 'win', confidence: 0.9, tags: ['blend', 'DEPOSIT', 'success', 'real', 'USDC'] }),
      ],
      semantic: [
        makeSemantic({ id: hex64('s1'), key: 'last_fees:soroswap:SWAP', value: '0.01' }),
        makeSemantic({ id: hex64('s2'), key: 'last_fees:blend:DEPOSIT', value: '0.03' }),
      ],
    });

    const snapshot = computeLearningSnapshot(pkg, { snapshotId: 'snapshot-1' });

    expect(snapshot.snapshotId).toBe('snapshot-1');
    expect(snapshot.sourcePackageHash).toBe(pkg.meta.packageHash);
    expect(snapshot.agentId).toBe(AGENT_ID);
    expect(snapshot.episodeCount).toBe(3);
    expect(snapshot.semanticFactCount).toBe(2);

    expect(snapshot.protocolStats).toEqual([
      { protocol: 'blend', usageCount: 1, successCount: 1, failureCount: 0, successRate: 1, failureRate: 0 },
      { protocol: 'soroswap', usageCount: 2, successCount: 1, failureCount: 1, successRate: 0.5, failureRate: 0.5 },
    ]);

    expect(snapshot.assetUsage).toEqual([
      { asset: 'USDC', count: 2 },
      { asset: 'XLM', count: 2 },
    ]);

    expect(snapshot.avgFees).toEqual({ value: 0.02, sampleCount: 2 });
    expect(snapshot.avgSlippage).toBeNull();
    expect(snapshot.avgExecutionLatencyMs).toBeNull();
    expect(snapshot.avgResourceUsage).toBeNull();
    expect(snapshot.retryStatistics).toBeNull();

    expect(snapshot.verificationPassRate).toBeCloseTo(2 / 3);

    expect(snapshot.providerReliability).toEqual([
      { protocol: 'blend', reliabilityScore: 1, sampleCount: 1 },
      { protocol: 'soroswap', reliabilityScore: 0.5, sampleCount: 2 },
    ]);

    expect(snapshot.executionDistribution).toEqual([
      { protocol: 'blend', fraction: 1 / 3 },
      { protocol: 'soroswap', fraction: 2 / 3 },
    ]);

    expect(snapshot.metadata.learningEngineVersion).toBe('1.0.0');
    expect(typeof snapshot.snapshotHash).toBe('string');
    expect(snapshot.snapshotHash).toHaveLength(64);
  });

  it('computes confidence calibration buckets directly', () => {
    const episodic = [
      makeEpisodic({ id: hex64('a'), confidence: 0.95, outcome: 'win' }),
      makeEpisodic({ id: hex64('b'), confidence: 0.91, outcome: 'loss' }),
      makeEpisodic({ id: hex64('c'), confidence: 0.15, outcome: 'win' }),
    ];
    const buckets = computeConfidenceCalibration(episodic);
    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toEqual({ bucketMin: 0.1, bucketMax: 0.2, count: 1, avgConfidence: 0.15, winRate: 1 });
    expect(buckets[1].bucketMin).toBe(0.9);
    expect(buckets[1].bucketMax).toBe(1);
    expect(buckets[1].count).toBe(2);
    expect(buckets[1].avgConfidence).toBeCloseTo(0.93);
    expect(buckets[1].winRate).toBe(0.5);
  });

  it('returns empty analytics arrays for an empty package (never throws on zero episodes)', () => {
    const pkg = makePackage({ episodic: [], semantic: [], working: [] });
    const snapshot = computeLearningSnapshot(pkg);
    expect(snapshot.protocolStats).toEqual([]);
    expect(snapshot.assetUsage).toEqual([]);
    expect(snapshot.confidenceCalibration).toEqual([]);
    expect(snapshot.executionDistribution).toEqual([]);
    expect(snapshot.verificationPassRate).toBe(0);
    expect(snapshot.avgFees).toBeNull();
  });
});

describe('Learning Engine — immutability, determinism, replayability', () => {
  it('deep-freezes the returned snapshot', () => {
    const snapshot = computeLearningSnapshot(makePackage());
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.protocolStats)).toBe(true);
    expect(Object.isFrozen(snapshot.metadata)).toBe(true);
    expect(() => {
      (snapshot as { agentId: string }).agentId = 'tampered';
    }).toThrow();
  });

  it('never mutates the input MemoryPackage', () => {
    const pkg = makePackage();
    const snapshot = JSON.parse(JSON.stringify(pkg));
    computeLearningSnapshot(pkg);
    expect(JSON.parse(JSON.stringify(pkg))).toEqual(snapshot);
  });

  it('produces an identical snapshotHash for identical inputs (deterministic + replayable)', () => {
    const pkg = makePackage();
    const a = computeLearningSnapshot(pkg, { snapshotId: 'snapshot-a' });
    const b = computeLearningSnapshot(pkg, { snapshotId: 'snapshot-b' });
    expect(a.snapshotHash).toBe(b.snapshotHash);
    expect(a.snapshotId).not.toBe(b.snapshotId);
  });

  it('produces the same snapshotHash regardless of episodic/semantic array order', () => {
    const e1 = makeEpisodic({ id: hex64('e1'), tags: ['soroswap', 'SWAP', 'success', 'synthetic', 'XLM'] });
    const e2 = makeEpisodic({ id: hex64('e2'), tags: ['blend', 'DEPOSIT', 'success', 'real', 'USDC'] });
    const pkgA = makePackage({ episodic: [e1, e2] });
    const pkgB = makePackage({ episodic: [e2, e1] });
    const a = computeLearningSnapshot(pkgA, { snapshotId: 'x' });
    const b = computeLearningSnapshot(pkgB, { snapshotId: 'y' });
    expect(a.snapshotHash).toBe(b.snapshotHash);
  });

  it('produces a different snapshotHash when any recorded field changes', () => {
    const base = computeLearningSnapshot(makePackage());
    const changed = computeLearningSnapshot(makePackage({ episodic: [makeEpisodic({ id: hex64('changed'), outcome: 'loss' })] }));
    expect(base.snapshotHash).not.toBe(changed.snapshotHash);
  });

  it('hashLearningSnapshot matches the hash embedded in the snapshot when recomputed on the same base', () => {
    const snapshot = computeLearningSnapshot(makePackage());
    const { snapshotHash, snapshotId, ...base } = snapshot;
    expect(hashLearningSnapshot(base)).toBe(snapshotHash);
  });
});

describe('Learning Engine — rejects malformed input (fail closed)', () => {
  it('rejects a non-object MemoryPackage', () => {
    expect(() => computeLearningSnapshot(null as unknown as MemoryPackage)).toThrow(LearningSnapshotValidationError);
  });

  it('rejects a package missing meta.packageHash', () => {
    const pkg = makePackage({ metaOverrides: { packageHash: '' } });
    expect(() => computeLearningSnapshot(pkg)).toThrow(/missing_package_hash/);
  });

  it('rejects a package with status "invalid"', () => {
    const pkg = makePackage({ status: 'invalid' });
    expect(() => computeLearningSnapshot(pkg)).toThrow(/invalid_source_package/);
  });

  it('rejects a package with validation.ok false', () => {
    const pkg = makePackage({ validationOk: false });
    expect(() => computeLearningSnapshot(pkg)).toThrow(/invalid_source_package/);
  });

  it('rejects an episodic record missing its id', () => {
    const pkg = makePackage({ episodic: [makeEpisodic({ id: '' })] });
    expect(() => computeLearningSnapshot(pkg)).toThrow(/missing_episodic_hash/);
  });

  it('rejects a semantic fact missing its id', () => {
    const pkg = makePackage({ semantic: [makeSemantic({ id: '' })] });
    expect(() => computeLearningSnapshot(pkg)).toThrow(/missing_semantic_hash/);
  });

  it('rejects duplicate episodic memory ids', () => {
    const dupId = hex64('dup');
    const pkg = makePackage({ episodic: [makeEpisodic({ id: dupId }), makeEpisodic({ id: dupId })] });
    expect(() => computeLearningSnapshot(pkg)).toThrow(/duplicate_episodic_memory/);
  });

  it('rejects duplicate semantic memory ids', () => {
    const dupId = hex64('dup-fact');
    const pkg = makePackage({ semantic: [makeSemantic({ id: dupId }), makeSemantic({ id: dupId, key: 'other:key' })] });
    expect(() => computeLearningSnapshot(pkg)).toThrow(/duplicate_semantic_memory/);
  });

  it('rejects an episodic record whose agentId does not match the package agentId (inconsistent metadata)', () => {
    const pkg = makePackage({ episodic: [makeEpisodic({ agentId: 'someone-else' })] });
    expect(() => computeLearningSnapshot(pkg)).toThrow(/inconsistent_metadata/);
  });

  it('rejects a semantic fact whose agentId does not match the package agentId', () => {
    const pkg = makePackage({ semantic: [makeSemantic({ agentId: 'someone-else' })] });
    expect(() => computeLearningSnapshot(pkg)).toThrow(/inconsistent_metadata/);
  });

  it('rejects a working entry with expiresAt before setAt (inconsistent metadata)', () => {
    const pkg = makePackage({ working: [makeWorking({ setAt: 1000, expiresAt: 500 })] });
    expect(() => computeLearningSnapshot(pkg)).toThrow(/inconsistent_metadata/);
  });

  it('rejects NaN confidence', () => {
    const pkg = makePackage({ episodic: [makeEpisodic({ confidence: Number.NaN })] });
    expect(() => computeLearningSnapshot(pkg)).toThrow(/invalid_confidence/);
  });

  it('rejects Infinity confidence', () => {
    const pkg = makePackage({ episodic: [makeEpisodic({ confidence: Number.POSITIVE_INFINITY })] });
    expect(() => computeLearningSnapshot(pkg)).toThrow(/invalid_confidence/);
  });

  it('rejects confidence outside [0, 1]', () => {
    const pkg = makePackage({ episodic: [makeEpisodic({ confidence: 1.5 })] });
    expect(() => computeLearningSnapshot(pkg)).toThrow(/invalid_confidence/);
  });

  it('rejects NaN pnl', () => {
    const pkg = makePackage({ episodic: [makeEpisodic({ pnl: Number.NaN })] });
    expect(() => computeLearningSnapshot(pkg)).toThrow(/invalid_numeric_field/);
  });

  it('rejects Infinity holdingTimeSeconds', () => {
    const pkg = makePackage({ episodic: [makeEpisodic({ holdingTimeSeconds: Number.POSITIVE_INFINITY })] });
    expect(() => computeLearningSnapshot(pkg)).toThrow(/invalid_numeric_field/);
  });

  it('rejects an invalid outcome', () => {
    const pkg = makePackage({ episodic: [makeEpisodic({ outcome: 'bogus' as unknown as EpisodicRecord['outcome'] })] });
    expect(() => computeLearningSnapshot(pkg)).toThrow(/invalid_outcome/);
  });

  it('rejects non-string tags', () => {
    const pkg = makePackage({ episodic: [makeEpisodic({ tags: [1 as unknown as string] })] });
    expect(() => computeLearningSnapshot(pkg)).toThrow(/invalid_tags/);
  });

  it('checkMemoryPackage returns null for a well-formed package', () => {
    expect(checkMemoryPackage(makePackage())).toBeNull();
  });
});

describe('Learning Engine — stress: parallel computation', () => {
  for (const n of [10, 50, 100, 250]) {
    it(`produces ${n} deterministic, identically-hashed LearningSnapshots in parallel with no race conditions`, async () => {
      const pkg = makePackage({
        episodic: [
          makeEpisodic({ id: hex64('stress-e1'), outcome: 'win' }),
          makeEpisodic({ id: hex64('stress-e2'), outcome: 'loss', tags: ['blend', 'DEPOSIT', 'failed', 'real', 'USDC'] }),
        ],
      });
      const snapshots = await Promise.all(
        Array.from({ length: n }, (_, i) => Promise.resolve().then(() => computeLearningSnapshot(pkg, { snapshotId: `snapshot-${i}` })))
      );
      const hashes = new Set(snapshots.map((s) => s.snapshotHash));
      expect(hashes.size).toBe(1);
      const ids = new Set(snapshots.map((s) => s.snapshotId));
      expect(ids.size).toBe(n);
      for (const snapshot of snapshots) {
        expect(Object.isFrozen(snapshot)).toBe(true);
      }
    });
  }
});
