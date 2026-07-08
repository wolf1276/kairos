import { Asset, Keypair } from '@stellar/stellar-sdk';
import type { Signer } from '@wolf1276/kairos-sdk';
import { TurnkeySigner } from '@wolf1276/kairos-turnkey-signer';
import { randomUUID } from 'crypto';
import os from 'os';
import { getDb, getWalletDelegation, upsertWalletDelegation, setWalletDelegationDisabled, type AgentRow, type AgentMode, type AgentRole } from './db.js';
import { listSmartWallets } from './smartWalletsDb.js';
import { decryptSecret } from './crypto.js';
import { getKairosClient } from './kairos.js';
import { getNetwork } from './config.js';
import { getTurnkeyClient, getTurnkeyOrganizationId } from './turnkey.js';
import type { AgentPolicy, AgentSummary, JsonSafeDelegation, StrategyConfig } from './types.js';
import { logEvent } from './auditService.js';

function toSummary(row: AgentRow): AgentSummary {
  const walletDelegation = row.delegator ? getWalletDelegation(row.delegator, row.public_key) : undefined;
  return {
    id: row.id,
    owner: row.owner,
    publicKey: row.public_key,
    role: row.role,
    status: row.status,
    delegationHash: walletDelegation && !walletDelegation.disabled ? walletDelegation.delegation_hash : null,
    delegator: row.delegator,
    strategy: row.strategy_config_json ? JSON.parse(row.strategy_config_json) : null,
    lastTickAt: row.last_tick_at,
    lastResult: row.last_result,
    lastError: row.last_error,
    createdAt: row.created_at,
    mode: row.mode,
    capital: row.capital,
    riskLevel: row.risk_level,
    startedAt: row.started_at,
    policy: row.policy_json ? (JSON.parse(row.policy_json) as AgentPolicy) : null,
  };
}

/** Resolves this agent's own active, non-disabled delegation from its wallet — independent of
 *  any other agent's delegation from the same wallet. */
export function getActiveDelegationForAgent(row: AgentRow): JsonSafeDelegation | null {
  if (!row.delegator) return null;
  const walletDelegation = getWalletDelegation(row.delegator, row.public_key);
  if (!walletDelegation || walletDelegation.disabled) return null;
  return JSON.parse(walletDelegation.delegation_json);
}

/**
 * Creates a new agent with its own MPC-backed (Turnkey) Ed25519 key — the private key is
 * generated and held as secret shares across Turnkey's signing cluster and is never
 * assembled in this process. Every agent gets a distinct Turnkey `privateKeyId`, so one
 * agent's key can never be used to sign for another, and each can be revoked independently
 * (via Turnkey, in addition to revoking its Kairos delegation on-chain).
 */
export async function createAgent(owner: string, options?: { mode?: AgentMode; capital?: string; riskLevel?: string; role?: AgentRole; policy?: AgentPolicy }): Promise<AgentSummary> {
  const id = randomUUID();
  const signer = await TurnkeySigner.forNewAgent(getTurnkeyClient(), getTurnkeyOrganizationId(), id);

  // The agent's own account is the transaction source (fee-payer) for every redemption it
  // submits — an unfunded account has no sequence number and every submission fails with a
  // generic "Send transaction failed" error. Testnet accounts are free to fund via Friendbot;
  // on mainnet this needs a real funding step the caller handles out of band.
  if (getNetwork() === 'testnet') {
    await getKairosClient().ensureFundedTestnetAccount(signer.publicKey());
  }

  const row: AgentRow = {
    id,
    owner,
    public_key: signer.publicKey(),
    role: options?.role ?? null,
    encrypted_secret: '',
    turnkey_private_key_id: signer.id,
    status: 'new',
    delegator: null,
    strategy: null,
    strategy_config_json: null,
    last_tick_at: null,
    last_result: null,
    last_error: null,
    created_at: Date.now(),
    mode: options?.mode ?? 'live',
    capital: options?.capital ?? null,
    risk_level: options?.riskLevel ?? null,
    started_at: null,
    lock_token: null,
    lock_expires_at: null,
    policy_json: options?.policy ? JSON.stringify(options.policy) : null,
  };
  getDb()
    .prepare(
      `INSERT INTO agents (id, owner, public_key, role, encrypted_secret, turnkey_private_key_id, status, created_at, mode, capital, risk_level, started_at, policy_json)
       VALUES (@id, @owner, @public_key, @role, @encrypted_secret, @turnkey_private_key_id, @status, @created_at, @mode, @capital, @risk_level, @started_at, @policy_json)`
    )
    .run(row);
  return toSummary(row);
}

