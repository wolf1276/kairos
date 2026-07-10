import { NextResponse } from "next/server";
import { StrKey } from "@stellar/stellar-sdk";

// Onboarding runs entirely on testnet today, same as every other sponsored flow in
// /api/delegate-sdk — see that route's NETWORK constant.
export const ONBOARDING_NETWORK = "testnet";

function backendBase(): string {
  return process.env.AGENTS_BACKEND_URL || process.env.NEXT_PUBLIC_AGENTS_BACKEND_URL || "http://localhost:4001";
}

export interface SmartWalletDto {
  owner: string;
  address: string;
}

interface BackendResult {
  ok: boolean;
  status: number;
  // `owner` is present on the smart-wallets GET response body even on 503 (DB unavailable) —
  // it's derived from the auth token, not the DB — so callers can still fall back to Registry.
  data: { error?: string; owner?: string; wallets?: SmartWalletDto[] };
}

/** Proxies to the existing (already-authenticated) agents-backend — reused by every connect/*
 *  route so none of them re-implement "does this owner have a smart wallet" / "persist this
 *  wallet mapping" logic that routes/smartWallets.ts + db.ts already own. The backend derives
 *  `owner` from the same bearer token forwarded here (see authMiddleware.ts's requireAuth), not
 *  from any client-supplied address, so a caller can never check or register a mapping for an
 *  address it hasn't itself authenticated as. */
export async function backendFetch(path: string, authHeader: string | null, init?: RequestInit): Promise<BackendResult> {
  const res = await fetch(`${backendBase()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(authHeader ? { Authorization: authHeader } : {}),
      ...init?.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/** Persists {owner (derived from the token), smartWallet} via the existing smart-wallets
 *  route — shared by both submit and register so neither re-implements "how to save a mapping". */
export function registerSmartWallet(authHeader: string, address: string) {
  return backendFetch("/api/smart-wallets", authHeader, {
    method: "POST",
    body: JSON.stringify({ address, network: ONBOARDING_NETWORK }),
  });
}

/** Thrown by request validation — carries its own HTTP status so `withOnboardingErrors` doesn't
 *  need a big if/else to map error types to status codes. */
export class OnboardingRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function requireAuthHeader(authHeader: string | null): string {
  if (!authHeader) {
    throw new OnboardingRequestError("Missing Authorization header — authenticate with the wallet backend first", 401);
  }
  return authHeader;
}

export function requireOwner(owner: unknown): string {
  if (typeof owner !== "string" || !StrKey.isValidEd25519PublicKey(owner)) {
    throw new OnboardingRequestError("A valid Stellar wallet address is required", 400);
  }
  return owner;
}

export function requireSmartWalletAddress(value: unknown): string {
  if (typeof value !== "string" || !StrKey.isValidContract(value)) {
    throw new OnboardingRequestError("A valid smart wallet contract address is required", 400);
  }
  return value;
}

/** Wraps a connect/* route handler with the one error -> HTTP-status mapping every one of them
 *  needs: an `OnboardingRequestError` carries its own status, anything else is an unexpected
 *  failure (500). Keeps that mapping in exactly one place instead of once per route file. */
export function withOnboardingErrors(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof OnboardingRequestError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      const msg = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  };
}
