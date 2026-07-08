// Resolves the agents-backend origin the BROWSER calls directly (auth challenge/verify in
// agentsAuth.ts, smart-wallet list/register + everything else in agentsBackend.ts).
//
// NEXT_PUBLIC_AGENTS_BACKEND_URL is inlined into the client bundle at BUILD time (Next.js
// statically replaces every `process.env.NEXT_PUBLIC_*` occurrence during compilation — see
// apps/web/Dockerfile's `ARG`/`ENV` right before `pnpm build`). If a production build runs
// without it set, every occurrence silently compiles down to the `|| "http://localhost:4001"`
// fallback that used to live in each call site — so every visitor's browser tries to reach
// its OWN machine's port 4001, which is unreachable, and every backend-dependent step (wallet
// signature login, smart-wallet lookup, smart-wallet creation) fails with a generic
// "unreachable" error that gives no hint the real cause is a missing build-time env var.
//
// This works fine locally (dev's own machine really does have the backend on :4001), which is
// exactly why this bug reads as "works on localhost, fails when deployed" — the divergence is
// the build step, not runtime request logic.
export function resolveAgentsBackendBase(
  env: string | undefined,
  hostname: string | undefined
): string {
  if (env) return env;
  if (!hostname || hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:4001";
  }
  throw new Error(
    "NEXT_PUBLIC_AGENTS_BACKEND_URL was not set when this app was built, so the agents backend " +
      "is unreachable from this deployment. It must be set as a BUILD-TIME env var (Vercel " +
      "project env available to the build step, or --build-arg for the Dockerfile) pointing at " +
      "the deployed backend's public URL — setting it only at runtime has no effect."
  );
}

export function getAgentsBackendBase(): string {
  const hostname = typeof window !== "undefined" ? window.location.hostname : undefined;
  return resolveAgentsBackendBase(process.env.NEXT_PUBLIC_AGENTS_BACKEND_URL, hostname);
}
