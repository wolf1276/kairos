// StrategyRegistry: the single point through which the Strategy Engine's caller reaches a
// strategy. Same shape/conventions as protocolAdapters/registry.ts (fail-closed, no silent
// duplicate/malformed acceptance) — deliberately mirrored so this reads as "the same kind of
// thing" to anyone already familiar with the Protocol Layer, without importing anything from it.
import { validateStrategySignal } from './validation.js';
import { DuplicateStrategyError, MalformedStrategyError, StrategyNotFoundError, StrategySignalValidationError } from './types.js';
import type { Strategy, StrategyInput, StrategySignal } from './types.js';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateStrategyShape(strategy: Strategy): string[] {
  const errors: string[] = [];
  if (!strategy || typeof strategy !== 'object') return ['strategy must be a non-null object'];
  if (!isNonEmptyString(strategy.id)) errors.push('strategy.id must be a non-empty string');
  if (!isNonEmptyString(strategy.version)) errors.push('strategy.version must be a non-empty string');
  if (typeof strategy.evaluate !== 'function') errors.push('strategy.evaluate must be a function');
  return errors;
}

export class StrategyRegistry {
  private readonly strategies = new Map<string, Strategy>();

  /** Registers a strategy after validating its shape — throws `MalformedStrategyError` on a
   *  structurally-broken strategy, `DuplicateStrategyError` on an id collision. Adding a new
   *  strategy to the system is exactly this one call: build a `Strategy`, register it. */
  register(strategy: Strategy): void {
    const errors = validateStrategyShape(strategy);
    if (errors.length > 0) throw new MalformedStrategyError(errors);
    if (this.strategies.has(strategy.id)) throw new DuplicateStrategyError(strategy.id);
    this.strategies.set(strategy.id, strategy);
  }

  unregister(strategyId: string): void {
    this.strategies.delete(strategyId);
  }

  get(strategyId: string): Strategy {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) throw new StrategyNotFoundError(strategyId);
    return strategy;
  }

  has(strategyId: string): boolean {
    return this.strategies.has(strategyId);
  }

  list(): Strategy[] {
    return [...this.strategies.values()];
  }

  /** Runs one strategy and fail-closed-validates its output — never lets a malformed
   *  StrategySignal (e.g. NaN confidence from a strategy's own unguarded division) escape this
   *  boundary. */
  evaluateOne(strategyId: string, input: StrategyInput): StrategySignal {
    const strategy = this.get(strategyId);
    const signal = strategy.evaluate(input);
    const errors = validateStrategySignal(signal);
    if (errors.length > 0) throw new StrategySignalValidationError(strategyId, errors);
    return signal;
  }

  /** Runs every registered strategy against the same input. Each strategy is a pure function
   *  with no shared mutable state, so this is safe to run concurrently (Promise.all over
   *  synchronous work still executes each evaluate() to completion before the next microtask,
   *  and — more importantly — no strategy reads or writes anything outside its own `input`
   *  argument, so concurrent callers evaluating *different* inputs against the same registry
   *  never interfere with each other either). One strategy throwing does not stop the others —
   *  callers get every signal that succeeded plus which ids failed and why, since Decision
   *  Intelligence should still see the signals that *did* compute even if one strategy errored
   *  on this particular input (e.g. a division-by-zero guard rejecting a zero-price snapshot). */
  evaluateAll(input: StrategyInput): { signals: StrategySignal[]; failures: { strategyId: string; error: string }[] } {
    const signals: StrategySignal[] = [];
    const failures: { strategyId: string; error: string }[] = [];
    for (const strategy of this.list()) {
      try {
        signals.push(this.evaluateOne(strategy.id, input));
      } catch (error) {
        failures.push({ strategyId: strategy.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { signals, failures };
  }
}
