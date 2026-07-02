import { Keypair } from '@stellar/stellar-sdk';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface KeystoreFile {
  publicKey: string;
  secretKey: string;
}

function defaultKeystorePath(): string {
  return process.env.KAIROS_AGENT_KEYSTORE_PATH || path.join(os.homedir(), '.kairos', 'agent-session.json');
}

/**
 * Loads the agent's ephemeral session keypair, generating and persisting one on first
 * run. The secret never leaves this local file/process — only the public key is ever
 * meant to cross the trust boundary into the dashboard (via `keygen`).
 */
export function loadOrCreateSessionKeypair(): Keypair {
  const envSecret = process.env.KAIROS_AGENT_SECRET_KEY;
  if (envSecret) {
    return Keypair.fromSecret(envSecret);
  }

  const keystorePath = defaultKeystorePath();
  if (fs.existsSync(keystorePath)) {
    const raw = fs.readFileSync(keystorePath, 'utf8');
    const parsed = JSON.parse(raw) as KeystoreFile;
    return Keypair.fromSecret(parsed.secretKey);
  }

  const keypair = Keypair.random();
  const dir = path.dirname(keystorePath);
  fs.mkdirSync(dir, { recursive: true });
  const contents: KeystoreFile = {
    publicKey: keypair.publicKey(),
    secretKey: keypair.secret(),
  };
  fs.writeFileSync(keystorePath, JSON.stringify(contents, null, 2), { mode: 0o600 });
  return keypair;
}
