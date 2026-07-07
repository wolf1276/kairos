// Shared, dependency-free helpers used by every strategy — kept local to this engine rather
// than imported from Reasoning/Verification/etc. (same "don't depend on another phase's
// internals" discipline used throughout this codebase, e.g. learningEngine/engine.ts's own
// deepFreeze), even though the underlying technique (clamp, deterministic hash) is generic.
import { createHash } from 'crypto';
import { stableStringify } from '../stableStringify.js';

/** Clamps to [0, 1] and never returns NaN/Infinity — a strategy computing confidence from a
 *  ratio that happens to divide by zero or overshoot must never leak a non-finite or
 *  out-of-range value into a StrategySignal. */
export function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function sha256(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

/** Deterministic hash over a StrategySignal — lets a caller/test verify two evaluations of the
 *  same StrategyInput produced byte-for-byte identical output (replay compatibility) without a
 *  deep-equality diff. */
export function hashStrategySignal(signal: unknown): string {
  return sha256(signal);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isFiniteOrNull(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}
