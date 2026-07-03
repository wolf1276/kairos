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
