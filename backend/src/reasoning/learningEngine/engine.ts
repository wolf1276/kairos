// Learning Engine (Phase 10) orchestrator: MemoryPackage (Memory Engine, frozen) -> LearningSnapshot.
// Purely synchronous and side-effect-free — no AI/LLM, no inference, no prediction, no network
// call, no shared mutable state, so concurrent calls (however many, however parallel) can never
// race: each call only ever reads its own arguments and returns a freshly built, deep-frozen
// object. Never mutates the MemoryPackage passed in. Fail-closed: any malformed, inconsistent, or
// already-invalid input throws `LearningSnapshotValidationError` before a LearningSnapshot is built.
import { randomUUID } from 'crypto';
import {
  computeAssetUsage,
  computeAverageFromSemanticPrefix,
  computeConfidenceCalibration,
  computeExecutionDistribution,
  computeProtocolStats,
  computeProviderReliability,
  computeVerificationPassRate,
} from './analytics.js';
import { hashLearningSnapshot } from './hashing.js';
import { checkMemoryPackage } from './rules.js';
import { LEARNING_ENGINE_VERSION } from './types.js';
import type { MemoryPackage } from '../../memoryLayer/types.js';
import type { ComputeLearningSnapshotOptions, LearningSnapshot } from './types.js';

export class LearningSnapshotValidationError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(`Learning snapshot validation failed [${reason}]: ${message}`);
    this.name = 'LearningSnapshotValidationError';
    this.reason = reason;
  }
}

/** Recursively freezes a record so no downstream consumer can mutate it after it's built — same
 *  technique as `outcomeRecorder/recorder.ts::deepFreeze`, duplicated locally rather than
 *  importing from another phase. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** Well-known semantic-fact key prefixes a Learning Engine can average over. Only `last_fees:`
 *  is ever actually emitted by today's frozen Memory Writer (Phase 9); the others are read
 *  generically in case a future (unfrozen) writer emits them — matching them costs nothing when
 *  absent, since `computeAverageFromSemanticPrefix` returns `null` for zero matches. */
const FEES_PREFIX = 'last_fees:';
const SLIPPAGE_PREFIX = 'last_slippage:';
const LATENCY_PREFIX = 'last_latency_ms:';
const RESOURCE_PREFIX = 'last_resource_units:';
const RETRY_PREFIX = 'last_retry_count:';

/**
 * Computes deterministic analytics over one already-validated `MemoryPackage`. Always either
 * returns a fully-formed, immutable `LearningSnapshot` or throws `LearningSnapshotValidationError`
 * — never a partial/best-effort snapshot. Never mutates `memoryPackage`.
 */
export function computeLearningSnapshot(memoryPackage: MemoryPackage, options: ComputeLearningSnapshotOptions = {}): LearningSnapshot {
  const failure = checkMemoryPackage(memoryPackage);
  if (failure) throw new LearningSnapshotValidationError(failure.reason, failure.message);

  const snapshotId = options.snapshotId ?? randomUUID();
  const protocolStats = computeProtocolStats(memoryPackage.episodic);

  const snapshotBase: Omit<LearningSnapshot, 'snapshotHash' | 'snapshotId'> = {
    sourcePackageHash: memoryPackage.meta.packageHash,
    agentId: memoryPackage.meta.agentId,
    episodeCount: memoryPackage.episodic.length,
    semanticFactCount: memoryPackage.semantic.length,
    protocolStats,
    assetUsage: computeAssetUsage(memoryPackage.episodic),
    avgFees: computeAverageFromSemanticPrefix(memoryPackage.semantic, FEES_PREFIX),
    avgSlippage: computeAverageFromSemanticPrefix(memoryPackage.semantic, SLIPPAGE_PREFIX),
    avgExecutionLatencyMs: computeAverageFromSemanticPrefix(memoryPackage.semantic, LATENCY_PREFIX),
    avgResourceUsage: computeAverageFromSemanticPrefix(memoryPackage.semantic, RESOURCE_PREFIX),
    confidenceCalibration: computeConfidenceCalibration(memoryPackage.episodic),
    verificationPassRate: computeVerificationPassRate(memoryPackage.episodic),
    retryStatistics: computeAverageFromSemanticPrefix(memoryPackage.semantic, RETRY_PREFIX),
    providerReliability: computeProviderReliability(protocolStats),
    executionDistribution: computeExecutionDistribution(protocolStats),
    metadata: { learningEngineVersion: LEARNING_ENGINE_VERSION },
  };

  const snapshotHash = hashLearningSnapshot(snapshotBase);
  const snapshot: LearningSnapshot = { ...snapshotBase, snapshotId, snapshotHash };
  return deepFreeze(snapshot);
}
