// Fail-closed shape validation for a StrategySignal — same contract/style as
// protocolAdapters/registry.ts's adapter validation and reasoning/decisionIntelligence's own
// validation: never coerce, only accept or reject with a list of reasons. Runs both at
// registration time (catches a structurally-broken Strategy immediately) and after every
// evaluate() call (catches a strategy that returns something malformed for a *particular*
// input, e.g. NaN from a division by zero it didn't guard).
import { STRATEGY_RISK_LEVELS, STRATEGY_SIGNAL_ACTIONS } from './types.js';
import type { StrategySignal } from './types.js';

const VALID_ACTIONS = new Set<string>(STRATEGY_SIGNAL_ACTIONS);
const VALID_RISK_LEVELS = new Set<string>(STRATEGY_RISK_LEVELS);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteOrNull(value: unknown): boolean {
  return value === null || isFiniteNumber(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** Validates a StrategySignal's own shape — never checks it against a strategy's declared id
 *  (that's the registry's job, since only the registry knows which id is calling). */
export function validateStrategySignal(signal: unknown): string[] {
  const errors: string[] = [];
  if (!signal || typeof signal !== 'object') return ['StrategySignal must be a non-null object'];
  const s = signal as Record<string, unknown>;

  if (!isNonEmptyString(s.strategyId)) errors.push('strategyId must be a non-empty string');
  if (!VALID_ACTIONS.has(s.signal as string)) errors.push(`signal must be one of ${STRATEGY_SIGNAL_ACTIONS.join(', ')}`);
  if (!isFiniteNumber(s.confidence) || (s.confidence as number) < 0 || (s.confidence as number) > 1) {
    errors.push('confidence must be a finite number in [0, 1]');
  }
  if (!isNonEmptyString(s.reasoning)) errors.push('reasoning must be a non-empty string');
  if (!isStringArray(s.indicatorsUsed) || (s.indicatorsUsed as string[]).length === 0) {
    errors.push('indicatorsUsed must be a non-empty array of strings');
  }
  if (!isFiniteOrNull(s.entry)) errors.push('entry must be a finite number or null');
  if (!isFiniteOrNull(s.exit)) errors.push('exit must be a finite number or null');
  if (!isFiniteOrNull(s.stopLoss)) errors.push('stopLoss must be a finite number or null');
  if (!isFiniteOrNull(s.takeProfit)) errors.push('takeProfit must be a finite number or null');
  if (!VALID_RISK_LEVELS.has(s.risk as string)) errors.push(`risk must be one of ${STRATEGY_RISK_LEVELS.join(', ')}`);
  if (!s.metadata || typeof s.metadata !== 'object' || Array.isArray(s.metadata)) {
    errors.push('metadata must be a plain object');
  }

  return errors;
}

export function assertValidStrategySignal(signal: unknown): asserts signal is StrategySignal {
  const errors = validateStrategySignal(signal);
  if (errors.length > 0) throw new Error(errors.join('; '));
}
