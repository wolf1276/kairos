// Learning Engine rules: pure, synchronous predicate/shape-check functions over a `MemoryPackage`.
// Kept separate from `engine.ts` so every rule is independently unit-testable, matching the
// pattern used by `outcomeRecorder/rules.ts` and `memoryWriter/rules.ts`. Fail-closed throughout:
// a malformed, inconsistent, or unverifiable package is always rejected, never partially analyzed.
import type { EpisodicRecord, MemoryPackage, SemanticFact, WorkingMemoryEntry } from '../../memoryLayer/types.js';
import type { LearningRejectionReason } from './types.js';

export interface RuleFailure {
  reason: LearningRejectionReason;
  message: string;
}

function fail(reason: LearningRejectionReason, message: string): RuleFailure {
  return { reason, message };
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const EPISODE_OUTCOMES = ['win', 'loss', 'neutral', 'pending'] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function checkMeta(pkg: MemoryPackage): RuleFailure | null {
  const meta = pkg.meta;
  if (!meta || typeof meta !== 'object') return fail('malformed_memory_package', 'MemoryPackage.meta must be a non-null object');
  if (!isNonEmptyString(meta.agentId)) return fail('malformed_memory_package', 'MemoryPackage.meta.agentId must be a non-empty string');
  if (!isFiniteNumber(meta.timestamp) || meta.timestamp < 0) return fail('malformed_memory_package', 'MemoryPackage.meta.timestamp must be a non-negative finite number');
  if (!isNonEmptyString(meta.packageId)) return fail('malformed_memory_package', 'MemoryPackage.meta.packageId must be a non-empty string');
  if (typeof meta.packageHash !== 'string' || !SHA256_HEX.test(meta.packageHash)) return fail('missing_package_hash', 'MemoryPackage.meta.packageHash must be a 64-character lowercase hex string');
  return null;
}

function checkEpisodicRecord(record: unknown, agentId: string): RuleFailure | null {
  if (!record || typeof record !== 'object') return fail('malformed_memory_package', 'episodic entries must be non-null objects');
  const r = record as Partial<EpisodicRecord>;
  if (!isNonEmptyString(r.id)) return fail('missing_episodic_hash', 'EpisodicRecord.id must be a non-empty string');
  if (r.agentId !== agentId) return fail('inconsistent_metadata', `EpisodicRecord.agentId '${String(r.agentId)}' does not match MemoryPackage.meta.agentId '${agentId}'`);
  if (!isFiniteNumber(r.timestamp) || r.timestamp < 0) return fail('invalid_numeric_field', 'EpisodicRecord.timestamp must be a non-negative finite number');
  if (!isNonEmptyString(r.contextRef)) return fail('malformed_memory_package', 'EpisodicRecord.contextRef must be a non-empty string');
  if (typeof r.outcome !== 'string' || !(EPISODE_OUTCOMES as readonly string[]).includes(r.outcome)) return fail('invalid_outcome', `EpisodicRecord.outcome must be one of ${EPISODE_OUTCOMES.join(', ')}`);
  if (r.pnl !== null && !isFiniteNumber(r.pnl)) return fail('invalid_numeric_field', 'EpisodicRecord.pnl must be null or a finite number (not NaN/Infinity)');
  if (r.holdingTimeSeconds !== null && !isFiniteNumber(r.holdingTimeSeconds)) return fail('invalid_numeric_field', 'EpisodicRecord.holdingTimeSeconds must be null or a finite number (not NaN/Infinity)');
  if (!isFiniteNumber(r.confidence) || r.confidence < 0 || r.confidence > 1) return fail('invalid_confidence', 'EpisodicRecord.confidence must be a finite number in [0, 1]');
  if (!Array.isArray(r.tags) || r.tags.some((t) => typeof t !== 'string')) return fail('invalid_tags', 'EpisodicRecord.tags must be an array of strings');
  return null;
}

function checkSemanticFact(fact: unknown, agentId: string): RuleFailure | null {
  if (!fact || typeof fact !== 'object') return fail('malformed_memory_package', 'semantic entries must be non-null objects');
  const f = fact as Partial<SemanticFact>;
  if (!isNonEmptyString(f.id)) return fail('missing_semantic_hash', 'SemanticFact.id must be a non-empty string');
  if (f.agentId !== agentId) return fail('inconsistent_metadata', `SemanticFact.agentId '${String(f.agentId)}' does not match MemoryPackage.meta.agentId '${agentId}'`);
  if (!isNonEmptyString(f.key)) return fail('malformed_memory_package', 'SemanticFact.key must be a non-empty string');
  if (typeof f.value !== 'string') return fail('malformed_memory_package', 'SemanticFact.value must be a string');
  if (!isFiniteNumber(f.confidence) || f.confidence < 0 || f.confidence > 1) return fail('invalid_confidence', 'SemanticFact.confidence must be a finite number in [0, 1]');
  if (!isFiniteNumber(f.updatedAt) || f.updatedAt < 0) return fail('invalid_numeric_field', 'SemanticFact.updatedAt must be a non-negative finite number');
  return null;
}

function checkWorkingEntry(entry: unknown, agentId: string): RuleFailure | null {
  if (!entry || typeof entry !== 'object') return fail('malformed_memory_package', 'working entries must be non-null objects');
  const w = entry as Partial<WorkingMemoryEntry>;
  if (w.agentId !== agentId) return fail('inconsistent_metadata', `WorkingMemoryEntry.agentId '${String(w.agentId)}' does not match MemoryPackage.meta.agentId '${agentId}'`);
  if (!isNonEmptyString(w.key)) return fail('malformed_memory_package', 'WorkingMemoryEntry.key must be a non-empty string');
  if (!isFiniteNumber(w.setAt) || w.setAt < 0) return fail('invalid_numeric_field', 'WorkingMemoryEntry.setAt must be a non-negative finite number');
  if (w.expiresAt !== null && (!isFiniteNumber(w.expiresAt) || w.expiresAt < w.setAt)) return fail('inconsistent_metadata', 'WorkingMemoryEntry.expiresAt must be null or a finite number >= setAt');
  return null;
}

function checkNoDuplicates(episodic: EpisodicRecord[], semantic: SemanticFact[]): RuleFailure | null {
  const episodicIds = new Set<string>();
  for (const record of episodic) {
    if (episodicIds.has(record.id)) return fail('duplicate_episodic_memory', `duplicate EpisodicRecord.id '${record.id}'`);
    episodicIds.add(record.id);
  }
  const semanticIds = new Set<string>();
  for (const fact of semantic) {
    if (semanticIds.has(fact.id)) return fail('duplicate_semantic_memory', `duplicate SemanticFact.id '${fact.id}'`);
    semanticIds.add(fact.id);
  }
  return null;
}

/** Runs every shape/consistency check in order, returning the first failure — mirrors the
 *  fail-fast pipeline style of `outcomeRecorder/rules.ts::checkTelemetry`. Fail-closed: a
 *  `MemoryPackage` that is not `status: 'valid'` with `validation.ok: true` is always rejected
 *  before any analytics are computed, since analytics over an already-invalid package would be
 *  meaningless. */
export function checkMemoryPackage(pkg: unknown): RuleFailure | null {
  if (!pkg || typeof pkg !== 'object') return fail('malformed_memory_package', 'MemoryPackage must be a non-null object');
  const p = pkg as Partial<MemoryPackage>;

  const metaFailure = checkMeta(p as MemoryPackage);
  if (metaFailure) return metaFailure;

  if (!p.validation || typeof p.validation !== 'object' || p.validation.ok !== true || p.status !== 'valid') {
    return fail('invalid_source_package', 'MemoryPackage must have status "valid" and validation.ok true');
  }

  if (!Array.isArray(p.episodic)) return fail('malformed_memory_package', 'MemoryPackage.episodic must be an array');
  if (!Array.isArray(p.semantic)) return fail('malformed_memory_package', 'MemoryPackage.semantic must be an array');
  if (!Array.isArray(p.working)) return fail('malformed_memory_package', 'MemoryPackage.working must be an array');

  const agentId = p.meta!.agentId;

  for (const record of p.episodic) {
    const failure = checkEpisodicRecord(record, agentId);
    if (failure) return failure;
  }
  for (const fact of p.semantic) {
    const failure = checkSemanticFact(fact, agentId);
    if (failure) return failure;
  }
  for (const entry of p.working) {
    const failure = checkWorkingEntry(entry, agentId);
    if (failure) return failure;
  }

  return checkNoDuplicates(p.episodic as EpisodicRecord[], p.semantic as SemanticFact[]);
}
