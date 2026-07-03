import * as crypto from 'crypto';
import { getMasterKeyHex } from './config.js';

// AES-256-GCM: 12-byte random IV + ciphertext + 16-byte auth tag, all base64-joined with ':'.
// This is what stands between "backend holds agent secret keys" and "backend holds agent
// secret keys in plaintext on disk" — the DB file alone is not enough to recover a key.
export function encryptSecret(plaintext: string): string {
  const key = Buffer.from(getMasterKeyHex(), 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), encrypted.toString('base64'), authTag.toString('base64')].join(':');
}

export function decryptSecret(payload: string): string {
  const key = Buffer.from(getMasterKeyHex(), 'hex');
  const [ivB64, dataB64, tagB64] = payload.split(':');
  if (!ivB64 || !dataB64 || !tagB64) throw new Error('Malformed encrypted secret payload');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}
