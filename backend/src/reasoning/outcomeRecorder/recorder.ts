// Outcome Recorder (Phase 8) orchestrator: ExecutionResult (Phase 7, frozen) + OutcomeTelemetry ->
// OutcomeRecord. Purely synchronous and side-effect-free — no AI/LLM, no execution, no network
// call, no shared mutable state, so concurrent calls (however many, however parallel) can never
// race: each call only ever reads its own arguments and returns a freshly built, deep-frozen
// object. Never mutates the ExecutionResult passed in. Fail-closed: any malformed input throws
// `OutcomeRecordValidationError` before an OutcomeRecord is built.
import { randomUUID } from 'crypto';
import { hashOutcomeRecord } from './hashing.js';
import { checkExecutionResultWellFormed, checkTelemetry } from './rules.js';
import { OUTCOME_RECORDER_VERSION } from './types.js';
import type { ExecutionResult } from '../routeExecutionEngine/types.js';
import type { OutcomeRecord, OutcomeTelemetry, RecordOutcomeOptions } from './types.js';

export class OutcomeRecordValidationError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(`Outcome record validation failed [${reason}]: ${message}`);
    this.name = 'OutcomeRecordValidationError';
    this.reason = reason;
  }
}

/** Recursively freezes a record so no downstream consumer can mutate it after it's built — same
 *  technique as `executionPlanner/planner.ts::deepFreeze` and `routeExecutionEngine/engine.ts::
 *  deepFreeze`, duplicated locally rather than importing from another phase. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** Derives the ordered, deduplicated set of assets this execution touched: the primary asset,
 *  then (for swaps) the output asset, then any multi-hop path assets — never inferred from
 *  telemetry, always read straight off the route request that was actually executed. */
function deriveAssets(request: { asset: string; outputAsset?: string; path?: string[] }): string[] {
  const assets: string[] = [request.asset];
  if (request.outputAsset && !assets.includes(request.outputAsset)) assets.push(request.outputAsset);
  for (const asset of request.path ?? []) {
    if (!assets.includes(asset)) assets.push(asset);
  }
  return assets;
}

/**
 * Records the real-world outcome of one already-completed Phase 7 execution. Always either
 * returns a fully-formed, immutable `OutcomeRecord` or throws `OutcomeRecordValidationError` —
 * never a partial/best-effort record. Never mutates `executionResult`.
 */
export function recordOutcome(executionResult: ExecutionResult, telemetry: OutcomeTelemetry, options: RecordOutcomeOptions = {}): OutcomeRecord {
  const resultFailure = checkExecutionResultWellFormed(executionResult);
  if (resultFailure) throw new OutcomeRecordValidationError(resultFailure.reason, resultFailure.message);

  const telemetryFailure = checkTelemetry(telemetry);
  if (telemetryFailure) throw new OutcomeRecordValidationError(telemetryFailure.reason, telemetryFailure.message);

  const outcomeId = options.outcomeId ?? randomUUID();
  const { metadata: telemetryMetadata, ...telemetryRest } = telemetry;

  const recordBase: Omit<OutcomeRecord, 'outcomeHash' | 'outcomeId'> = {
    executionId: executionResult.executionId,
    executionHash: executionResult.executionHash,
    protocol: executionResult.protocol,
    action: executionResult.route.request.action,
    assets: deriveAssets(executionResult.route.request),
    transactionHash: telemetryRest.transactionHash,
    transactionXDRHash: telemetryRest.transactionXDRHash,
    executionStatus: executionResult.status,
    dataSource: executionResult.metadata.dataSource,
    amountRequested: telemetryRest.amountRequested,
    amountExecuted: telemetryRest.amountExecuted,
    fees: telemetryRest.fees,
    slippage: telemetryRest.slippage,
    priceImpact: telemetryRest.priceImpact,
    balancesBefore: telemetryRest.balancesBefore,
    balancesAfter: telemetryRest.balancesAfter,
    executionDurationMs: executionResult.metadata.durationMs,
    resourceEstimate: executionResult.resourceEstimate,
    verificationHash: telemetryRest.verificationHash,
    routeHash: executionResult.route.routeHash,
    contextHash: telemetryRest.contextHash,
    memoryHash: telemetryRest.memoryHash,
    failureReason: executionResult.metadata.failureReason,
    retryCount: executionResult.metadata.retryCount,
    metadata: { recorderVersion: OUTCOME_RECORDER_VERSION, ...(telemetryMetadata ?? {}) },
  };

  const outcomeHash = hashOutcomeRecord(recordBase);
  const record: OutcomeRecord = { ...recordBase, outcomeId, outcomeHash };
  return deepFreeze(record);
}
