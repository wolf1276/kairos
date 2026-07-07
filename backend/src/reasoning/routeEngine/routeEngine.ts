// The Route Engine's orchestration entry point. Deterministic — no AI, no LLM, no blockchain
// execution. Discovers every protocol capable of the requested action (`discovery.ts`), fetches
// and validates a comparable quote from each (`quoting.ts`), ranks the survivors (`ranking.ts`),
// and returns a single ExecutionRoute. Identical inputs (same request, same registry state)
// always produce an identical `routeHash`.
import { randomUUID } from 'crypto';
import type { ProtocolRegistry } from '../../protocolAdapters/registry.js';
import { discoverCandidates } from './discovery.js';
import { hashExecutionRoute, hashRouteRequest } from './hashing.js';
import { rankCandidates, scoreCandidateQuote } from './ranking.js';
import { checkDuplicate } from './rules.js';
import { evaluateCandidate } from './quoting.js';
import { ROUTE_ENGINE_VERSION } from './types.js';
import type { ExecutionRoute, RouteCandidate, RouteEngineOptions, RouteRejection, RouteRequest } from './types.js';

export class RouteRequestValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`Route request rejected: ${errors.join('; ')}`);
    this.name = 'RouteRequestValidationError';
    this.errors = errors;
  }
}

function validateRequestShape(request: RouteRequest): string[] {
  const errors: string[] = [];
  if (!request.asset || typeof request.asset !== 'string') errors.push('request.asset must be a non-empty string');
  if (!request.network || typeof request.network !== 'string') errors.push('request.network must be a non-empty string');
  if (!request.amount || Number.isNaN(Number(request.amount)) || Number(request.amount) <= 0) errors.push('request.amount must be a positive decimal string');
  if (request.action === 'MULTI_HOP_SWAP') {
    if (!request.path || request.path.length < 2) errors.push('request.path is required (min 2 assets) for MULTI_HOP_SWAP');
    else if (request.path[0] !== request.asset) errors.push('request.path[0] must equal request.asset');
  }
  if ((request.action === 'SWAP' || request.action === 'MULTI_HOP_SWAP') && !request.outputAsset) {
    errors.push('request.outputAsset is required for SWAP/MULTI_HOP_SWAP');
  }
  return errors;
}

/**
 * Computes the single best deterministic route for one RouteRequest against every protocol
 * registered in `registry`. Never throws on a candidate-level problem (unhealthy protocol, failed
 * simulation, forged quote, ...) — those are recorded in `ExecutionRoute.rejected` instead, so a
 * caller always gets back a structured result. Only a malformed request itself throws.
 */
export async function computeRoute(request: RouteRequest, registry: ProtocolRegistry, options: RouteEngineOptions = {}): Promise<ExecutionRoute> {
  const now = options.now ?? Date.now;
  const shapeErrors = validateRequestShape(request);
  if (shapeErrors.length > 0) throw new RouteRequestValidationError(shapeErrors);

  const discovered = discoverCandidates(request, registry);
  const rejected: RouteRejection[] = [];
  const candidates: RouteCandidate[] = [];
  const seen = new Set<string>();

  const outcomes = await Promise.all(discovered.map((candidate) => evaluateCandidate(candidate, request, options)));

  for (let i = 0; i < discovered.length; i++) {
    const protocol = discovered[i].protocol;
    const duplicateRejection = checkDuplicate(protocol, seen);
    if (duplicateRejection) {
      rejected.push(duplicateRejection);
      continue;
    }
    seen.add(protocol);

    const outcome = outcomes[i];
    if ('reason' in outcome) {
      rejected.push(outcome);
      continue;
    }

    const scoreBreakdown = scoreCandidateQuote(outcome.quote, outcome.health);
    candidates.push({
      protocol,
      health: outcome.health,
      quote: outcome.quote,
      simulation: outcome.simulation,
      rawQuote: outcome.rawQuote,
      score: scoreBreakdown.total,
      scoreBreakdown: {
        output: scoreBreakdown.output,
        fees: scoreBreakdown.fees,
        slippage: scoreBreakdown.slippage,
        liquidity: scoreBreakdown.liquidity,
        health: scoreBreakdown.health,
        complexity: scoreBreakdown.complexity,
      },
    });
  }

  const ranking = rankCandidates(candidates);
  const selectedProtocol = ranking.length > 0 ? ranking[0].protocol : null;

  const routeWithoutHash: Omit<ExecutionRoute, 'routeHash' | 'routeId'> = {
    request,
    selectedProtocol,
    candidates,
    ranking,
    rejected,
    metadata: {
      routeEngineVersion: ROUTE_ENGINE_VERSION,
      requestHash: hashRouteRequest(request),
      candidateCount: candidates.length,
      rejectedCount: rejected.length,
      timestamp: now(),
    },
  };

  return {
    routeId: randomUUID(),
    routeHash: hashExecutionRoute(routeWithoutHash),
    ...routeWithoutHash,
  };
}
