// Quoting: for one discovered candidate protocol, calls its adapter (health/validate/simulate/
// quote) and normalizes the result into a comparable CandidateQuote, or returns a RouteRejection
// if any routing rule fails. The only place in the Route Engine that performs adapter I/O —
// everything downstream (`ranking.ts`) is pure.
import type { AdapterActionRequest, Quote } from '../../protocolAdapters/types.js';
import { hashCandidateQuoteFields } from './hashing.js';
import {
  checkAdapterSpoofing,
  checkForgedQuote,
  checkHealth,
  checkManipulatedFee,
  checkManipulatedSlippage,
  checkProtocolSpoofing,
  checkQuoteFreshness,
  checkSimulation,
  checkValidation,
} from './rules.js';
import type { DiscoveredCandidate } from './discovery.js';
import type { CandidateQuote, RouteEngineOptions, RouteRejection, RouteRequest } from './types.js';

function buildAdapterRequest(request: RouteRequest, adapterAction: string): AdapterActionRequest {
  const params: Record<string, unknown> = { ...(request.adapterParams ?? {}) };
  if (request.outputAsset) params.outputAsset = request.outputAsset;
  if (request.path) params.path = request.path;
  return {
    action: adapterAction,
    asset: request.asset,
    network: request.network,
    amount: request.amount,
    params,
  };
}

function liquidityScoreFor(protocol: string, quote: Quote | null, request: RouteRequest): number {
  const hint = request.liquidityHints?.[protocol];
  if (hint !== undefined) return hint;
  if (quote) return Math.max(0, Math.min(100, 100 - quote.priceImpactPct * 10));
  return 50; // neutral default — no quote-derived liquidity signal available (e.g. lending/reward actions)
}

export interface QuoteOutcome {
  candidate: DiscoveredCandidate;
  quote: CandidateQuote;
  rawQuote: Quote | null;
  simulation: Awaited<ReturnType<DiscoveredCandidate['adapter']['simulate']>>;
  health: Awaited<ReturnType<DiscoveredCandidate['adapter']['health']>>;
}

export async function evaluateCandidate(candidate: DiscoveredCandidate, request: RouteRequest, options: RouteEngineOptions): Promise<QuoteOutcome | RouteRejection> {
  const now = options.now ?? Date.now;
  const ttlMs = options.quoteTtlMs ?? 30_000;
  const { protocol, adapter, metadata, adapterAction } = candidate;

  const spoofRejection = checkAdapterSpoofing(protocol, metadata);
  if (spoofRejection) return spoofRejection;

  const health = await adapter.health();
  const healthRejection = checkHealth(protocol, health);
  if (healthRejection) return healthRejection;

  const adapterRequest = buildAdapterRequest(request, adapterAction);

  const validation = await adapter.validate(adapterRequest);
  const validationRejection = checkValidation(protocol, validation);
  if (validationRejection) return validationRejection;

  const simulation = await adapter.simulate(adapterRequest);
  const simulationRejection = checkSimulation(protocol, simulation);
  if (simulationRejection) return simulationRejection;

  let rawQuote: Quote | null = null;
  if (adapter.quote) {
    rawQuote = await adapter.quote(adapterRequest);
    const protocolSpoofRejection = checkProtocolSpoofing(protocol, rawQuote);
    if (protocolSpoofRejection) return protocolSpoofRejection;
    const forgedRejection = checkForgedQuote(protocol, rawQuote);
    if (forgedRejection) return forgedRejection;
  }

  const fetchedAt = now();
  const freshnessRejection = checkQuoteFreshness(protocol, fetchedAt, now(), ttlMs);
  if (freshnessRejection) return freshnessRejection;

  const outputAsset = request.outputAsset ?? request.asset;
  const outputAmount = rawQuote?.outputAmount ?? simulation.estimatedOutputs[outputAsset] ?? simulation.estimatedOutputs[request.asset] ?? request.amount;
  const estimatedFees = rawQuote?.estimatedFees ?? simulation.estimatedFees;
  const estimatedSlippagePct = simulation.estimatedSlippagePct;
  const routeHops = rawQuote?.route ?? [request.asset, outputAsset];

  const feeRejection = checkManipulatedFee(protocol, estimatedFees);
  if (feeRejection) return feeRejection;
  const slippageRejection = checkManipulatedSlippage(protocol, estimatedSlippagePct);
  if (slippageRejection) return slippageRejection;

  const quoteFields = {
    protocol,
    action: request.action,
    adapterAction,
    inputAsset: request.asset,
    outputAsset,
    inputAmount: request.amount,
    outputAmount,
    estimatedFees,
    estimatedSlippagePct,
    routeHops,
    liquidityScore: liquidityScoreFor(protocol, rawQuote, request),
    source: (rawQuote ? 'adapter-quote' : 'simulation-derived') as CandidateQuote['source'],
  };

  const quote: CandidateQuote = {
    ...quoteFields,
    quoteHash: hashCandidateQuoteFields(quoteFields),
    fetchedAt,
  };

  return { candidate, quote, rawQuote, simulation, health };
}
