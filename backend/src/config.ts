function readRequiredEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

export function getContractConfig() {
  return {
    delegationManager: readRequiredEnv('DELEGATION_MANAGER_CONTRACT_ID'),
    policyEngine: readRequiredEnv('POLICY_CONTRACT_ID'),
    customAccount: process.env.CUSTOM_ACCOUNT_CONTRACT_ID,
  };
}

export function getNetwork(): 'testnet' | 'mainnet' {
  const network = process.env.STELLAR_NETWORK || 'testnet';
  if (network !== 'testnet' && network !== 'mainnet') {
    throw new Error(`Invalid STELLAR_NETWORK: ${network}`);
  }
  return network;
}

export function getPort(): number {
  return Number(process.env.PORT) || 4001;
}

export function getDbPath(): string {
  return process.env.AGENTS_DB_PATH || './data/agents.db';
}

/** Postgres connection string for smart-wallet ownership — the production DB of record,
 *  replacing the SQLite table that used to live alongside agents.db. Required, no fallback:
 *  silently falling back to a local file is exactly the durability gap this migration closes. */
export function getDatabaseUrl(): string {
  return readRequiredEnv('DATABASE_URL');
}

/** 32-byte hex key used to encrypt agent secret keys at rest (AES-256-GCM). */
export function getMasterKeyHex(): string {
  const key = readRequiredEnv('AGENT_MASTER_KEY');
  if (!/^[0-9a-f]{64}$/i.test(key)) {
    throw new Error('AGENT_MASTER_KEY must be a 64-character hex string (32 bytes). Generate one with: openssl rand -hex 32');
  }
  return key;
}

export function getAllowedOrigin(): string {
  return process.env.ALLOWED_ORIGIN || '*';
}

export function getSchedulerIntervalMs(): number {
  return Number(process.env.SCHEDULER_INTERVAL_MS) || 30_000;
}

/** How often the Context Layer's self-check (agentContext/monitor.ts) recomputes its health
 *  summary and logs threshold warnings. Independent of SCHEDULER_INTERVAL_MS — monitoring cadence
 *  and agent-tick cadence are unrelated concerns that happen to reuse the same setInterval pattern. */
export function getContextMonitorIntervalMs(): number {
  return Number(process.env.CONTEXT_MONITOR_INTERVAL_MS) || 60_000;
}

export function getAuthJwtSecret(): string {
  return readRequiredEnv('AUTH_JWT_SECRET');
}

/** Optional — when unset, the decision engine falls back to deterministic heuristic reasoning. */
export function getHuggingFaceApiKey(): string | undefined {
  return process.env.HUGGINGFACE_API_KEY || undefined;
}

/** How often each autonomous role agent may act, in seconds (its own tick still gated by this). */
export function getRoleIntervalSeconds(): number {
  return Number(process.env.ROLE_INTERVAL_SECONDS) || 120;
}

/** Feature-flags routing agent decisions through the delegation/redemption protocol adapters
 *  (Blend, Soroswap — see protocolExecutionService.ts) instead of only the legacy direct-custody
 *  trading loop. Off by default: real Blend/Soroswap execution is new and unproven end-to-end. */
export function isProtocolExecutionEnabled(): boolean {
  return process.env.ENABLE_PROTOCOL_EXECUTION === 'true';
}

/** Stellar public keys allowed to reach the hidden Developer Mode surface (`/api/dev/*`).
 *  Comma-separated, whitespace-trimmed. Empty/unset by default — nobody has dev access in a
 *  deployment unless this is explicitly configured, so it's read from process.env directly
 *  (not readRequiredEnv) and never throws. Server-side only: the frontend has no way to grant
 *  itself membership, it only reflects whatever `GET /api/dev/status` reports. */
export function getDevAllowlist(): string[] {
  const raw = process.env.DEV_ALLOWLIST || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
