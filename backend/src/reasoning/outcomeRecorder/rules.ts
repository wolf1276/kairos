// Outcome Recorder rules: pure, synchronous predicate/shape-check functions. Kept separate from
// `recorder.ts` so every rule is independently unit-testable, matching the pattern used by
// `routeExecutionEngine/rules.ts` and `verification/rules/*.ts`. Fail-closed throughout: a
// malformed or unverifiable value is always rejected, never passed through.
import { DATA_SOURCES, EXECUTION_FAILURE_REASONS, EXECUTION_RESULT_STATUSES } from '../routeExecutionEngine/types.js';
import type { ExecutionResult } from '../routeExecutionEngine/types.js';
import type { BalanceEntry, OutcomeRejectionReason, OutcomeTelemetry } from './types.js';

export interface RuleFailure {
  reason: OutcomeRejectionReason;
  message: string;
}

function fail(reason: OutcomeRejectionReason, message: string): RuleFailure {
  return { reason, message };
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Numeric-string check for money/amount fields (fees, amounts, balances) — must parse to a
 *  finite, non-negative number. Rejects `NaN`/`Infinity`/`-Infinity` by construction, since
 *  `Number.isFinite` is false for all three. */
function isNonNegativeNumericString(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
}

/** Shape-checks the frozen Phase 7 `ExecutionResult` this record is built from — never trusts it
 *  came from `executeRoute()` just because the caller says so. */
export function checkExecutionResultWellFormed(result: unknown): RuleFailure | null {
  if (!result || typeof result !== 'object') return fail('malformed_execution_result', 'ExecutionResult must be a non-null object');
  const r = result as Partial<ExecutionResult>;

  if (!isNonEmptyString(r.executionId)) return fail('malformed_execution_result', "ExecutionResult.executionId must be a non-empty string");
  if (!isNonEmptyString(r.executionHash)) return fail('missing_execution_hash', 'ExecutionResult.executionHash must be a non-empty string');
  if (!isNonEmptyString(r.protocol)) return fail('invalid_protocol', 'ExecutionResult.protocol must be a non-empty string');
  if (typeof r.status !== 'string' || !(EXECUTION_RESULT_STATUSES as readonly string[]).includes(r.status)) {
    return fail('malformed_execution_result', `ExecutionResult.status must be one of ${EXECUTION_RESULT_STATUSES.join(', ')}`);
  }

  if (!r.route || typeof r.route !== 'object') return fail('malformed_execution_result', 'ExecutionResult.route must be a non-null object');
  if (!isNonEmptyString((r.route as { routeHash?: unknown }).routeHash)) return fail('missing_route_hash', 'ExecutionResult.route.routeHash must be a non-empty string');
  if (!r.route.request || typeof r.route.request !== 'object') return fail('malformed_execution_result', 'ExecutionResult.route.request must be a non-null object');
  if (!isNonEmptyString((r.route.request as { asset?: unknown }).asset)) return fail('malformed_execution_result', 'ExecutionResult.route.request.asset must be a non-empty string');
  if (!isNonEmptyString((r.route.request as { action?: unknown }).action)) return fail('invalid_action', 'ExecutionResult.route.request.action must be a non-empty string');

  const metadata = r.metadata;
  if (!metadata || typeof metadata !== 'object') return fail('malformed_execution_result', 'ExecutionResult.metadata must be a non-null object');
  if (!isFiniteNumber(metadata.durationMs) || metadata.durationMs < 0) return fail('malformed_execution_result', 'ExecutionResult.metadata.durationMs must be a non-negative finite number');
  if (!isFiniteNumber(metadata.retryCount) || metadata.retryCount < 0) return fail('malformed_execution_result', 'ExecutionResult.metadata.retryCount must be a non-negative finite number');
  if (!(DATA_SOURCES as readonly string[]).includes(metadata.dataSource as string)) return fail('malformed_execution_result', `ExecutionResult.metadata.dataSource must be one of ${DATA_SOURCES.join(', ')}`);
  if (metadata.failureReason !== null && !(EXECUTION_FAILURE_REASONS as readonly string[]).includes(metadata.failureReason as string)) {
    return fail('malformed_execution_result', 'ExecutionResult.metadata.failureReason must be null or a known ExecutionFailureReason');
  }
  if (r.resourceEstimate !== null) {
    if (typeof r.resourceEstimate !== 'object') return fail('malformed_execution_result', 'ExecutionResult.resourceEstimate must be null or an object');
  }

  return null;
}

export function checkTransactionHash(hash: unknown): RuleFailure | null {
  if (typeof hash !== 'string' || !SHA256_HEX.test(hash)) {
    return fail('invalid_transaction_hash', 'transactionHash must be a 64-character lowercase hex string');
  }
  return null;
}

export function checkTransactionXdrHash(hash: unknown): RuleFailure | null {
  if (typeof hash !== 'string' || !SHA256_HEX.test(hash)) {
    return fail('invalid_transaction_xdr_hash', 'transactionXDRHash must be a 64-character lowercase hex string');
  }
  return null;
}

export function checkFees(fees: unknown): RuleFailure | null {
  if (typeof fees !== 'string' || !Number.isFinite(Number(fees))) {
    return fail('negative_fees', 'fees must be a finite numeric string');
  }
  if (Number(fees) < 0) return fail('negative_fees', 'fees must not be negative');
  return null;
}

export function checkAmount(field: 'amountRequested' | 'amountExecuted', value: unknown): RuleFailure | null {
  if (!isNonNegativeNumericString(value)) {
    return fail('invalid_amount', `${field} must be a non-negative finite numeric string`);
  }
  return null;
}

export function checkNumericField(field: 'slippage' | 'priceImpact', value: unknown): RuleFailure | null {
  if (!isFiniteNumber(value)) {
    return fail('invalid_numeric_field', `${field} must be a finite number (not NaN/Infinity)`);
  }
  return null;
}

function checkBalanceList(field: 'balancesBefore' | 'balancesAfter', list: unknown): RuleFailure | null {
  if (!Array.isArray(list)) return fail('inconsistent_balances', `${field} must be an array of { asset, amount }`);
  const seen = new Set<string>();
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') return fail('inconsistent_balances', `${field} entries must be objects`);
    const e = entry as Partial<BalanceEntry>;
    if (!isNonEmptyString(e.asset)) return fail('inconsistent_balances', `${field} entries must have a non-empty 'asset'`);
    if (!isNonNegativeNumericString(e.amount)) return fail('inconsistent_balances', `${field} entry for '${e.asset}' must have a non-negative finite numeric 'amount'`);
    if (seen.has(e.asset)) return fail('inconsistent_balances', `${field} has a duplicate entry for asset '${e.asset}'`);
    seen.add(e.asset);
  }
  return null;
}

