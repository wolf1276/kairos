// Freighter wallet-signature login for the agent-wallet backend — verifies the connected
// address server-side (see backend/src/authService.ts) instead of trusting a client-supplied
// address string, and yields a bearer token used by every subsequent agentsBackend.ts call.

import { signMessage } from "@stellar/freighter-api";

function backendBase(): string {
  return process.env.NEXT_PUBLIC_AGENTS_BACKEND_URL || "http://localhost:4001";
}

function sessionKey(publicKey: string): string {
  return `kairos:session:${publicKey}`;
}

export function getStoredSessionToken(publicKey: string): string | null {
  try {
    return sessionStorage.getItem(sessionKey(publicKey));
  } catch {
    return null;
  }
}

function storeSessionToken(publicKey: string, token: string) {
  try {
    sessionStorage.setItem(sessionKey(publicKey), token);
  } catch {}
}

export function clearStoredSessionToken(publicKey: string) {
  try {
    sessionStorage.removeItem(sessionKey(publicKey));
  } catch {}
}

const inFlight = new Map<string, Promise<string>>();

/**
 * Runs the challenge/sign/verify handshake and returns a bearer token, caching it in
 * sessionStorage. Concurrent callers for the same key (e.g. React effect double-invoke in
 * dev, or multiple pages mounting at once) share one in-flight request instead of each
 * popping a separate Freighter signature prompt.
 */
export async function challengeAndVerify(publicKey: string, networkPassphrase: string): Promise<string> {
  const cached = getStoredSessionToken(publicKey);
  if (cached) return cached;

  const existing = inFlight.get(publicKey);
  if (existing) return existing;

  const promise = runChallengeAndVerify(publicKey, networkPassphrase).finally(() => {
    inFlight.delete(publicKey);
  });
  inFlight.set(publicKey, promise);
  return promise;
}

async function runChallengeAndVerify(publicKey: string, networkPassphrase: string): Promise<string> {
  const challengeRes = await fetch(`${backendBase()}/api/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey }),
  });
  if (!challengeRes.ok) throw new Error(`Backend returned ${challengeRes.status} for challenge`);
  const challenge = await challengeRes.json();

  const signed = await signMessage(challenge.message, { networkPassphrase, address: publicKey });
  if (signed.error) throw new Error(`Freighter signing error: ${signed.error}`);
  if (!signed.signedMessage) throw new Error("Freighter returned an empty signed message");

  const signature =
    typeof signed.signedMessage === "string"
      ? signed.signedMessage
      : Buffer.from(signed.signedMessage).toString("base64");

  const verifyRes = await fetch(`${backendBase()}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey, signature }),
  });
  if (!verifyRes.ok) throw new Error(`Backend returned ${verifyRes.status} for verification`);
  const verified = await verifyRes.json();

  storeSessionToken(publicKey, verified.token);
  return verified.token as string;
}
