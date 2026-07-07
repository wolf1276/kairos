// Deterministic hashing for the Route Engine. Same technique as every other layer in this
// codebase: SHA-256 over a canonical, key-sorted JSON string (see `../hashing.ts`). Timestamps
// (`fetchedAt`, `metadata.timestamp`) are always excluded before hashing so identical inputs
// always produce identical hashes regardless of wall-clock time.
import { sha256 } from '../hashing.js';
import type { CandidateQuote, ExecutionRoute, RankedCandidate, RouteCandidate, RouteRequest } from './types.js';

/** Strips `fetchedAt` (wall-clock) from a CandidateQuote before it enters a hash — every other
 *  field is content, `fetchedAt` is not. */
function quoteForHash(quote: CandidateQuote): Omit<CandidateQuote, 'fetchedAt'> {
  const { fetchedAt: _fetchedAt, ...rest } = quote;
  return rest;
}

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
  const { metadata, candidates, ranking, ...rest } = route;
  const { timestamp: _timestamp, ...metadataForHash } = metadata;
  const candidatesForHash = candidates.map((c: RouteCandidate) => ({ ...c, quote: quoteForHash(c.quote) }));
  const rankingForHash = ranking.map((r: RankedCandidate) => ({ ...r, quote: quoteForHash(r.quote) }));
  return sha256({ ...rest, candidates: candidatesForHash, ranking: rankingForHash, metadata: metadataForHash });
}

export function hashRanking(ranking: RankedCandidate[]): string {
  return sha256(ranking);
}
