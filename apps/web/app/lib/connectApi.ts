// Thin HTTP client for the onboarding REST endpoints (see app/api/connect/{check,prepare,submit,
// register}/route.ts) — the transport layer OnboardingService orchestrates on top of. Every
// call needs the same bearer token used for the rest of the agents-backend (see agentsAuth.ts)
// since the backend derives `owner` from it rather than trusting a client-supplied address.

export interface ConnectCheckResult {
  // "error" (HTTP 502) means the Registry lookup itself failed — RPC/network/simulation/timeout
  // — and is NOT a confirmed "no wallet" verdict. Callers must never treat it like "new" (see
  // apps/web/app/api/connect/check/route.ts and useSmartWallets.mergeSmartWallets).
  status: "new" | "existing" | "error";
  walletAddress?: string;
  smartWallet?: string;
  dbWarning?: string;
  error?: string;
}

export interface ConnectPrepareResult {
  unsignedEntryXdr: string;
  smartWalletAddress: string;
  saltHex: string;
  validUntilLedgerSeq: number;
}

export interface ConnectSubmitResult {
  status: "created";
  walletAddress: string;
  smartWallet: string;
}

export class ConnectApiError extends Error {
  /** Set when the server confirms the smart wallet deployed on-chain but a later step (saving
   *  the mapping) failed — lets the caller retry via /api/connect/register instead of
   *  re-deploying. */
  smartWallet?: string;
}

async function post<T>(path: string, body: Record<string, unknown>, token: string): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ConnectApiError(data.error || `Onboarding request failed (${res.status})`);
    if (typeof data.smartWallet === "string") err.smartWallet = data.smartWallet;
    throw err;
  }
  return data as T;
}

export function checkOnboarding(token: string): Promise<ConnectCheckResult> {
  return post("/api/connect/check", {}, token);
}

export function prepareOnboarding(owner: string, token: string): Promise<ConnectPrepareResult> {
  return post("/api/connect/prepare", { owner }, token);
}

export function submitOnboarding(
  owner: string,
  saltHex: string,
  signedEntryXdr: string,
  token: string
): Promise<ConnectSubmitResult> {
  return post("/api/connect/submit", { owner, saltHex, signedEntryXdr }, token);
}

/** Retry-only: persists a mapping for a smart wallet that already deployed on-chain (a prior
 *  submitOnboarding whose persistence step failed) — never re-deploys. */
export function registerOnboarding(smartWallet: string, token: string): Promise<ConnectSubmitResult> {
  return post("/api/connect/register", { smartWallet }, token);
}
