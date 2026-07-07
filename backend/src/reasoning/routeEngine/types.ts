// Types for the Route Engine (Phase 6.5 — inserted between the Execution Planner and the
// Execution Engine). Deterministic — no AI, no LLM, no blockchain call, no execution. Consumes a
// frozen ExecutionPlan + a ProtocolRegistry (both frozen layers) and produces an ExecutionRoute:
// the single best protocol to actually run a given action, chosen by comparing every capable
// adapter's quote/simulation deterministically. Never picks randomly and never submits a
// transaction — that remains the Execution Engine's job.
import type { HealthStatus, Quote, SimulationResult } from '../../protocolAdapters/types.js';

export const ROUTE_ENGINE_VERSION = '1.0.0';

/** The action vocabulary a route can be requested for. Distinct from `PrimaryAction`
 *  (decisionIntelligence) and from each protocol's own action enum (AquariusAction, BlendAction,
 *  ...) — this is the Route Engine's own, protocol-agnostic vocabulary, mapped onto each
 *  candidate adapter's action space during discovery (see `discovery.ts`). */
export const ROUTE_ACTIONS = ['SWAP', 'MULTI_HOP_SWAP', 'LENDING', 'BORROWING', 'DEPOSIT', 'WITHDRAW', 'REWARD_CLAIM'] as const;
export type RouteAction = (typeof ROUTE_ACTIONS)[number];

/** One request for a route. Deliberately generic (plain strings), matching the style of
 *  `AdapterActionRequest` — this module never depends on a specific protocol SDK. */
export interface RouteRequest {
  action: RouteAction;
  asset: string;
  /** Required for SWAP/MULTI_HOP_SWAP; ignored for lending/borrowing/deposit/withdraw/reward
   *  actions (those are single-asset). */
  outputAsset?: string;
  /** Required for MULTI_HOP_SWAP — the full hop path, asset[0] must equal `asset`. */
  path?: string[];
  amount: string;
  network: string;
  /** Passed through verbatim into each candidate adapter's AdapterActionRequest.params. */
  adapterParams?: Record<string, unknown>;
  /** Optional per-protocol liquidity signal (0-100, higher = deeper liquidity). The adapter
   *  framework has no first-class liquidity field, so callers that have one (an off-chain pool
   *  depth index, a price-impact curve, ...) can supply it here; candidates without an entry
   *  default to a neutral score (see `ranking.ts`). Purely a ranking input — never affects
   *  eligibility. */
  liquidityHints?: Record<string, number>;
}

export const ROUTE_REJECTION_REASONS = [
  'unsupported_action',
  'unsupported_asset',
  'unhealthy_protocol',
  'invalid_quote',
  'failed_simulation',
  'stale_quote',
  'duplicate_quote',
  'protocol_spoofing',
  'adapter_spoofing',
  'forged_quote',
  'manipulated_fee',
  'manipulated_slippage',
] as const;
export type RouteRejectionReason = (typeof ROUTE_REJECTION_REASONS)[number];

export interface RouteRejection {
  protocol: string;
  reason: RouteRejectionReason;
  message: string;
}

/** A normalized, comparable quote for one candidate protocol. Built either from the adapter's own
 *  `quote()` (swap-shaped protocols) or synthesized from `simulate()`/`estimateFees()`/
 *  `estimateSlippage()` for protocols with no meaningful quote (e.g. Blend lending) — so every
 *  action type is comparable on the same fields regardless of whether the underlying adapter
 *  implements `quote()`. */
export interface CandidateQuote {
  protocol: string;
  action: RouteAction;
  adapterAction: string;
  inputAsset: string;
  outputAsset: string;
  inputAmount: string;
  outputAmount: string;
  estimatedFees: string;
  estimatedSlippagePct: number;
  routeHops: string[];
  liquidityScore: number;
  source: 'adapter-quote' | 'simulation-derived';
  quoteHash: string;
  fetchedAt: number;
}

export interface RouteCandidate {
  protocol: string;
  health: HealthStatus;
  quote: CandidateQuote;
  simulation: SimulationResult;
  rawQuote: Quote | null;
  score: number;
  scoreBreakdown: {
    output: number;
    fees: number;
    slippage: number;
    liquidity: number;
    health: number;
    complexity: number;
  };
}

export interface RankedCandidate {
  protocol: string;
  rank: number;
  score: number;
  quote: CandidateQuote;
}

export interface ExecutionRouteMetadata {
  routeEngineVersion: string;
  requestHash: string;
  candidateCount: number;
  rejectedCount: number;
  timestamp: number;
}

/** Immutable, structured route decision. Never an execution instruction — a future Execution
 *  Engine step would consume `selectedProtocol` + `quote`/`simulation` to actually act, but this
 *  module never calls `adapter.execute()` itself. */
export interface ExecutionRoute {
  routeId: string;
  routeHash: string;
  request: RouteRequest;
  selectedProtocol: string | null;
  candidates: RouteCandidate[];
  ranking: RankedCandidate[];
  rejected: RouteRejection[];
  metadata: ExecutionRouteMetadata;
}

export interface RouteEngineOptions {
  now?: () => number;
  /** Quotes older than this are rejected as stale. Only meaningful when candidates are supplied
   *  via `precomputedQuotes` (see `routeEngine.ts`) — live-fetched quotes are always fresh
   *  relative to `now()`. Defaults to 30s. */
  quoteTtlMs?: number;
}
