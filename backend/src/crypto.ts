import * as crypto from 'crypto';
import { getMasterKeyHex } from './config.js';

// AES-256-GCM: 12-byte random IV + ciphertext + 16-byte auth tag, all base64-joined with ':'.
// Only decrypt is needed now — new agents are Turnkey-backed; this only reads secrets
// encrypted before that switch (see agentService.getAgentSigner's legacy fallback).
export function decryptSecret(payload: string): string {
  const key = Buffer.from(getMasterKeyHex(), 'hex');
  const [ivB64, dataB64, tagB64] = payload.split(':');
  if (!ivB64 || !dataB64 || !tagB64) throw new Error('Malformed encrypted secret payload');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}
