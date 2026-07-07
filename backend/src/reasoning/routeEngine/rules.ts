// Routing rules: pure, synchronous predicate functions that decide whether a candidate protocol
// is rejected. Kept separate from `quoting.ts` (which does the async adapter I/O) so every rule
// is independently unit-testable against hand-built fixtures, matching the pattern used by
// `reasoning/verification/rules/*.ts`.
import { sha256 } from '../hashing.js';
import type { HealthStatus, Quote, SimulationResult, ValidationResult } from '../../protocolAdapters/types.js';
import type { ProtocolMetadata } from '../../protocolAdapters/types.js';
import type { RouteRejection, RouteRejectionReason } from './types.js';

function reject(protocol: string, reason: RouteRejectionReason, message: string): RouteRejection {
  return { protocol, reason, message };
}

export function checkHealth(protocol: string, health: HealthStatus): RouteRejection | null {
  if (health === 'UNAVAILABLE' || health === 'UNKNOWN') {
    return reject(protocol, 'unhealthy_protocol', `protocol '${protocol}' is unhealthy (health: ${health})`);
  }
  return null;
}

export function checkValidation(protocol: string, validation: ValidationResult): RouteRejection | null {
  if (!validation.ok) {
    return reject(protocol, 'invalid_quote', `protocol '${protocol}' rejected the request: ${validation.errors.join('; ')}`);
  }
  return null;
}

export function checkSimulation(protocol: string, simulation: SimulationResult): RouteRejection | null {
  if (!simulation.success) {
    return reject(protocol, 'failed_simulation', `simulation failed for protocol '${protocol}': ${simulation.errors.join('; ')}`);
  }
  return null;
}

export function checkQuoteFreshness(protocol: string, fetchedAt: number, now: number, ttlMs: number): RouteRejection | null {
  if (now - fetchedAt > ttlMs) {
    return reject(protocol, 'stale_quote', `quote for protocol '${protocol}' is stale (fetched ${now - fetchedAt}ms ago, ttl ${ttlMs}ms)`);
  }
  return null;
}

export function checkAdapterSpoofing(protocol: string, metadata: ProtocolMetadata): RouteRejection | null {
  if (metadata.capabilities.protocol !== protocol) {
    return reject(protocol, 'adapter_spoofing', `adapter registered for '${protocol}' declares capabilities for '${metadata.capabilities.protocol}'`);
  }
  return null;
}

export function checkProtocolSpoofing(protocol: string, quote: Quote | null): RouteRejection | null {
  if (quote && quote.protocol !== protocol) {
    return reject(protocol, 'protocol_spoofing', `quote claims protocol '${quote.protocol}' but was returned by '${protocol}'s adapter`);
  }
  return null;
}

/** Recomputes an adapter Quote's hash the same way every protocol's own `hashQuote` does
 *  (`sha256(quote-without-quoteHash)`) and rejects if it doesn't match — catches a quote whose
 *  fields were tampered with after being produced by the adapter. */
export function checkForgedQuote(protocol: string, quote: Quote | null): RouteRejection | null {
  if (!quote) return null;
  const { quoteHash, ...rest } = quote;
  const recomputed = sha256(rest);
  if (recomputed !== quoteHash) {
    return reject(protocol, 'forged_quote', `quote hash for protocol '${protocol}' does not match its content — quoteHash may have been forged or the quote tampered with`);
  }
  return null;
}

export function checkManipulatedFee(protocol: string, estimatedFees: string): RouteRejection | null {
  const value = Number(estimatedFees);
  if (!Number.isFinite(value) || value < 0) {
    return reject(protocol, 'manipulated_fee', `estimatedFees '${estimatedFees}' for protocol '${protocol}' is not a valid non-negative amount`);
  }
  return null;
}

export function checkManipulatedSlippage(protocol: string, estimatedSlippagePct: number): RouteRejection | null {
  if (!Number.isFinite(estimatedSlippagePct) || estimatedSlippagePct < 0 || estimatedSlippagePct > 100) {
    return reject(protocol, 'manipulated_slippage', `estimatedSlippagePct '${estimatedSlippagePct}' for protocol '${protocol}' is out of the valid 0-100 range`);
  }
  return null;
}

export function checkUnsupportedAsset(protocol: string, asset: string, supportedAssets: string[]): RouteRejection | null {
  if (!supportedAssets.includes(asset)) {
    return reject(protocol, 'unsupported_asset', `asset '${asset}' is not supported by protocol '${protocol}'`);
  }
  return null;
}

export function checkUnsupportedAction(protocol: string, adapterAction: string, supportedActions: string[]): RouteRejection | null {
  if (!supportedActions.includes(adapterAction)) {
    return reject(protocol, 'unsupported_action', `action '${adapterAction}' is not supported by protocol '${protocol}'`);
  }
  return null;
}

export function checkDuplicate(protocol: string, seen: Set<string>): RouteRejection | null {
  if (seen.has(protocol)) {
    return reject(protocol, 'duplicate_quote', `protocol '${protocol}' produced more than one candidate quote for the same request`);
  }
  return null;
}
