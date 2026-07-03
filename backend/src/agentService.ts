import { Keypair } from '@stellar/stellar-sdk';
import type { Signer } from '@wolf1276/kairos-sdk';
import { TurnkeySigner } from '@wolf1276/kairos-turnkey-signer';
import { randomUUID } from 'crypto';
import { getDb, getWalletDelegation, upsertWalletDelegation, setWalletDelegationDisabled, type AgentRow } from './db.js';
import { decryptSecret } from './crypto.js';
import { getKairosClient } from './kairos.js';
import { getNetwork } from './config.js';
import { getTurnkeyClient, getTurnkeyOrganizationId } from './turnkey.js';
import type { AgentSummary, JsonSafeDelegation, StrategyConfig } from './types.js';

function toSummary(row: AgentRow): AgentSummary {
  const walletDelegation = row.delegator ? getWalletDelegation(row.delegator) : undefined;
  return {
    id: row.id,
    owner: row.owner,
    publicKey: row.public_key,
    status: row.status,
    delegationHash: walletDelegation && !walletDelegation.disabled ? walletDelegation.delegation_hash : null,
    delegator: row.delegator,
    strategy: row.strategy_config_json ? JSON.parse(row.strategy_config_json) : null,
    lastTickAt: row.last_tick_at,
    lastResult: row.last_result,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

/** Resolves the active, non-disabled delegation shared by every agent tied to this wallet. */
export function getActiveDelegationForAgent(row: AgentRow): JsonSafeDelegation | null {
  if (!row.delegator) return null;
  const walletDelegation = getWalletDelegation(row.delegator);
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
export async function createAgent(owner: string): Promise<AgentSummary> {
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
  };
  getDb()
    .prepare(
      `INSERT INTO agents (id, owner, public_key, encrypted_secret, turnkey_private_key_id, status, created_at)
       VALUES (@id, @owner, @public_key, @encrypted_secret, @turnkey_private_key_id, @status, @created_at)`
    )
    .run(row);
  return toSummary(row);
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
 * Attaches the wallet's single shared delegation to an agent — verifies delegate/hash match
 * before storing. All execution modes (autonomous/strategy/user-intent) for the same wallet
 * share this one delegation row; attaching a second agent to the same wallet reuses it rather
 * than minting a new one.
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

  upsertWalletDelegation(delegation.delegator, hash, JSON.stringify(delegation));
  getDb().prepare('UPDATE agents SET delegator = ? WHERE id = ?').run(delegation.delegator, id);
  return getAgent(id)!;
}

/** Revokes the shared delegation for a wallet — every agent tied to that wallet is blocked. */
export function revokeWalletDelegation(delegator: string): void {
  setWalletDelegationDisabled(delegator, true);
}

export function setStrategy(id: string, strategy: StrategyConfig): AgentSummary {
  const row = getAgentRow(id);
  if (!row) throw new Error('Agent not found');
  const delegation = getActiveDelegationForAgent(row);
  if (!delegation) throw new Error('Attach a delegation before configuring a strategy');

  // `destination` is always the delegation's own delegator (the smart wallet this agent
  // spends from) — whatever a client sends is ignored, so an agent can never be configured
  // to route funds to an arbitrary external address. Profits/spend always stay in the same
  // wallet the delegation came from.
  const finalStrategy: StrategyConfig = { ...strategy, destination: delegation.delegator };

  getDb().prepare('UPDATE agents SET strategy = ?, strategy_config_json = ? WHERE id = ?').run(finalStrategy.type, JSON.stringify(finalStrategy), id);
  return getAgent(id)!;
}

export function startAgent(id: string): AgentSummary {
  const row = getAgentRow(id);
  if (!row) throw new Error('Agent not found');
  if (!getActiveDelegationForAgent(row)) throw new Error('Attach a delegation before starting this agent');
  if (!row.strategy_config_json) throw new Error('Configure a strategy before starting this agent');
  getDb().prepare("UPDATE agents SET status = 'running', last_error = NULL WHERE id = ?").run(id);
  return getAgent(id)!;
}

export function stopAgent(id: string): AgentSummary {
  const row = getAgentRow(id);
  if (!row) throw new Error('Agent not found');
  getDb().prepare("UPDATE agents SET status = 'stopped' WHERE id = ?").run(id);
  return getAgent(id)!;
}

export function deleteAgent(id: string): void {
  getDb().prepare('DELETE FROM agents WHERE id = ?').run(id);
}

export function recordTick(id: string, result: { ok: boolean; message: string }): void {
  getDb()
    .prepare('UPDATE agents SET last_tick_at = ?, last_result = ?, last_error = ?, status = ? WHERE id = ?')
    .run(Date.now(), result.ok ? result.message : null, result.ok ? null : result.message, result.ok ? 'running' : 'error', id);
}

export function listRunningAgents(): AgentRow[] {
  return getDb().prepare("SELECT * FROM agents WHERE status = 'running'").all() as AgentRow[];
}
