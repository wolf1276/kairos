// Pure, synchronous derivation of memory entries from an `OutcomeRecord`. Every value here is a
// direct transcription or fixed lookup-table mapping of a field already present on the record —
// never a computed statistic, aggregation, or AI-derived judgment. Same (outcomeHash, agentId,
// timestamp) always derives byte-identical entries.
import { hashEpisodicId, hashSemanticId } from './hashing.js';
import type { EpisodicRecord, EpisodeOutcome, MemoryQuality, SemanticFact, WorkingMemoryEntry } from '../../memoryLayer/types.js';
import type { OutcomeRecordInput } from './types.js';

/** Fixed TTL for the working-memory pointer to the latest outcome per (protocol, action).
 *  A constant, not a computed/inferred value — 24h scratch-space retention. */
const WORKING_MEMORY_TTL_MS = 24 * 60 * 60 * 1000;

/** Fixed lookup table, not inference: a successful execution is a 'win' episode, a failed one a
 *  'loss' episode. `OutcomeRecord.executionStatus` only ever takes these two values. */
function deriveEpisodeOutcome(status: OutcomeRecordInput['executionStatus']): EpisodeOutcome {
  return status === 'success' ? 'win' : 'loss';
}

/** Fixed lookup table, not inference: telemetry sourced from a real submitted transaction is
 *  higher quality than synthetic/simulated telemetry. */
function deriveQuality(dataSource: OutcomeRecordInput['dataSource']): MemoryQuality {
  return dataSource === 'real' ? 'high' : 'medium';
}

export function buildEpisodicRecord(record: OutcomeRecordInput, agentId: string, timestamp: number): EpisodicRecord {
  return {
    id: hashEpisodicId(record.outcomeHash, agentId),
    agentId,
    timestamp,
    contextRef: record.contextHash,
    decisionRef: record.verificationHash,
    executionRef: record.executionHash,
    outcome: deriveEpisodeOutcome(record.executionStatus),
    // Not computed from balances (that would be inference) — Phase 8 never records a realized
    // PnL, so it is never fabricated here.
    pnl: null,
    holdingTimeSeconds: null,
    // Directly-observed post-submission telemetry, not a prediction — full confidence.
    confidence: 1,
    quality: deriveQuality(record.dataSource),
    tags: [record.protocol, record.action, record.executionStatus, record.dataSource, ...record.assets],
  };
}

/** One-to-one field transcriptions keyed by (protocol, action) — no aggregation across
 *  outcomes, no statistics. Each fact's value is a later-write-wins snapshot of a single
 *  `OutcomeRecord` field, exactly matching `SemanticFact`'s "later value replaces the prior
 *  one" contract. */
export function buildSemanticFacts(record: OutcomeRecordInput, agentId: string, timestamp: number): SemanticFact[] {
  const scope = `${record.protocol}:${record.action}`;
  const entries: { key: string; value: string }[] = [
    { key: `last_status:${scope}`, value: record.executionStatus },
    { key: `last_amount_executed:${scope}`, value: record.amountExecuted },
    { key: `last_fees:${scope}`, value: record.fees },
    { key: `last_transaction_hash:${scope}`, value: record.transactionHash },
  ];
  return entries.map(({ key, value }) => ({
    id: hashSemanticId(record.outcomeHash, agentId, key),
    agentId,
    key,
    value,
    // Directly-observed telemetry, not a prediction — full confidence.
    confidence: 1,
    updatedAt: timestamp,
    tags: [record.protocol, record.action],
  }));
}

/** Ephemeral scratch pointer to the most recent outcome for a (protocol, action) pair. */
export function buildWorkingMemoryEntries(record: OutcomeRecordInput, agentId: string, timestamp: number): WorkingMemoryEntry[] {
  return [
    {
      agentId,
      key: `last_outcome:${record.protocol}:${record.action}`,
      value: { outcomeId: record.outcomeId, outcomeHash: record.outcomeHash, executionStatus: record.executionStatus },
      setAt: timestamp,
      expiresAt: timestamp + WORKING_MEMORY_TTL_MS,
    },
  ];
}
