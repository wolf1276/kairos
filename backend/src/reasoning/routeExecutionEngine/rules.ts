// Execution rules: pure, synchronous predicate/shape-check functions. Kept separate from
// `engine.ts` (which does the async adapter I/O) so every rule is independently unit-testable,
// matching the pattern used by `routeEngine/rules.ts` and `verification/rules/*.ts`. Fail-closed
// throughout: a malformed or unverifiable value is always rejected, never passed through.
import { recomputeTransactionHash } from './hashing.js';
import type { TransactionBuilder, SimulationResult } from '../../protocolAdapters/types.js';
import type { ExecutionRoute } from '../routeEngine/types.js';
import type { ExecutionFailureReason } from './types.js';

export interface RuleFailure {
  reason: ExecutionFailureReason;
  message: string;
}

function fail(reason: ExecutionFailureReason, message: string): RuleFailure {
  return { reason, message };
}

export function checkRouteSelected(route: ExecutionRoute): RuleFailure | null {
  if (!route.selectedProtocol) return fail('no_route_selected', 'ExecutionRoute has no selectedProtocol — nothing to execute');
  return null;
}

/** Replay-attack protection: an ExecutionRoute is a snapshot of live protocol state (quotes,
 *  health, ranking) at the moment the Route Engine computed it. Reusing a stale route indefinitely
 *  would let a caller execute against quotes/health that no longer hold — the same "stale quote"
 *  bug class the Route Engine itself guards against, one layer up. */
export function checkRouteFreshness(route: ExecutionRoute, now: number, ttlMs: number): RuleFailure | null {
  if (now - route.metadata.timestamp > ttlMs) {
    return fail('stale_route', `ExecutionRoute is stale (computed ${now - route.metadata.timestamp}ms ago, ttl ${ttlMs}ms) — recompute the route before executing`);
  }
  return null;
}

/** RPC/adapter-substitution protection: the adapter resolved from the registry for
 *  `route.selectedProtocol` must actually self-identify as that protocol. Defense in depth — the
 *  registry already enforces this at registration time (see `protocolAdapters/registry.ts`), this
 *  is an independent re-check at the point of use. */
export function checkAdapterIdentity(expectedProtocol: string, adapterProtocol: string): RuleFailure | null {
  if (adapterProtocol !== expectedProtocol) {
    return fail('adapter_spoofing', `resolved adapter self-identifies as '${adapterProtocol}' but the route selected '${expectedProtocol}'`);
  }
  return null;
}

export function checkTransactionWellFormed(tx: unknown): RuleFailure | null {
  if (!tx || typeof tx !== 'object') return fail('malformed_transaction', 'buildTransaction() returned a non-object');
  const t = tx as Partial<TransactionBuilder>;
  for (const field of ['protocol', 'action', 'network', 'contractId', 'method', 'transactionHash'] as const) {
    if (typeof t[field] !== 'string' || t[field]!.length === 0) return fail('malformed_transaction', `buildTransaction() result missing/empty required string field '${field}'`);
  }
  if (!t.args || typeof t.args !== 'object' || Array.isArray(t.args)) return fail('malformed_transaction', "buildTransaction() result's 'args' must be a plain object");
  return null;
}

/** Recomputes the transaction's hash the same way every protocol adapter computes its own
 *  `hashTransaction` and rejects on mismatch — catches a `TransactionBuilder` forged or tampered
 *  with after `buildTransaction()` produced it (the "forged transaction" / "modified XDR" attack
 *  surface: since `transactionXDR` is always engine-derived from this same object, an integrity
 *  failure here blocks XDR forgery too). */
export function checkTransactionIntegrity(tx: TransactionBuilder): RuleFailure | null {
  const { transactionHash, ...rest } = tx;
  const recomputed = recomputeTransactionHash(rest);
  if (recomputed !== transactionHash) {
    return fail('forged_transaction', `transactionHash does not match its content — the built transaction may have been forged or tampered with`);
  }
  return null;
}

export function checkSimulationWellFormed(sim: unknown): RuleFailure | null {
  if (!sim || typeof sim !== 'object') return fail('malformed_simulation', 'simulate() returned a non-object — possible malformed RPC response');
  const s = sim as Partial<SimulationResult>;
  if (typeof s.success !== 'boolean') return fail('malformed_simulation', "simulate() result's 'success' must be a boolean");
  if (typeof s.estimatedFees !== 'string' || !Number.isFinite(Number(s.estimatedFees)) || Number(s.estimatedFees) < 0) return fail('malformed_simulation', "simulate() result's 'estimatedFees' must be a non-negative numeric string");
  if (typeof s.estimatedSlippagePct !== 'number' || !Number.isFinite(s.estimatedSlippagePct)) return fail('malformed_simulation', "simulate() result's 'estimatedSlippagePct' must be a finite number");
  if (!Array.isArray(s.warnings) || !Array.isArray(s.errors)) return fail('malformed_simulation', "simulate() result's 'warnings'/'errors' must be arrays");
  if (!s.estimatedOutputs || typeof s.estimatedOutputs !== 'object' || Array.isArray(s.estimatedOutputs)) return fail('malformed_simulation', "simulate() result's 'estimatedOutputs' must be a plain object — possible malformed RPC response");
  return null;
}

export function checkSimulationSuccess(sim: SimulationResult): RuleFailure | null {
  if (!sim.success) return fail('simulation_failed', `simulation failed: ${sim.errors.join('; ') || 'no error detail provided'}`);
  return null;
}

export function checkValidationOk(ok: boolean, errors: string[]): RuleFailure | null {
  if (!ok) return fail('validation_failed', `adapter rejected the request: ${errors.join('; ')}`);
  return null;
}

export function checkFeeEstimate(fee: unknown): RuleFailure | null {
  if (typeof fee !== 'string' || !Number.isFinite(Number(fee)) || Number(fee) < 0) {
    return fail('malformed_fee_estimate', `estimateFees() must return a non-negative numeric string, got '${String(fee)}'`);
  }
  return null;
}

/** Shape-checks a real `RealTransactionProvider`'s success payload — a malformed real-integration
 *  response (missing XDR, non-string XDR, malformed resource fields) is rejected here rather than
 *  silently propagated as a well-formed `ExecutionResult`. */
export function checkRealTransactionDetail(unsignedXdr: unknown, resourceEstimate: unknown): RuleFailure | null {
  if (typeof unsignedXdr !== 'string' || unsignedXdr.length === 0) {
    return fail('malformed_xdr', 'real transaction provider returned an empty/non-string unsignedXdr');
  }
  if (!resourceEstimate || typeof resourceEstimate !== 'object') {
    return fail('malformed_xdr', 'real transaction provider returned a non-object resourceEstimate');
  }
  const r = resourceEstimate as Record<string, unknown>;
  for (const field of ['cpuInstructions', 'diskReadBytes', 'writeBytes'] as const) {
    if (typeof r[field] !== 'number' || !Number.isFinite(r[field] as number) || (r[field] as number) < 0) {
      return fail('malformed_xdr', `real transaction provider's resourceEstimate.${field} must be a non-negative finite number`);
    }
  }
  if (typeof r.resourceFeeStroops !== 'string' || !Number.isFinite(Number(r.resourceFeeStroops)) || Number(r.resourceFeeStroops) < 0) {
    return fail('malformed_xdr', "real transaction provider's resourceEstimate.resourceFeeStroops must be a non-negative numeric string");
  }
  return null;
}
