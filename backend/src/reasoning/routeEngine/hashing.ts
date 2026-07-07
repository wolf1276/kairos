// Deterministic hashing for the Route Engine. Same technique as every other layer in this
// codebase: SHA-256 over a canonical, key-sorted JSON string (see `../hashing.ts`). Timestamps
// (`fetchedAt`, `metadata.timestamp`) are always excluded before hashing so identical inputs
// always produce identical hashes regardless of wall-clock time.
import { sha256 } from '../hashing.js';
import type { CandidateQuote, ExecutionRoute, RankedCandidate, RouteRequest } from './types.js';

/** Recomputes a candidate quote's hash the same way every protocol adapter computes its own
 *  `quoteHash` (`sha256(quote-without-hash-field)`) — used by the Route Engine to independently
 *  verify a live-fetched adapter Quote was not forged/tampered before it's trusted for ranking. */
export function hashCandidateQuoteFields(fields: Omit<CandidateQuote, 'quoteHash' | 'fetchedAt'>): string {
  return sha256(fields);
}

export function hashRouteRequest(request: RouteRequest): string {
  return sha256(request);
}

/** Hashes the deterministic content of an ExecutionRoute — excludes `routeId` (a fresh UUID per
 *  call) and `metadata.timestamp` (wall clock), so replaying the same request against the same
 *  candidate set always produces the same `routeHash`. */
export function hashExecutionRoute(route: Omit<ExecutionRoute, 'routeHash' | 'routeId'>): string {
  const { metadata, ...rest } = route;
  const { timestamp: _timestamp, ...metadataForHash } = metadata;
  return sha256({ ...rest, metadata: metadataForHash });
}

export function hashRanking(ranking: RankedCandidate[]): string {
  return sha256(ranking);
}
