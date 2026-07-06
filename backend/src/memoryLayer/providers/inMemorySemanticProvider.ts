// Default SemanticMemoryProvider — in-memory store keyed by (agentId, key). Upserting an
// existing key replaces its fact; semantic memory has no history of prior values by design
// (that belongs in episodic memory, not here).
import type { SemanticFact } from '../types.js';
import { semanticFactErrors } from '../validation.js';
import type { SemanticMemoryProvider } from './types.js';

export interface InMemorySemanticProviderOptions {
  /** Max distinct keys retained per agent. Oldest-updated key evicted first once exceeded
   *  (tracked by insertion/update order, a `Map` preserves that natively). `undefined` (default)
   *  is unbounded, matching pre-Phase-4 behavior. */
  capacityPerAgent?: number;
}

export class InMemorySemanticProvider implements SemanticMemoryProvider {
  private byAgent = new Map<string, Map<string, SemanticFact>>();
  private readonly capacityPerAgent?: number;

  constructor(options: InMemorySemanticProviderOptions = {}) {
    if (options.capacityPerAgent !== undefined && (!Number.isInteger(options.capacityPerAgent) || options.capacityPerAgent <= 0)) {
      throw new Error(`InMemorySemanticProvider capacityPerAgent must be a positive integer, got ${options.capacityPerAgent}`);
    }
    this.capacityPerAgent = options.capacityPerAgent;
  }

  async upsert(fact: SemanticFact): Promise<void> {
    const errors = semanticFactErrors(fact);
    if (errors.length > 0) {
      throw new Error(`Invalid SemanticFact: ${errors.join('; ')}`);
    }

    const facts = this.byAgent.get(fact.agentId) ?? new Map<string, SemanticFact>();
    // Re-inserting an existing key moves it to the end of Map's iteration order, so eviction
    // below correctly treats it as "just touched", not "stale".
    facts.delete(fact.key);
    facts.set(fact.key, fact);
    if (this.capacityPerAgent !== undefined) {
      while (facts.size > this.capacityPerAgent) {
        const oldestKey = facts.keys().next().value;
        if (oldestKey === undefined) break;
        facts.delete(oldestKey);
      }
    }
    this.byAgent.set(fact.agentId, facts);
  }

  async list(agentId: string): Promise<SemanticFact[]> {
    return [...(this.byAgent.get(agentId)?.values() ?? [])];
  }

  async get(agentId: string, key: string): Promise<SemanticFact | null> {
    return this.byAgent.get(agentId)?.get(key) ?? null;
  }

  async clear(agentId: string): Promise<void> {
    this.byAgent.delete(agentId);
  }

  async size(agentId: string): Promise<number> {
    return this.byAgent.get(agentId)?.size ?? 0;
  }

  dispose(): void {
    this.byAgent.clear();
  }
}
