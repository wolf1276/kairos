// Retry helper: retries a thrown exception (a transient/RPC-unavailable failure) up to
// `maxAttempts` times. Never retries a *structured* failure (a function that resolves normally
// with e.g. `{ success: false }`) — only a thrown error is transient by this definition; a
// protocol adapter's considered "no" is retried by `checkSimulationSuccess`/`checkValidationOk`
// exactly zero times, by design (see `types.ts: RetryPolicy`).
export interface RetryOutcome<T> {
  ok: true;
  value: T;
  attempts: number;
}

export interface RetryFailure {
  ok: false;
  error: string;
  attempts: number;
}

export async function withRetry<T>(fn: () => Promise<T>, maxAttempts: number): Promise<RetryOutcome<T> | RetryFailure> {
  let lastError = 'unknown error';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const value = await fn();
      return { ok: true, value, attempts: attempt };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return { ok: false, error: lastError, attempts: maxAttempts };
}
