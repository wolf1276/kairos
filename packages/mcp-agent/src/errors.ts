import type { TransactionResult } from '@wolf1276/kairos-sdk';

// Cross-contract panics surface only as `Error(Contract, #<code>)` on the wire (the enum
// variant name is lost), and the policies/delegation-manager contracts each define their own
// `#[contracterror]` enum starting at 1 — so the same number means different things depending
// on which contract raised it. Diagnostic events include the failing hook name ("before_hook"/
// "before_all") when the policies (enforcer) contract panicked; otherwise it's the manager's own.
const POLICY_ERRORS: Record<number, string> = {
  2: 'Policy violation (target-whitelist): the requested target contract is not on this delegation\'s allowed list.',
  3: 'Policy violation (spend-limit): this request would exceed the delegation\'s spending limit for the current period.',
  4: 'Policy violation (time-restriction): this delegation is not currently within its allowed time window.',
  5: 'Policy violation: the delegation\'s caveat terms could not be parsed.',
};

const MANAGER_ERRORS: Record<number, string> = {
  2: 'Delegation rejected: this delegation has already been disabled.',
  3: 'Delegation rejected: this delegation is already enabled.',
  4: 'Internal error: delegation chains and executions batch length mismatch.',
  5: 'Delegation rejected: the redeeming key does not match this delegation\'s delegate.',
  6: 'Delegation rejected: signature verification failed.',
  7: 'Delegation rejected: this delegation has been disabled/revoked.',
  8: 'Delegation rejected: authority chain does not link correctly to the root delegator.',
  9: 'The underlying contract call failed during execution.',
  10: 'Delegation manager is currently paused.',
  11: 'Delegation rejected: nonce mismatch (the delegation may have already been used or is not reusable).',
  12: 'Delegation manager is mid-transaction (reentrancy lock); retry shortly.',
};

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
  if (error instanceof Error) return mapRaw(error.message);
  return String(error);
}
