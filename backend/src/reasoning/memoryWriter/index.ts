// Public surface of the Memory Writer (Phase 9). Callers import only from here.
export { writeMemory, MemoryWriteValidationError } from './writer.js';
export type { WriteMemoryProviders } from './writer.js';
export { hashMemoryWrite, hashEpisodicId, hashSemanticId } from './hashing.js';
export { buildEpisodicRecord, buildSemanticFacts, buildWorkingMemoryEntries } from './deriver.js';
export { checkOutcomeRecordWellFormed, checkAgentId } from './rules.js';
export { MEMORY_WRITER_VERSION, MEMORY_WRITE_REJECTION_REASONS } from './types.js';

export type { RuleFailure } from './rules.js';
export type {
  MemoryWriteOptions,
  MemoryWriteResult,
  MemoryWriteRejectionReason,
  OutcomeRecordInput,
} from './types.js';
