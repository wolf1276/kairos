// Routes an agent action into a real protocol (Blend, Soroswap, ...) through the Kairos
// delegation/redemption path — `client.execution.execute` submits the SDK-built `Execution`
// against `DelegationManager.redeem_delegations`, so it's checked on-chain against the agent's
// delegation caveats exactly like any other delegated call, unlike the legacy direct-custody
// trading loop (executionEngine.ts) which trades from the agent's own Turnkey-signed keypair.
// Gated by `isProtocolExecutionEnabled()` so it can run in parallel with the legacy path without
// affecting existing Strategy Mode agents until proven out.
//
// This module is deliberately protocol-agnostic: it never branches on `protocolId`. Everything
// protocol-specific (the on-chain `Execution`, the local position delta, the audit description)
// comes from `adapter.buildAction()` (see packages/sdk/src/protocols/types.ts). Adding a new
// protocol only requires a new adapter implementing that interface plus a registry entry — no
// changes here.
import { getAdapter, type ProtocolActionRequest, type ProtocolActionResult } from '@wolf1276/kairos-sdk';
import { getKairosClient } from './kairos.js';
import { getAgentSigner, getActiveDelegationForAgent } from './agentService.js';
import { isProtocolExecutionEnabled } from './config.js';
import {
  openProtocolExecution,
  markProtocolExecutionFailed,
  markProtocolExecutionBroadcast,
  applyProtocolExecutionRecord,
} from './protocolExecutionJournal.js';
import { logEvent } from './auditService.js';
import { mapExecutionError, mapThrownError } from './errors.js';
import type { AgentRow } from './db.js';

// A plain `Omit<ProtocolActionRequest, 'owner'>` collapses the union: TS's `Omit` is `Pick<T,
// Exclude<keyof T, K>>`, and `keyof` on a union takes the *intersection* of member keys — so a
// non-distributive Omit here would silently discard every field unique to one branch (Blend's
// `asset`/`amount`, Soroswap's `path`/`amountIn`/...), leaving a type that (wrongly) type-checks
// callers passing none of those fields. Distributing over the union first preserves each
// branch's own fields.
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

/** Caller-supplied side of a protocol action request — everything except `owner`, which this
 *  service fills in from the agent's active delegation at execution time rather than trusting
 *  a caller-supplied address. */
export type ProtocolActionInput = DistributiveOmit<ProtocolActionRequest, 'owner'>;

export interface ProtocolExecutionResult {
  ok: boolean;
  txHash?: string;
  error?: string;
}

function deserializeDelegation(d: NonNullable<ReturnType<typeof getActiveDelegationForAgent>>) {
  return {
    ...d,
    salt: BigInt(d.salt),
    nonce: BigInt(d.nonce),
    caveats: d.caveats.map((c) => ({ enforcer: c.enforcer, terms: new Uint8Array(c.terms) })),
  };
}

/**
 * Executes one protocol action for `row` through the delegation/redemption path, then records
 * the resulting position. Returns `{ ok: false }` without throwing on expected failure modes
 * (feature disabled, no active delegation, on-chain execution failure) so callers can fall back
 * to the legacy trading loop or surface the reason without a try/catch of their own.
 */
export async function executeProtocolAction(row: AgentRow, input: ProtocolActionInput): Promise<ProtocolExecutionResult> {
  if (!isProtocolExecutionEnabled()) {
    return { ok: false, error: 'Protocol execution is disabled (ENABLE_PROTOCOL_EXECUTION is not set)' };
  }

  const delegationJson = getActiveDelegationForAgent(row);
  if (!delegationJson) {
    logEvent({
      agentId: row.id,
      owner: row.owner,
      eventType: 'delegation_invalid',
      mode: row.mode,
      mpcAccount: row.public_key,
      delegationValidation: { ok: false, reason: 'Delegation is revoked, paused, or missing' },
      message: `Cannot execute ${input.protocolId} ${input.action}: delegation is revoked, paused, or missing`,
    });
    return { ok: false, error: 'No active delegation' };
  }

  const client = getKairosClient();
  const signer = await getAgentSigner(row);
  const delegation = deserializeDelegation(delegationJson);

  // Resolving the adapter and building the Execution can throw (no config for this protocol on
  // this network — e.g. mainnet's registry is intentionally unpopulated until real contract IDs
  // are sourced — or invalid request params). Nothing has been journaled or broadcast yet at
  // this point, so this is a plain, safe failure to report — not a crash-recovery scenario.
  let execution: ProtocolActionResult['execution'];
  let positionDelta: ProtocolActionResult['positionDelta'];
  let describe: ProtocolActionResult['describe'];
  try {
    const adapter = getAdapter(client, input.protocolId);
    const request = { ...input, owner: delegation.delegator } as ProtocolActionRequest;
    ({ execution, positionDelta, describe } = adapter.buildAction(request));
  } catch (error) {
    const message = mapThrownError(error);
    logEvent({
      agentId: row.id,
      owner: row.owner,
      eventType: 'trade_executed',
      mode: row.mode,
      mpcAccount: row.public_key,
      executionStatus: 'failed',
      message: `${input.protocolId} ${input.action} could not be built: ${message}`,
    });
    return { ok: false, error: message };
  }

  // Opened *before* submitting so a crash between on-chain confirmation and the local
  // position/audit write below is recoverable (see reconcilePendingProtocolExecutions,
  // run at startup) instead of the fill silently vanishing from local bookkeeping.
  const journal = openProtocolExecution({
    row,
    protocolId: input.protocolId,
    action: input.action,
    asset: positionDelta.asset,
    kind: positionDelta.kind,
    delta: positionDelta.delta,
  });

  try {
    const result = await client.execution.execute({
      redeemer: signer,
      delegationChains: [[delegation]],
      executions: [execution],
    });

    if (result.status !== 'SUCCESS') {
      const message = mapExecutionError(result);
      markProtocolExecutionFailed(journal.id, message);
      logEvent({
        agentId: row.id,
        owner: row.owner,
        eventType: 'trade_executed',
        mode: row.mode,
        mpcAccount: row.public_key,
        executionStatus: 'failed',
        message: `${input.protocolId} ${input.action} failed: ${message}`,
      });
      return { ok: false, error: message };
    }

    // The on-chain effect is already final at this point — everything from here is local
    // bookkeeping. markProtocolExecutionBroadcast captures the tx_hash first (so a crash before
    // the position delta applies still lets reconciliation find and replay this row), then
    // applyProtocolExecutionRecord applies the delta and closes the row atomically.
    markProtocolExecutionBroadcast(journal.id, result.hash);
    applyProtocolExecutionRecord(journal.id);

    logEvent({
      agentId: row.id,
      owner: row.owner,
      eventType: 'trade_executed',
      mode: row.mode,
      mpcAccount: row.public_key,
      executionStatus: 'success',
      txHash: result.hash,
      message: describe(result.hash),
    });

    return { ok: true, txHash: result.hash };
  } catch (error) {
    const message = mapThrownError(error);
    markProtocolExecutionFailed(journal.id, message);
    logEvent({
      agentId: row.id,
      owner: row.owner,
      eventType: 'trade_executed',
      mode: row.mode,
      mpcAccount: row.public_key,
      executionStatus: 'failed',
      message: `${input.protocolId} ${input.action} threw: ${message}`,
    });
    return { ok: false, error: message };
  }
}