/** Updates the stored Permissions/Safety policy for an existing agent (e.g. provisioned before
 *  the caller had computed policy, or edited after creation). Doesn't retroactively enforce
 *  anything for trades already in flight. */
export function setPolicy(id: string, policy: AgentPolicy): AgentSummary {
  getDb().prepare('UPDATE agents SET policy_json = ? WHERE id = ?').run(JSON.stringify(policy), id);
  return getAgent(id)!;
}

/** Counts trades this agent has executed since UTC midnight — used to enforce
 *  `policy.maxDailyTrades` (agentcreation.md §3 "Maximum Daily Trades"). */
export function tradesToday(agentId: string): number {
  const startOfDayMs = new Date(new Date().toDateString()).getTime();
  const row = getDb()
    .prepare('SELECT COUNT(*) as n FROM trades WHERE agent_id = ? AND created_at >= ?')
    .get(agentId, startOfDayMs) as { n: number };
  return row.n;
}

export function listAgents(owner: string): AgentSummary[] {
  const rows = getDb().prepare('SELECT * FROM agents WHERE owner = ? ORDER BY created_at DESC').all(owner) as AgentRow[];
  return rows.map(toSummary);
}

export function getAgentRow(id: string): AgentRow | undefined {
  return getDb().prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined;
}

export function getAgent(id: string): AgentSummary | undefined {
  const row = getAgentRow(id);
  return row ? toSummary(row) : undefined;
}

/**
 * Resolves the signer for an agent's own account (the tx source/fee-payer for its
 * redemptions). New agents are always Turnkey-backed — this makes a network call to fetch
 * that key's current public key and returns a `RemoteSigner` that round-trips every `sign()`
 * to Turnkey's MPC cluster. Agents created before Turnkey integration fall back to their
 * locally encrypted secret.
 */
export async function getAgentSigner(row: AgentRow): Promise<Signer> {
  if (row.turnkey_private_key_id) {
    return TurnkeySigner.forExistingKey(getTurnkeyClient(), getTurnkeyOrganizationId(), row.turnkey_private_key_id);
  }
  return Keypair.fromSecret(decryptSecret(row.encrypted_secret));
}

/**
 * Attaches a delegation to this agent — verifies delegate/hash match before storing. Each
 * agent tied to a wallet holds its own independent delegation row (keyed by delegator+delegate,
 * see WalletDelegationRow), so multiple agents can each have live spend authority from the same
 * wallet at once without stepping on each other.
 */
export async function attachDelegation(id: string, delegation: JsonSafeDelegation): Promise<AgentSummary> {
  const row = getAgentRow(id);
  if (!row) throw new Error('Agent not found');
  if (delegation.delegate !== row.public_key) {
    throw new Error(`Delegation's delegate (${delegation.delegate}) does not match this agent's public key (${row.public_key})`);
  }

  const client = getKairosClient();
  const fullDelegation = {
    ...delegation,
    salt: BigInt(delegation.salt),
    nonce: BigInt(delegation.nonce),
    caveats: delegation.caveats.map((c) => ({ enforcer: c.enforcer, terms: new Uint8Array(c.terms) })),
  };
  const hash = client.delegation.getHash(fullDelegation);
  const status = await client.delegation.get(hash);
  if (status.disabled) throw new Error('This delegation is disabled on-chain');

  upsertWalletDelegation(delegation.delegator, delegation.delegate, hash, JSON.stringify(delegation));
  getDb().prepare('UPDATE agents SET delegator = ? WHERE id = ?').run(delegation.delegator, id);
  return getAgent(id)!;
}

/** Revokes this specific agent's delegation from its wallet — other agents delegated from the
 *  same wallet are unaffected. */
export function revokeWalletDelegation(delegator: string, delegate: string): void {
  setWalletDelegationDisabled(delegator, delegate, true);
}

