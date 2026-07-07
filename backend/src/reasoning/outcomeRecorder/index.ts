// Public surface of the Outcome Recorder (Phase 8). Callers import only from here.
export { recordOutcome, OutcomeRecordValidationError } from './recorder.js';
export { hashOutcomeRecord } from './hashing.js';
export {
  checkExecutionResultWellFormed,
  checkTransactionHash,
  checkTransactionXdrHash,
  checkFees,
  checkAmount,
  checkNumericField,
  checkBalancesConsistent,
  checkTelemetryHash,
  checkTelemetry,
} from './rules.js';
export { OUTCOME_RECORDER_VERSION, OUTCOME_REJECTION_REASONS } from './types.js';

export type { RuleFailure } from './rules.js';
export type {
  BalanceEntry,
  OutcomeTelemetry,
  OutcomeRecordMetadata,
  OutcomeRecord,
  OutcomeRejectionReason,
  RecordOutcomeOptions,
} from './types.js';
