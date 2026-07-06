// Storage abstraction for the Memory Engine. The orchestrator depends only on these interfaces
// — never on a concrete storage mechanism — so backing storage can move from in-memory to
// SQLite/Postgres/anything else later with zero call-site changes. Mirrors
// agentContext/cache/types.ts's FeatureCacheProvider pattern.
import type { EpisodicRecord, SemanticFact, WorkingMemoryEntry } from '../types.js';

/** Episodic memory is append-only by contract: no update/delete method exists on this
 *  interface, so a provider cannot offer a way to modify a past episode even by accident. */
export interface EpisodicMemoryProvider {
  append(record: EpisodicRecord): Promise<void>;
  list(agentId: string): Promise<EpisodicRecord[]>;
  get(agentId: string, id: string): Promise<EpisodicRecord | null>;
  size(agentId: string): Promise<number>;
  dispose?(): void;
}

export interface SemanticMemoryProvider {
  upsert(fact: SemanticFact): Promise<void>;
  list(agentId: string): Promise<SemanticFact[]>;
  get(agentId: string, key: string): Promise<SemanticFact | null>;
  clear(agentId: string): Promise<void>;
  size(agentId: string): Promise<number>;
  dispose?(): void;
}

export interface WorkingMemoryProvider {
  get(agentId: string, key: string): Promise<WorkingMemoryEntry | null>;
  set(agentId: string, key: string, value: unknown, ttlMs?: number): Promise<void>;
  invalidate(agentId: string, key: string): Promise<void>;
  clear(agentId: string): Promise<void>;
  list(agentId: string): Promise<WorkingMemoryEntry[]>;
  size(agentId: string): Promise<number>;
  dispose?(): void;
}
