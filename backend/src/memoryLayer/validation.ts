// Memory Validation — the gate every MemoryPackage must pass before it's considered fit for
// any future Reasoning Layer to consume. Pure checks over already-assembled records; makes no
// I/O calls of its own. Fails closed: any malformed record marks the whole package invalid
// rather than silently dropping it.
//
// The single-record checkers below (`episodicRecordErrors`/`semanticFactErrors`/
// `workingMemoryEntryErrors`) are also the write-time gate providers call from `append()`/
// `upsert()`/`set()` (see providers/*.ts) — one set of rules, checked both at write time (fail
// fast, loudly, at the call site) and at package-assembly time (fail closed, for anything that
// reached storage through some other path).
import type { EpisodicRecord, SemanticFact, WorkingMemoryEntry } from './types.js';
import { MEMORY_PACKAGE_SCHEMA_VERSION } from './types.js';

const VALID_OUTCOMES = new Set(['win', 'loss', 'neutral', 'pending']);
const VALID_QUALITY = new Set(['high', 'medium', 'low']);

function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidConfidence(value: unknown): value is number {
  return isValidNumber(value) && value >= 0 && value <= 1;
}

/** Per-record checks only — no cross-record concerns (duplicate ids, schema version) since
 *  those require the full set/package context, not just one record. */
export function episodicRecordErrors(record: EpisodicRecord): string[] {
  const errors: string[] = [];
  if (!record.id) {
    errors.push('Episodic record missing id');
    return errors;
  }
  if (!isValidNumber(record.timestamp) || record.timestamp <= 0) {
    errors.push(`Episodic record ${record.id} has invalid timestamp`);
  }
  if (!record.contextRef) {
    errors.push(`Episodic record ${record.id} missing contextRef`);
  }
  if (!VALID_OUTCOMES.has(record.outcome)) {
    errors.push(`Episodic record ${record.id} has invalid outcome: "${record.outcome}"`);
  }
  if (!isValidConfidence(record.confidence)) {
    errors.push(`Episodic record ${record.id} has invalid confidence`);
  }
  if (!VALID_QUALITY.has(record.quality)) {
    errors.push(`Episodic record ${record.id} has invalid quality: "${record.quality}"`);
  }
  if (record.pnl !== null && !isValidNumber(record.pnl)) {
    errors.push(`Episodic record ${record.id} has invalid pnl`);
  }
  if (record.holdingTimeSeconds !== null && (!isValidNumber(record.holdingTimeSeconds) || record.holdingTimeSeconds < 0)) {
    errors.push(`Episodic record ${record.id} has invalid holdingTimeSeconds`);
  }
  return errors;
}

export function semanticFactErrors(fact: SemanticFact): string[] {
  const errors: string[] = [];
  if (!fact.id) {
    errors.push('Semantic fact missing id');
    return errors;
  }
  if (!fact.key) {
    errors.push(`Semantic fact ${fact.id} missing key`);
  }
  if (!isValidConfidence(fact.confidence)) {
    errors.push(`Semantic fact ${fact.id} has invalid confidence`);
  }
  if (!isValidNumber(fact.updatedAt) || fact.updatedAt <= 0) {
    errors.push(`Semantic fact ${fact.id} has invalid updatedAt`);
  }
  return errors;
}

export function workingMemoryEntryErrors(entry: WorkingMemoryEntry): string[] {
  const errors: string[] = [];
  if (!entry.key) {
    errors.push('Working memory entry missing key');
    return errors;
  }
  if (!isValidNumber(entry.setAt) || entry.setAt <= 0) {
    errors.push(`Working memory entry "${entry.key}" has invalid setAt`);
  }
  if (entry.expiresAt !== null && (!isValidNumber(entry.expiresAt) || entry.expiresAt <= 0)) {
    errors.push(`Working memory entry "${entry.key}" has invalid expiresAt`);
  }
  return errors;
}

export interface MemoryValidationInput {
  episodic: EpisodicRecord[];
  semantic: SemanticFact[];
  working: WorkingMemoryEntry[];
  schemaVersion?: string;
}

export interface MemoryValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateMemoryPackage(input: MemoryValidationInput): MemoryValidationResult {
  const errors: string[] = [];

  const episodicIds = new Set<string>();
  for (const record of input.episodic) {
    if (record.id && episodicIds.has(record.id)) {
      errors.push(`Duplicate episodic record id: ${record.id}`);
      continue;
    }
    if (record.id) episodicIds.add(record.id);
    errors.push(...episodicRecordErrors(record));
  }

  const semanticIds = new Set<string>();
  for (const fact of input.semantic) {
    if (fact.id && semanticIds.has(fact.id)) {
      errors.push(`Duplicate semantic fact id: ${fact.id}`);
      continue;
    }
    if (fact.id) semanticIds.add(fact.id);
    errors.push(...semanticFactErrors(fact));
  }

  for (const entry of input.working) {
    errors.push(...workingMemoryEntryErrors(entry));
  }

  if (input.schemaVersion !== undefined && input.schemaVersion !== MEMORY_PACKAGE_SCHEMA_VERSION) {
    errors.push(`Unsupported memory package schema version (${input.schemaVersion}, expected ${MEMORY_PACKAGE_SCHEMA_VERSION})`);
  }

  return { ok: errors.length === 0, errors };
}