export function setStrategy(id: string, strategy: StrategyConfig): AgentSummary {
  const row = getAgentRow(id);
  if (!row) throw new Error('Agent not found');

  // Only 'dca' actually spends via the Kairos delegation's execute() call — quant and limit
  // trade from the agent's own funded Stellar account (see tick.ts), so they don't need one.
  let destination: string;
  if (strategy.type === 'dca') {
    const delegation = getActiveDelegationForAgent(row);
    if (!delegation) throw new Error('Attach a delegation before configuring a strategy');
    // `destination` is always the delegation's own delegator (the smart wallet this agent
    // spends from) — whatever a client sends is ignored, so an agent can never be configured
    // to route funds to an arbitrary external address. Profits/spend always stay in the same
    // wallet the delegation came from.
    destination = delegation.delegator;
  } else {
    destination = row.public_key;
  }

  const finalStrategy: StrategyConfig = { ...strategy, destination };

  getDb().prepare('UPDATE agents SET strategy = ?, strategy_config_json = ? WHERE id = ?').run(finalStrategy.type, JSON.stringify(finalStrategy), id);
  return getAgent(id)!;
}

export interface StartValidationResult {
  ok: boolean;
  reason?: string;
}

/** Extracts the strategy's per-action spend amount regardless of type — the field name differs
 *  per StrategyConfig variant (amountPerTick/amountPerTrade/quantity) but the rule applied to it
 *  ("must be greater than zero") is the same for every type. */
function strategySpendAmount(strategy: StrategyConfig): number {
  switch (strategy.type) {
    case 'dca':
      return Number(strategy.amountPerTick);
    case 'quant':
    case 'role':
      return Number(strategy.amountPerTrade);
    case 'limit':
      return Number(strategy.quantity);
  }
}

/**
 * Single prerequisite gate for every live agent type (dca/quant/limit/role) before it can
 * transition to 'running'. Money always flows User Wallet → Smart Wallet → Delegation → Agent
 * → Protocols — the agent's own account is never the thing that needs funds, so this checks
 * the *Smart Wallet's* balance, never the agent's. Paper mode never calls this (see startAgent).
 */
export async function validateStartPrerequisites(row: AgentRow, strategy: StrategyConfig): Promise<StartValidationResult> {
  const spendAmount = strategySpendAmount(strategy);
  if (!Number.isFinite(spendAmount) || spendAmount <= 0) {
    return { ok: false, reason: 'Agent is not fully configured — spending limit must be greater than 0' };
  }

  if (!row.delegator) {
    return { ok: false, reason: 'No Smart Wallet attached — connect a Smart Wallet before starting this agent' };
  }

  const smartWallets = await listSmartWallets(row.owner);
  if (!smartWallets.some((w) => w.address === row.delegator)) {
    return { ok: false, reason: 'Smart Wallet not found for this account' };
  }

  const delegationRow = getWalletDelegation(row.delegator, row.public_key);
  if (!delegationRow) {
    return { ok: false, reason: 'No delegation found — attach a delegation before starting this agent' };
  }
  if (delegationRow.disabled) {
    return { ok: false, reason: 'Delegation is inactive — re-enable it before starting this agent' };
  }

  try {
    const client = getKairosClient();
    const nativeContractId = Asset.native().contractId(client.networkPassphrase);
    const balance = await client.wallet.balance(row.delegator, nativeContractId);
    if (balance <= 0n) {
      return { ok: false, reason: 'Smart Wallet has no funds — deposit funds before starting this agent' };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `Unable to verify Smart Wallet balance — ${message}` };
  }

  return { ok: true };
}

export async function startAgent(id: string): Promise<AgentSummary> {
  const row = getAgentRow(id);
  if (!row) throw new Error('Agent not found');
  if (!row.strategy_config_json) throw new Error('Configure a strategy before starting this agent');
  const strategy = JSON.parse(row.strategy_config_json) as StrategyConfig;

  if (row.mode === 'live') {
    const result = await validateStartPrerequisites(row, strategy);
    if (!result.ok) throw new Error(result.reason);
  }

  getDb().prepare("UPDATE agents SET status = 'running', last_error = NULL, started_at = ? WHERE id = ?").run(Date.now(), id);
  logEvent({
    agentId: id,
    owner: row.owner,
    eventType: 'strategy_started',
    mode: row.mode,
    strategyId: strategy.type,
    mpcAccount: row.public_key,
    message: `Strategy started (${strategy.type})`,
  });
  return getAgent(id)!;
}