/** Balances must be well-formed on both sides *and* describe the same set of assets — a
 *  `balancesAfter` that introduces or drops an asset relative to `balancesBefore` is an
 *  inconsistent (and therefore untrustworthy) telemetry report. */
export function checkBalancesConsistent(balancesBefore: unknown, balancesAfter: unknown): RuleFailure | null {
  const beforeFailure = checkBalanceList('balancesBefore', balancesBefore);
  if (beforeFailure) return beforeFailure;
  const afterFailure = checkBalanceList('balancesAfter', balancesAfter);
  if (afterFailure) return afterFailure;

  const beforeAssets = new Set((balancesBefore as BalanceEntry[]).map((b) => b.asset));
  const afterAssets = new Set((balancesAfter as BalanceEntry[]).map((b) => b.asset));
  if (beforeAssets.size !== afterAssets.size || [...beforeAssets].some((a) => !afterAssets.has(a))) {
    return fail('inconsistent_balances', 'balancesBefore and balancesAfter must cover the exact same set of assets');
  }
  return null;
}

export function checkTelemetryHash(field: 'verificationHash' | 'contextHash' | 'memoryHash', value: unknown): RuleFailure | null {
  if (typeof value !== 'string' || !SHA256_HEX.test(value)) {
    return fail('malformed_telemetry', `${field} must be a 64-character lowercase hex string`);
  }
  return null;
}

/** Runs every telemetry-shaped check in order, returning the first failure — mirrors the
 *  fail-fast pipeline style of `routeExecutionEngine/engine.ts::runPipeline`. */
export function checkTelemetry(telemetry: OutcomeTelemetry): RuleFailure | null {
  return (
    checkTransactionHash(telemetry.transactionHash) ??
    checkTransactionXdrHash(telemetry.transactionXDRHash) ??
    checkAmount('amountRequested', telemetry.amountRequested) ??
    checkAmount('amountExecuted', telemetry.amountExecuted) ??
    checkFees(telemetry.fees) ??
    checkNumericField('slippage', telemetry.slippage) ??
    checkNumericField('priceImpact', telemetry.priceImpact) ??
    checkBalancesConsistent(telemetry.balancesBefore, telemetry.balancesAfter) ??
    checkTelemetryHash('verificationHash', telemetry.verificationHash) ??
    checkTelemetryHash('contextHash', telemetry.contextHash) ??
    checkTelemetryHash('memoryHash', telemetry.memoryHash) ??
    null
  );
}
