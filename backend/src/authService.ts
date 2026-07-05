import { Keypair } from '@stellar/stellar-sdk';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';
import { deleteAuthChallenge, getAuthChallenge, setAuthChallenge, upsertUser } from './db.js';
import { getAuthJwtSecret } from './config.js';

const CHALLENGE_TTL_MS = 5 * 60_000;
const SESSION_TTL = '7d';

/** The exact string signed by the wallet — kept stable so verify() checks the same bytes. */
function challengeMessage(publicKey: string, nonce: string): string {
  return `Kairos login\naddress: ${publicKey}\nnonce: ${nonce}`;
}

/** SEP-43 wallets don't sign the raw message bytes — they sign the SEP-53-wrapped digest
 *  (SHA-256("Stellar Signed Message:\n" + message)), same wrapping used for smart-wallet
 *  delegation signatures elsewhere (see stellar.ts signDelegationHashWithWallet). Verification
 *  must hash the same way or every real signature fails. Non-SEP-43-compliant wallets (e.g.
 *  Albedo's signMessage) will fail this check — that's expected, not a bug. */
function sep53Digest(message: string): Buffer {
  return createHash('sha256').update(`Stellar Signed Message:\n${message}`, 'utf8').digest();
}

export function createChallenge(publicKey: string): { nonce: string; message: string } {
  const nonce = randomBytes(16).toString('hex');
  setAuthChallenge(publicKey, nonce, Date.now() + CHALLENGE_TTL_MS);
  return { nonce, message: challengeMessage(publicKey, nonce) };
}

export function verifyChallenge(publicKey: string, signature: string): { token: string } {
  const challenge = getAuthChallenge(publicKey);
  if (!challenge) throw new Error('No pending challenge for this address — request a new one');
  if (challenge.expires_at < Date.now()) {
    deleteAuthChallenge(publicKey);
    throw new Error('Challenge expired — request a new one');
  }

  const message = challengeMessage(publicKey, challenge.nonce);
  const keypair = Keypair.fromPublicKey(publicKey);
  const verified = keypair.verify(sep53Digest(message), Buffer.from(signature, 'base64'));
  if (!verified) throw new Error('Signature does not match this address');

  deleteAuthChallenge(publicKey);
  upsertUser(publicKey);

  const token = jwt.sign({ sub: publicKey }, getAuthJwtSecret(), { expiresIn: SESSION_TTL });
  return { token };
}

export function verifySessionToken(token: string): { publicKey: string } {
  const payload = jwt.verify(token, getAuthJwtSecret()) as jwt.JwtPayload;
  if (typeof payload.sub !== 'string') throw new Error('Malformed session token');
  return { publicKey: payload.sub };
}
