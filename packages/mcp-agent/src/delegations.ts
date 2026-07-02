import type { Delegation, KairosClient } from '@wolf1276/kairos-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { getDelegationsDir } from './config.js';

// Mirrors apps/web/app/api/delegate-sdk/route.ts's JsonSafeDelegation shape — `salt`/`nonce`
// are bigint and `Caveat.terms` is a Uint8Array, neither of which survive JSON round-tripping.
interface JsonSafeDelegation {
  delegate: string;
  delegator: string;
  authority: string;
  salt: string;
  nonce: string;
  signature: string;
  caveats: { enforcer: string; terms: number[] }[];
}

function deserializeDelegation(d: JsonSafeDelegation): Delegation {
  return {
    ...d,
    salt: BigInt(d.salt),
    nonce: BigInt(d.nonce),
    caveats: d.caveats.map((c) => ({ enforcer: c.enforcer, terms: new Uint8Array(c.terms) })),
  };
}

export interface EligibleDelegation {
  hash: string;
  delegation: Delegation;
}

/**
 * Loads every delegation JSON file exported from the dashboard, keeping only ones where
 * this agent's session key is the `delegate` and that aren't disabled on-chain. The chain's
 * events only carry delegation hashes, not the full signed struct needed to redeem — so the
 * full struct has to be handed to the agent out-of-band, via these exported files.
 */
export async function loadEligibleDelegations(
  client: KairosClient,
  sessionPublicKey: string
): Promise<EligibleDelegation[]> {
  const dir = getDelegationsDir();
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const results: EligibleDelegation[] = [];

  for (const file of files) {
    const raw = fs.readFileSync(path.join(dir, file), 'utf8');
    let jsonSafe: JsonSafeDelegation;
    try {
      jsonSafe = JSON.parse(raw);
    } catch {
      continue;
    }
    const delegation = deserializeDelegation(jsonSafe);
    if (delegation.delegate !== sessionPublicKey) continue;

    const hash = client.delegation.getHash(delegation);
    const status = await client.delegation.get(hash);
    if (status.disabled) continue;

    results.push({ hash, delegation });
  }

  return results;
}
