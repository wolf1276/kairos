import type { TransactionResult } from '@wolf1276/kairos-sdk';

// Cross-contract panics surface only as `Error(Contract, #<code>)` on the wire — see
// packages/mcp-agent/src/errors.ts for the full explanation. Duplicated here rather than
// shared because this is a separate deployable service with its own dependency boundary.
const POLICY_ERRORS: Record<number, string> = {
  2: "Policy violation (target-whitelist): the requested target contract is not on this delegation's allowed list.",
  3: "Policy violation (spend-limit): this request would exceed the delegation's spending limit for the current period.",
  4: 'Policy violation (time-restriction): this delegation is not currently within its allowed time window.',
  5: "Policy violation: the delegation's caveat terms could not be parsed.",
};

const MANAGER_ERRORS: Record<number, string> = {
  2: 'Delegation rejected: this delegation has already been disabled.',
  3: 'Delegation rejected: this delegation is already enabled.',
  4: 'Internal error: delegation chains and executions batch length mismatch.',
  5: "Delegation rejected: the redeeming key does not match this delegation's delegate.",
  6: 'Delegation rejected: signature verification failed.',
  7: 'Delegation rejected: this delegation has been disabled/revoked.',
  8: 'Delegation rejected: authority chain does not link correctly to the root delegator.',
  9: 'The underlying contract call failed during execution.',
  10: 'Delegation manager is currently paused.',
  11: "Delegation rejected: nonce mismatch (the delegation may have already been used or is not reusable).",
  12: 'Delegation manager is mid-transaction (reentrancy lock); retry shortly.',
};

// Classic-Horizon submitTransaction rejections (used by tick.ts's live quant/limit trades and
// roleTick.ts's live role-agent trades) — Horizon's real rejection reason lives in
// `error.response.data.extras.result_codes`, not `error.message` (which is just axios's
// generic "Request failed with status code 400"). Left undecoded, every operator-facing
// message ("Current task" on the dashboard, decision records, audit log) was a useless string
// that told the user nothing about why the trade actually failed.
const HORIZON_TX_CODES: Record<string, string> = {
  tx_bad_seq: 'Stale transaction sequence number — will retry next tick.',
  tx_insufficient_balance: "Account balance too low to cover the transaction plus Stellar's minimum reserve.",
  tx_insufficient_fee: 'Submitted fee was below the network minimum.',
  tx_bad_auth: 'Transaction signature is invalid or missing a required signer.',
  tx_no_source_account: 'Source account does not exist or is unfunded.',
};
const HORIZON_OP_CODES: Record<string, string> = {
  op_underfunded: 'Insufficient balance of the asset being spent for this trade.',
  op_low_reserve: 'This trade would drop the account below its minimum XLM reserve.',
  op_no_trust: 'Missing trustline for one of the assets in this trade.',
  op_no_destination: 'Destination account does not exist.',
  op_line_full: "Destination's trustline limit would be exceeded by this trade.",
  op_no_issuer: 'One of the assets in this trade has no issuer on this network.',
  op_too_few_offers: 'No liquidity available on this path at the requested price.',
  op_over_source_max: 'Price moved past the maximum-send limit before this trade executed.',
  op_under_dest_min: 'Price moved past the minimum-receive limit before this trade executed.',
};

interface AxiosLikeErrorShape {
  isAxiosError?: boolean;
  response?: {
    status?: number;
    data?: {
      extras?: { result_codes?: { transaction?: string; operations?: string[] } };
      message?: string;
      error?: string | { message?: string };
      detail?: string;
    };
  };
}

/** Extracts and decodes Horizon's structured result codes, if present on a thrown error. */
function decodeHorizonError(response: NonNullable<AxiosLikeErrorShape['response']>): string | null {
  const codes = response.data?.extras?.result_codes;
  if (!codes) return null;
  const opCode = codes.operations?.find((c) => c !== 'op_success');
  if (opCode) return HORIZON_OP_CODES[opCode] ?? `Trade rejected by the network: ${opCode}`;
  if (codes.transaction && codes.transaction !== 'tx_success') {
    return HORIZON_TX_CODES[codes.transaction] ?? `Transaction rejected by the network: ${codes.transaction}`;
  }
  return null;
}

/**
 * Any HTTP client thrown error (Horizon, Turnkey's signing API, or a bare axios call) has its
 * *actual* rejection reason in the response body, not `error.message` — axios always sets that
 * to the generic "Request failed with status code <N>" regardless of what the server said. Left
 * undecoded, every operator-facing message ("Current task" on the dashboard, decision records,
 * audit log) was that useless generic string with zero diagnostic value.
 */
function decodeHttpError(error: unknown): string | null {
  const response = (error as AxiosLikeErrorShape)?.response;
  if (!response) return null;

  const horizon = decodeHorizonError(response);
  if (horizon) return horizon;

  const data = response.data;
  const detail =
    (typeof data?.error === 'string' ? data.error : data?.error?.message) ?? data?.message ?? data?.detail;
  const status = response.status ? ` (HTTP ${response.status})` : '';
  return detail ? `${detail}${status}` : null;
}

function mapRaw(raw: string): string {
  const match = raw.match(/Error\(Contract, #(\d+)\)/);
  if (!match) return `Execution failed: ${raw}`;
  const code = Number(match[1]);
  const isPolicyError = raw.includes('before_hook') || raw.includes('before_all') || raw.includes('after_hook') || raw.includes('after_all');
  const message = (isPolicyError ? POLICY_ERRORS : MANAGER_ERRORS)[code];
  return message || `Execution failed: ${raw}`;
}

export function mapExecutionError(result: TransactionResult): string {
  return mapRaw(result.error || 'Unknown execution failure');
}

export function mapThrownError(error: unknown): string {
  const httpMessage = decodeHttpError(error);
  if (httpMessage) return httpMessage;
  if (error instanceof Error) return mapRaw(error.message);
  return String(error);
}
