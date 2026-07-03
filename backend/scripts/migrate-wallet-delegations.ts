/**
 * One-off backfill for the per-agent -> per-wallet delegation refactor.
 *
 * Before: each `agents` row carried its own `delegation_hash`/`delegation_json` columns,
 * so two agents attached to the same wallet held two independent copies (the "multiple
 * delegations" bug). After: one row per wallet lives in `wallet_delegations`, and agents
 * just point at it via `agents.delegator`.
 *
 * This script reads any legacy `delegation_hash`/`delegation_json` columns still present
 * on `agents` (added `ALTER TABLE agents ADD COLUMN delegator TEXT` runs automatically on
 * `getDb()`, but does NOT touch the legacy columns or backfill data), groups by wallet
 * (`delegation_json.delegator`), keeps the most-recently-created delegation per wallet as
 * the active one, disables the rest via `wallet_delegations.disabled`, and points every
 * agent's `delegator` column at the right wallet.
 *
 * Safe to run more than once (upserts). Does not drop the legacy columns — do that
 * manually once you've verified the app runs correctly against wallet_delegations:
 *   ALTER TABLE agents DROP COLUMN delegation_hash;
 *   ALTER TABLE agents DROP COLUMN delegation_json;
 *
 * Usage: npx tsx scripts/migrate-wallet-delegations.ts
 */
import { getDb } from '../src/db.js';

interface LegacyAgentRow {
  id: string;
  created_at: number;
  delegation_hash: string | null;
  delegation_json: string | null;
}

function main() {
  const db = getDb();

  const columns = db.prepare('PRAGMA table_info(agents)').all() as { name: string }[];
  const hasLegacyColumns = columns.some((c) => c.name === 'delegation_hash') && columns.some((c) => c.name === 'delegation_json');
  if (!hasLegacyColumns) {
    console.log('No legacy delegation_hash/delegation_json columns found on agents — nothing to migrate.');
    return;
  }

  const rows = db
    .prepare('SELECT id, created_at, delegation_hash, delegation_json FROM agents WHERE delegation_json IS NOT NULL')
    .all() as LegacyAgentRow[];

  if (rows.length === 0) {
    console.log('No agents have a legacy delegation attached — nothing to migrate.');
    return;
  }

  // Group by wallet (delegator), newest delegation_json first.
  const byWallet = new Map<string, { row: LegacyAgentRow; delegator: string }[]>();
  for (const row of rows) {
    let delegator: string;
    try {
      delegator = JSON.parse(row.delegation_json!).delegator;
    } catch {
      console.warn(`Skipping agent ${row.id}: unparseable delegation_json`);
      continue;
    }
    if (!byWallet.has(delegator)) byWallet.set(delegator, []);
    byWallet.get(delegator)!.push({ row, delegator });
  }

  const upsertWallet = db.prepare(
    `INSERT INTO wallet_delegations (delegator, delegation_hash, delegation_json, disabled, updated_at)
     VALUES (@delegator, @hash, @delegationJson, 0, @now)
     ON CONFLICT(delegator) DO UPDATE SET delegation_hash = @hash, delegation_json = @delegationJson, disabled = 0, updated_at = @now`
  );
  const setAgentDelegator = db.prepare('UPDATE agents SET delegator = ? WHERE id = ?');

  let walletsMigrated = 0;
  let dupesFound = 0;

  for (const [delegator, entries] of byWallet) {
    entries.sort((a, b) => b.row.created_at - a.row.created_at);
    const [newest, ...rest] = entries;

    upsertWallet.run({
      delegator,
      hash: newest.row.delegation_hash,
      delegationJson: newest.row.delegation_json,
      now: Date.now(),
    });
    walletsMigrated++;

    for (const entry of entries) {
      setAgentDelegator.run(delegator, entry.row.id);
    }

    if (rest.length > 0) {
      dupesFound += rest.length;
      console.log(
        `Wallet ${delegator}: kept newest delegation (${newest.row.delegation_hash}), ` +
          `${rest.length} older duplicate(s) discarded (agents repointed to the kept one).`
      );
    }
  }

  console.log(`Migrated ${walletsMigrated} wallet(s), discarded ${dupesFound} duplicate delegation(s).`);
  console.log('Verify the app runs correctly, then drop the legacy columns manually (see file header).');
}

main();
