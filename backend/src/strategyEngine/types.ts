// Types for the Strategy Engine. A new, standalone layer — never imported by, and never
// importing internals of, the Context/Memory/Reasoning/Decision Intelligence/Verification/
// Execution Planner/Route/Execution/Outcome Recorder/Memory Writer/Learning/Protocol/Provider
// layers. Every field a strategy reads comes straight off the frozen Context Engine's own
// `FeatureSet` (see `../agentContext/types.js`) — this module never recomputes an indicator,
// never calls an oracle, never touches the network or a database.
import type { FeatureSet } from '../agentContext/types.js';

export const STRATEGY_ENGINE_VERSION = '1.0.0';

export const STRATEGY_SIGNAL_ACTIONS = ['BUY', 'SELL', 'HOLD'] as const;
export type StrategySignalAction = (typeof STRATEGY_SIGNAL_ACTIONS)[number];

export const STRATEGY_RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type StrategyRiskLevel = (typeof STRATEGY_RISK_LEVELS)[number];

/** Everything a strategy is allowed to read. Deliberately narrow and entirely derived from data
 *  the frozen Context Engine already computed — a strategy never fetches its own market data. */
export interface StrategyInput {
  agentId: string;
  pair: string;
  timestamp: number;
  features: FeatureSet;
  allowedAssets: string[];
  allowedProtocols: string[];
}

/** Normalized output every strategy must produce, regardless of what kind of strategy it is
 *  (technical-indicator, DCA, rebalancing, yield, stablecoin defense, ...). This is the one
 *  contract Decision Intelligence is meant to evaluate against — the LLM receives these signals
 *  as evidence, it does not invent them. */
export interface StrategySignal {
  strategyId: string;
  signal: StrategySignalAction;
  /** 0-1, always clamped — never fabricated as exactly 0 or 1 by a caller merely omitting it. */
  confidence: number;
  /** Short, human/LLM-readable justification — deterministic (built from the same inputs the
   *  signal was computed from), never a template placeholder. */
  reasoning: string;
  /** Names of the FeatureSet fields this strategy actually read (e.g. ["trend.ema20",
   *  "trend.ema50"]) — lets a caller (or a test) verify a strategy only used what it claims to. */
  indicatorsUsed: string[];
  entry: number | null;
  exit: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  risk: StrategyRiskLevel;
  metadata: Record<string, unknown>;
}

/** A strategy is a pure function of `StrategyInput` — no I/O, no randomness, no wall-clock reads
 *  beyond `input.timestamp` (already supplied), so the same input always produces the same
 *  `StrategySignal` (deterministic, replay-safe, thread-safe: no shared mutable state). */
export interface Strategy {
  readonly id: string;
  readonly version: string;
  evaluate(input: StrategyInput): StrategySignal;
}

export class StrategySignalValidationError extends Error {
  readonly errors: string[];
  constructor(strategyId: string, errors: string[]) {
    super(`Strategy '${strategyId}' produced an invalid StrategySignal: ${errors.join('; ')}`);
    this.name = 'StrategySignalValidationError';
    this.errors = errors;
  }
}

export class DuplicateStrategyError extends Error {
  constructor(strategyId: string) {
    super(`A strategy is already registered for id '${strategyId}' — unregister it first.`);
    this.name = 'DuplicateStrategyError';
  }
}

export class StrategyNotFoundError extends Error {
  constructor(strategyId: string) {
    super(`No strategy is registered for id '${strategyId}'.`);
    this.name = 'StrategyNotFoundError';
  }
}

export class MalformedStrategyError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`Strategy registration rejected: ${errors.join('; ')}`);
    this.name = 'MalformedStrategyError';
    this.errors = errors;
  }
}
