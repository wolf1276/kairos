// Memory Writer rules: pure, synchronous predicate/shape-check functions. Kept separate from
// `writer.ts` so every rule is independently unit-testable — same pattern as
// `../outcomeRecorder/rules.ts`. Fail-closed throughout: a malformed or unverifiable value is
// always rejected, never passed through. The Memory Writer never trusts that an `OutcomeRecord`
// it receives actually came from `recordOutcome()` — it re-validates the shape itself.
import type { MemoryWriteRejectionReason, OutcomeRecordInput } from './types.js';

export interface RuleFailure {
  reason: MemoryWriteRejectionReason;
  message: string;
}

function fail(reason: MemoryWriteRejectionReason, message: string): RuleFailure {
  return { reason, message };
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const STATUSES = new Set(['success', 'failed']);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeNumericString(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
}

function isHex64(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX.test(value);
}

function checkBalanceList(field: string, list: unknown): RuleFailure | null {
  if (!Array.isArray(list)) return fail('inconsistent_balances', `${field} must be an array of { asset, amount }`);
  const seen = new Set<string>();
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') return fail('inconsistent_balances', `${field} entries must be objects`);
    const e = entry as { asset?: unknown; amount?: unknown };
    if (!isNonEmptyString(e.asset)) return fail('inconsistent_balances', `${field} entries must have a non-empty 'asset'`);
    if (!isNonNegativeNumericString(e.amount)) return fail('inconsistent_balances', `${field} entry for '${e.asset}' must have a non-negative finite numeric 'amount'`);
    if (seen.has(e.asset)) return fail('inconsistent_balances', `${field} has a duplicate entry for asset '${e.asset}'`);
    seen.add(e.asset);
  }
  return null;
}

export function checkAgentId(agentId: unknown): RuleFailure | null {
  if (!isNonEmptyString(agentId)) return fail('invalid_agent_id', 'agentId must be a non-empty string');
  return null;
}

/** Shape-checks the `OutcomeRecord` this write is built from. */
export function checkOutcomeRecordWellFormed(record: unknown): RuleFailure | null {
  if (!record || typeof record !== 'object') return fail('malformed_outcome_record', 'OutcomeRecord must be a non-null object');
  const r = record as Partial<OutcomeRecordInput>;

  if (!isNonEmptyString(r.outcomeId)) return fail('malformed_outcome_record', 'OutcomeRecord.outcomeId must be a non-empty string');
  if (!isHex64(r.outcomeHash)) return fail('missing_outcome_hash', 'OutcomeRecord.outcomeHash must be a 64-character lowercase hex string');
  if (!isNonEmptyString(r.executionId)) return fail('malformed_outcome_record', 'OutcomeRecord.executionId must be a non-empty string');
  if (!isHex64(r.executionHash)) return fail('malformed_outcome_record', 'OutcomeRecord.executionHash must be a 64-character lowercase hex string');
  if (!isNonEmptyString(r.protocol)) return fail('invalid_protocol', 'OutcomeRecord.protocol must be a non-empty string');
  if (!isNonEmptyString(r.action)) return fail('invalid_action', 'OutcomeRecord.action must be a non-empty string');
  if (!Array.isArray(r.assets) || r.assets.length === 0 || !r.assets.every(isNonEmptyString)) {
    return fail('malformed_outcome_record', 'OutcomeRecord.assets must be a non-empty array of non-empty strings');
  }
  if (typeof r.executionStatus !== 'string' || !STATUSES.has(r.executionStatus)) {
    return fail('invalid_status', "OutcomeRecord.executionStatus must be 'success' or 'failed'");
  }
  if (r.dataSource !== 'real' && r.dataSource !== 'synthetic') {
    return fail('malformed_outcome_record', "OutcomeRecord.dataSource must be 'real' or 'synthetic'");
  }
  if (!isNonNegativeNumericString(r.amountRequested)) return fail('invalid_amount', 'OutcomeRecord.amountRequested must be a non-negative finite numeric string');
  if (!isNonNegativeNumericString(r.amountExecuted)) return fail('invalid_amount', 'OutcomeRecord.amountExecuted must be a non-negative finite numeric string');
  if (!isNonNegativeNumericString(r.fees)) return fail('invalid_amount', 'OutcomeRecord.fees must be a non-negative finite numeric string');
  if (!isFiniteNumber(r.slippage)) return fail('invalid_numeric_field', 'OutcomeRecord.slippage must be a finite number (not NaN/Infinity)');
  if (!isFiniteNumber(r.priceImpact)) return fail('invalid_numeric_field', 'OutcomeRecord.priceImpact must be a finite number (not NaN/Infinity)');
  if (!isFiniteNumber(r.retryCount) || r.retryCount < 0) return fail('invalid_numeric_field', 'OutcomeRecord.retryCount must be a non-negative finite number');

  const beforeFailure = checkBalanceList('balancesBefore', r.balancesBefore);
  if (beforeFailure) return beforeFailure;
  const afterFailure = checkBalanceList('balancesAfter', r.balancesAfter);
  if (afterFailure) return afterFailure;
  const beforeAssets = new Set((r.balancesBefore as { asset: string }[]).map((b) => b.asset));
  const afterAssets = new Set((r.balancesAfter as { asset: string }[]).map((b) => b.asset));
  if (beforeAssets.size !== afterAssets.size || [...beforeAssets].some((a) => !afterAssets.has(a))) {
    return fail('inconsistent_balances', 'balancesBefore and balancesAfter must cover the exact same set of assets');
  }

  if (!isHex64(r.transactionHash)) return fail('invalid_hash', 'OutcomeRecord.transactionHash must be a 64-character lowercase hex string');
  if (!isHex64(r.transactionXDRHash)) return fail('invalid_hash', 'OutcomeRecord.transactionXDRHash must be a 64-character lowercase hex string');
  if (!isHex64(r.verificationHash)) return fail('invalid_hash', 'OutcomeRecord.verificationHash must be a 64-character lowercase hex string');
  if (!isHex64(r.routeHash)) return fail('invalid_hash', 'OutcomeRecord.routeHash must be a 64-character lowercase hex string');
  if (!isHex64(r.contextHash)) return fail('invalid_hash', 'OutcomeRecord.contextHash must be a 64-character lowercase hex string');
  if (!isHex64(r.memoryHash)) return fail('invalid_hash', 'OutcomeRecord.memoryHash must be a 64-character lowercase hex string');
  if (r.failureReason !== null && !isNonEmptyString(r.failureReason)) {
    return fail('malformed_outcome_record', 'OutcomeRecord.failureReason must be null or a non-empty string');
  }

  return null;
}
