// Deterministic hashing for the Learning Engine. Same technique as every other layer: SHA-256
// over a canonical, key-sorted JSON string (see `../hashing.ts`). `snapshotId` (a fresh UUID per
// call) is always excluded before hashing, so computing analytics over the same MemoryPackage
// twice always produces an identical `snapshotHash`.
import { sha256 } from '../hashing.js';
import type { LearningSnapshot } from './types.js';

export function hashLearningSnapshot(snapshot: Omit<LearningSnapshot, 'snapshotHash' | 'snapshotId'>): string {
  return sha256(snapshot);
}