export function stopAgent(id: string): AgentSummary {
  const row = getAgentRow(id);
  if (!row) throw new Error('Agent not found');
  getDb().prepare("UPDATE agents SET status = 'stopped' WHERE id = ?").run(id);
  logEvent({
    agentId: id,
    owner: row.owner,
    eventType: 'strategy_stopped',
    mode: row.mode,
    mpcAccount: row.public_key,
    message: 'Strategy stopped',
  });
  return getAgent(id)!;
}

export function deleteAgent(id: string): void {
  getDb().prepare('DELETE FROM agents WHERE id = ?').run(id);
}

/**
 * `keepRunning` — role agents are documented to run continuously (see autonomous/page.tsx);
 * a transient failure (HF timeout, Horizon blip, oracle hiccup) must not permanently kill
 * them, since `listRunningAgents()` only re-ticks agents with status 'running' and nothing
 * ever auto-restarts an 'error' one. User-configured strategy agents (tick.ts) keep the
 * original halt-on-error behavior — that's a deliberate stop for the user to review.
 */
export function recordTick(id: string, result: { ok: boolean; message: string }, opts?: { keepRunning?: boolean }): void {
  const status = result.ok ? 'running' : opts?.keepRunning ? 'running' : 'error';
  getDb()
    .prepare('UPDATE agents SET last_tick_at = ?, last_result = ?, last_error = ?, status = ? WHERE id = ?')
    .run(Date.now(), result.ok ? result.message : null, result.ok ? null : result.message, status, id);

  if (!result.ok) {
    const row = getAgentRow(id);
    if (row) {
      logEvent({
        agentId: id,
        owner: row.owner,
        eventType: 'strategy_error',
        mode: row.mode,
        mpcAccount: row.public_key,
        message: result.message,
      });
    }
  }
}

export function listRunningAgents(): AgentRow[] {
  return getDb().prepare("SELECT * FROM agents WHERE status = 'running'").all() as AgentRow[];
}

/** Unique per-process identity embedded in every lock token, so a lock this process reads back
 *  can be told apart from one taken concurrently by another process/host after our TTL expired. */
const LOCK_HOLDER = `${os.hostname()}:${process.pid}:${randomUUID()}`;
const AGENT_LOCK_TTL_MS = 5 * 60_000;

/**
 * Atomically claims the right to tick this agent via a conditional UPDATE — SQLite serializes
 * all writers (even across processes sharing one DB file), so exactly one caller's UPDATE can
 * match `changes === 1` for a given row at a time. This is the guard that's missing when the
 * scheduler runs in more than one process: without it, two processes racing `listRunningAgents`
 * could both pass the in-memory `cycleInProgress`/`last_tick_at` checks and tick + trade the
 * same agent twice. `lock_expires_at` is a crash safety net — if a holder dies mid-tick without
 * releasing, the lock self-expires instead of blocking the agent forever.
 * Returns a token to hand back to `releaseAgentLock`, or null if someone else holds it.
 */
export function claimAgentLock(agentId: string): string | null {
  const token = `${LOCK_HOLDER}:${randomUUID()}`;
  const now = Date.now();
  const result = getDb()
    .prepare(
      `UPDATE agents SET lock_token = ?, lock_expires_at = ?
       WHERE id = ? AND (lock_token IS NULL OR lock_expires_at < ?)`
    )
    .run(token, now + AGENT_LOCK_TTL_MS, agentId, now);
  return result.changes === 1 ? token : null;
}

/** Releases a lock only if `token` still matches — prevents releasing a lock that expired and
 *  was subsequently claimed by another holder while our tick was still finishing up. */
export function releaseAgentLock(agentId: string, token: string): void {
  getDb()
    .prepare('UPDATE agents SET lock_token = NULL, lock_expires_at = NULL WHERE id = ? AND lock_token = ?')
    .run(agentId, token);
}
