// Memory Writer (Phase 9) orchestrator: OutcomeRecord (Phase 8, frozen) -> MemoryWriteResult.
// Purely deterministic derivation (see `deriver.ts`) persisted through the Memory Engine's own
// provider interfaces (see `../../memoryLayer/providers`). No AI/LLM, no summarization, no
// inference. Fail-closed: any malformed input throws `MemoryWriteValidationError` before
// anything is derived or persisted.
//
// Idempotency/thread-safety: episodic memory is append-only and its id is a deterministic hash
// of (outcomeHash, agentId), so persisting the same OutcomeRecord for the same agent twice —
// sequentially or concurrently — always resolves to the same id. `InMemoryEpisodicProvider
// .append()` detects the duplicate id and throws synchronously (its body has no internal
// `await`, so under Node's single-threaded event loop two concurrent `append()` calls for the
// same id can never both "win" the race); this writer catches that specific duplicate error and
// reports `status: 'duplicate'` instead of re-throwing. Semantic/working writes are plain
// upserts of deterministic content, so replaying them is always harmless regardless of race
// order — "idempotent by construction", not by locking.
import { randomUUID } from 'crypto';
import { getEpisodicMemoryProvider, getSemanticMemoryProvider, getWorkingMemoryProvider } from '../../memoryLayer/providers/index.js';
import type { EpisodicMemoryProvider, SemanticMemoryProvider, WorkingMemoryProvider } from '../../memoryLayer/providers/types.js';
import { buildEpisodicRecord, buildSemanticFacts, buildWorkingMemoryEntries } from './deriver.js';
import { hashMemoryWrite } from './hashing.js';
import { checkAgentId, checkOutcomeRecordWellFormed } from './rules.js';
import type { MemoryWriteOptions, MemoryWriteResult, OutcomeRecordInput } from './types.js';

export class MemoryWriteValidationError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(`Memory write validation failed [${reason}]: ${message}`);
    this.name = 'MemoryWriteValidationError';
    this.reason = reason;
  }
}

const DUPLICATE_EPISODIC_MARKER = 'already exists';

export interface WriteMemoryProviders {
  episodic?: EpisodicMemoryProvider;
  semantic?: SemanticMemoryProvider;
  working?: WorkingMemoryProvider;
}

/**
 * Writes the deterministic memory entries derived from one already-recorded Phase 8
 * `OutcomeRecord`. Always either returns a fully-formed `MemoryWriteResult` or throws
 * `MemoryWriteValidationError` — never a partial/best-effort write. Never mutates the
 * `OutcomeRecord` passed in.
 */
export async function writeMemory(
  outcomeRecord: OutcomeRecordInput,
  options: MemoryWriteOptions,
  providers: WriteMemoryProviders = {}
): Promise<MemoryWriteResult> {
  const recordFailure = checkOutcomeRecordWellFormed(outcomeRecord);
  if (recordFailure) throw new MemoryWriteValidationError(recordFailure.reason, recordFailure.message);

  const agentFailure = checkAgentId(options.agentId);
  if (agentFailure) throw new MemoryWriteValidationError(agentFailure.reason, agentFailure.message);

  const agentId = options.agentId;
  const timestamp = options.timestamp ?? Date.now();
  const writeId = options.writeId ?? randomUUID();

  const episodic = buildEpisodicRecord(outcomeRecord, agentId, timestamp);
  const semantic = buildSemanticFacts(outcomeRecord, agentId, timestamp);
  const working = buildWorkingMemoryEntries(outcomeRecord, agentId, timestamp);

  const { timestamp: _episodicTimestamp, ...episodicForHash } = episodic;
  const writeHash = hashMemoryWrite({
    outcomeHash: outcomeRecord.outcomeHash,
    agentId,
    episodic: episodicForHash,
    semantic: semantic.map(({ updatedAt: _updatedAt, ...rest }) => rest),
    working: working.map(({ setAt: _setAt, expiresAt: _expiresAt, ...rest }) => rest),
  });

  const episodicProvider = providers.episodic ?? getEpisodicMemoryProvider();
  const semanticProvider = providers.semantic ?? getSemanticMemoryProvider();
  const workingProvider = providers.working ?? getWorkingMemoryProvider();

  let status: MemoryWriteResult['status'] = 'written';
  try {
    await episodicProvider.append(episodic);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes(DUPLICATE_EPISODIC_MARKER)) throw err;
    status = 'duplicate';
  }

  for (const fact of semantic) {
    await semanticProvider.upsert(fact);
  }
  for (const entry of working) {
    const ttlMs = entry.expiresAt === null ? Number.POSITIVE_INFINITY : entry.expiresAt - entry.setAt;
    await workingProvider.set(entry.agentId, entry.key, entry.value, ttlMs);
  }

  return {
    writeId,
    writeHash,
    outcomeId: outcomeRecord.outcomeId,
    outcomeHash: outcomeRecord.outcomeHash,
    agentId,
    status,
    episodic,
    semantic,
    working,
  };
}
