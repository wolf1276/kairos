import { InvalidStateTransitionError, type RuntimeState } from './types.js';

// Allowed transitions. STARTING/STOPPING are transient states reached synchronously within
// start()/stop() — see runtime.ts — but are modeled explicitly so callers can observe them via
// heartbeat/logs and so invalid jumps (e.g. STOPPED -> RUNNING) are rejected deterministically.
const ALLOWED_TRANSITIONS: Record<RuntimeState, ReadonlyArray<RuntimeState>> = {
  STOPPED: ['STARTING'],
  STARTING: ['RUNNING', 'STOPPING'],
  RUNNING: ['PAUSED', 'STOPPING'],
  PAUSED: ['RUNNING', 'STOPPING'],
  STOPPING: ['STOPPED'],
};

export function assertValidTransition(from: RuntimeState, to: RuntimeState): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new InvalidStateTransitionError(from, to);
  }
}

export function canTransition(from: RuntimeState, to: RuntimeState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
