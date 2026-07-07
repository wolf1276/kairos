// Deterministic hashing for the Memory Writer. Same technique as every other layer: SHA-256
// over a canonical, key-sorted JSON string (see `../hashing.ts`). Wall-clock fields
// (`writeId`, `timestamp`, `setAt`, `expiresAt`, `updatedAt`) are always excluded before
// hashing, so writing the same `OutcomeRecord` for the same `agentId` twice — at any two
// points in time — always produces an identical `writeHash`.
import { sha256 } from '../hashing.js';
import type { EpisodicRecord, SemanticFact, WorkingMemoryEntry } from '../../memoryLayer/types.js';

export function hashEpisodicId(outcomeHash: string, agentId: string): string {
  return sha256({ outcomeHash, agentId, kind: 'episodic' });
}

export function hashSemanticId(outcomeHash: string, agentId: string, key: string): string {
  return sha256({ outcomeHash, agentId, kind: 'semantic', key });
}

export interface MemoryWriteHashInput {
  outcomeHash: string;
  agentId: string;
  episodic: Omit<EpisodicRecord, 'timestamp'>;
  semantic: Omit<SemanticFact, 'updatedAt'>[];
  working: Omit<WorkingMemoryEntry, 'setAt' | 'expiresAt'>[];
}

export function hashMemoryWrite(input: MemoryWriteHashInput): string {
  return sha256(input);
}
