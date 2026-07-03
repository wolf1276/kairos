// Ground-truth checks against Horizon for execution-journal recovery — closes the gap where a
// journal row's local status is trusted blindly. 'broadcast' rows are verified against Horizon
// before being replayed into `trades` (a row could be marked 'broadcast' from a resolved
// promise whose result never actually reached durable Horizon state under some failure modes);
// 'pending' rows past the grace window get one best-effort search for a matching transaction
// that landed after the journal was opened, so a crash *during* `submitTransaction` (broadcast
// succeeded, the response just never reached this process) isn't misreported as failed.
import { Horizon } from '@stellar/stellar-sdk';
import { getNetwork } from './config.js';

const HORIZON_TESTNET_URL = 'https://horizon-testnet.stellar.org';
const HORIZON_MAINNET_URL = 'https://horizon.stellar.org';

function horizonServer(): Horizon.Server {
  const url = getNetwork() === 'testnet' ? HORIZON_TESTNET_URL : HORIZON_MAINNET_URL;
  return new Horizon.Server(url, { allowHttp: false });
}

/** True only if Horizon confirms this exact hash landed successfully. Paper-mode hashes
 *  (`paper-<uuid>`) never touch Horizon and are trivially "verified" — nothing to check. */
export async function verifyTransactionOnHorizon(txHash: string): Promise<boolean> {
  if (txHash.startsWith('paper-')) return true;
  try {
    const tx = await horizonServer().transactions().transaction(txHash).call();
    return tx.successful;
  } catch {
    // 404 (not found) or network error — either way, not verifiably successful.
    return false;
  }
}

/**
 * Best-effort recovery for a journal row that never captured a tx_hash. Scans the account's
 * most recent transactions for one submitted after `sinceMs` — if the crash happened between
 * Horizon accepting the tx and this process recording the returned hash, it shows up here.
 * Returns the first (most recent) successful match, or null if none found. Deliberately does
 * NOT attempt to match by amount/asset — the account only ever has one agent-owned key and role
 * agents run one action per tick, so any successful tx after the journal's open time is that
 * agent's tx.
 */
export async function findBroadcastAfter(publicKey: string, sinceMs: number): Promise<string | null> {
  try {
    const page = await horizonServer().transactions().forAccount(publicKey).order('desc').limit(10).call();
    for (const tx of page.records) {
      if (!tx.successful) continue;
      if (new Date(tx.created_at).getTime() >= sinceMs) return tx.hash;
    }
    return null;
  } catch {
    return null;
  }
}
