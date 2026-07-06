// Default EpisodicMemoryProvider — append-only in-memory store, keyed by agentId. Node's
// single-threaded event loop means every method body here runs to completion before any other
// call can interleave (none of them await anything internally), so concurrent appends for
// different agents never interfere with each other.
import type { EpisodicRecord } from '../types.js';
import { episodicRecordErrors } from '../validation.js';
import type { EpisodicMemoryProvider } from './types.js';

export interface InMemoryEpisodicProviderOptions {
  /** Max records retained per agent. Oldest (by append order, not timestamp) evicted first once
   *  exceeded. `undefined` (default) means unbounded — matches the pre-Phase-4 behavior, so
   *  existing callers see no change unless they opt in. Production deployments running for a
   *  long time should set this; nothing here persists to disk, so unbounded growth is a real
   *  process-memory leak, not just a theoretical one. */
  capacityPerAgent?: number;
}

export class InMemoryEpisodicProvider implements EpisodicMemoryProvider {
  private byAgent = new Map<string, EpisodicRecord[]>();
  private readonly capacityPerAgent?: number;

  constructor(options: InMemoryEpisodicProviderOptions = {}) {
    if (options.capacityPerAgent !== undefined && (!Number.isInteger(options.capacityPerAgent) || options.capacityPerAgent <= 0)) {
      throw new Error(`InMemoryEpisodicProvider capacityPerAgent must be a positive integer, got ${options.capacityPerAgent}`);
    }
    this.capacityPerAgent = options.capacityPerAgent;
  }

  async append(record: EpisodicRecord): Promise<void> {
    // Write-time validation: fail loudly at the call site instead of silently admitting a
    // malformed record that only surfaces as a package-wide "invalid" status much later, deep
    // inside whatever code path happens to next assemble/retrieve this agent's memory.
    const errors = episodicRecordErrors(record);
    if (errors.length > 0) {
      throw new Error(`Invalid EpisodicRecord: ${errors.join('; ')}`);
    }

    const existing = this.byAgent.get(record.agentId) ?? [];
    if (existing.some((r) => r.id === record.id)) {
      throw new Error(`Episodic record with id "${record.id}" already exists for agent "${record.agentId}"`);
    }
    existing.push(record);
    if (this.capacityPerAgent !== undefined && existing.length > this.capacityPerAgent) {
      existing.splice(0, existing.length - this.capacityPerAgent);
    }
    this.byAgent.set(record.agentId, existing);
  }

  async list(agentId: string): Promise<EpisodicRecord[]> {
    return [...(this.byAgent.get(agentId) ?? [])];
  }

  async get(agentId: string, id: string): Promise<EpisodicRecord | null> {
    return (this.byAgent.get(agentId) ?? []).find((r) => r.id === id) ?? null;
  }

  async size(agentId: string): Promise<number> {
    return (this.byAgent.get(agentId) ?? []).length;
  }

  dispose(): void {
    this.byAgent.clear();
  }
}
