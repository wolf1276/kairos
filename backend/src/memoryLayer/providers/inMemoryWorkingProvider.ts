// Default WorkingMemoryProvider — in-memory TTL store keyed by (agentId, key), the same
// shape as agentContext/cache/inMemoryFeatureCacheProvider.ts's TTL Map. Working memory is
// explicitly not durable: a process restart (or dispose()) is a valid way to lose it.
import type { WorkingMemoryEntry } from '../types.js';
import { workingMemoryEntryErrors } from '../validation.js';
import type { WorkingMemoryProvider } from './types.js';

const DEFAULT_TTL_MS = 5 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

export interface InMemoryWorkingProviderOptions {
  /** Max distinct keys retained per agent, evicted oldest-set-first once exceeded. `undefined`
   *  (default) is unbounded, matching pre-Phase-4 behavior. TTL sweeping already bounds this in
   *  the common case, but a capacity is a hard backstop against callers that never let entries
   *  expire (very long/no ttlMs) from growing a process's memory without limit. */
  capacityPerAgent?: number;
}

export class InMemoryWorkingProvider implements WorkingMemoryProvider {
  private byAgent = new Map<string, Map<string, WorkingMemoryEntry>>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private readonly capacityPerAgent?: number;

  constructor(options: InMemoryWorkingProviderOptions = {}) {
    if (options.capacityPerAgent !== undefined && (!Number.isInteger(options.capacityPerAgent) || options.capacityPerAgent <= 0)) {
      throw new Error(`InMemoryWorkingProvider capacityPerAgent must be a positive integer, got ${options.capacityPerAgent}`);
    }
    this.capacityPerAgent = options.capacityPerAgent;
    this.sweepTimer = setInterval(() => this.sweepExpired(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const entries of this.byAgent.values()) {
      for (const [key, entry] of entries) {
        if (entry.expiresAt !== null && now >= entry.expiresAt) entries.delete(key);
      }
    }
  }

  async get(agentId: string, key: string): Promise<WorkingMemoryEntry | null> {
    const entry = this.byAgent.get(agentId)?.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      this.byAgent.get(agentId)?.delete(key);
      return null;
    }
    return entry;
  }

  async set(agentId: string, key: string, value: unknown, ttlMs = DEFAULT_TTL_MS): Promise<void> {
    const now = Date.now();
    const expiresAt = !Number.isFinite(ttlMs) ? null : now + ttlMs;
    const entry: WorkingMemoryEntry = { agentId, key, value, setAt: now, expiresAt };
    const errors = workingMemoryEntryErrors(entry);
    if (errors.length > 0) {
      throw new Error(`Invalid WorkingMemoryEntry: ${errors.join('; ')}`);
    }

    const entries = this.byAgent.get(agentId) ?? new Map<string, WorkingMemoryEntry>();
    entries.delete(key);
    entries.set(key, entry);
    if (this.capacityPerAgent !== undefined) {
      while (entries.size > this.capacityPerAgent) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey === undefined) break;
        entries.delete(oldestKey);
      }
    }
    this.byAgent.set(agentId, entries);
  }

  async invalidate(agentId: string, key: string): Promise<void> {
    this.byAgent.get(agentId)?.delete(key);
  }

  async clear(agentId: string): Promise<void> {
    this.byAgent.delete(agentId);
  }

  async list(agentId: string): Promise<WorkingMemoryEntry[]> {
    const now = Date.now();
    return [...(this.byAgent.get(agentId)?.values() ?? [])].filter(
      (e) => e.expiresAt === null || now < e.expiresAt
    );
  }

  async size(agentId: string): Promise<number> {
    return (await this.list(agentId)).length;
  }

  dispose(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    this.byAgent.clear();
  }
}
