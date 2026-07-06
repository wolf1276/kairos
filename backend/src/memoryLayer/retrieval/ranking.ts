// Ranking Engine — sorts scored candidates deterministically. Ties (identical score) are broken
// by timestamp/updatedAt (newer first) and finally by id, so identical AgentContext + identical
// memory state always produces identical ordering regardless of provider list() insertion order.
import type { ScoredEpisodicRecord, ScoredSemanticFact } from './types.js';

export function rankEpisodicRecords(records: readonly ScoredEpisodicRecord[]): ScoredEpisodicRecord[] {
  return [...records].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function rankSemanticFacts(facts: readonly ScoredSemanticFact[]): ScoredSemanticFact[] {
  return [...facts].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
