// NOTE: this wraps `@turnkey/http`'s generated activity client. The exact response field
// names below (`createPrivateKeysResultV2`, `signRawPayloadResult.{r,s}`, etc.) match
// Turnkey's public API as of this writing — if you bump `@turnkey/http`, diff its generated
// types against this file before deploying, since Turnkey occasionally renames activity
// result fields across versions.
import * as fs from 'fs';
import { StrKey } from '@stellar/stellar-sdk';
import type { RemoteSigner } from '@wolf1276/kairos-sdk';
import { TurnkeyClient } from '@turnkey/http';
import { ApiKeyStamper } from '@turnkey/api-key-stamper';

export interface TurnkeyCredentials {
  /** Turnkey API key public key (P-256), used to stamp/authenticate every request. */
  apiPublicKey: string;
  /** Turnkey API key private key. This is the one local secret in this design — it
   * authenticates to Turnkey's MPC cluster but cannot, by itself, reconstruct any agent's
   * Ed25519 private key. Keep it out of source control (see `.gitignore`). */
  apiPrivateKey: string;
  /** The Turnkey (sub-)organization all agent keys are created under. */
  organizationId: string;
  baseUrl?: string;
}

/**
 * Loads Turnkey credentials from environment variables, or from a JSON file (the shape
 * Turnkey's dashboard exports, e.g. `{ apiKeyName, publicKey, privateKey }`) pointed to by
 * `TURNKEY_CREDENTIALS_FILE` / `path`. `TURNKEY_ORGANIZATION_ID` is required either way —
 * it isn't part of the exported API-key file.
 */
export function loadTurnkeyCredentials(path?: string): TurnkeyCredentials {
  const organizationId = process.env.TURNKEY_ORGANIZATION_ID;
  if (!organizationId) {
    throw new Error('Missing env var: TURNKEY_ORGANIZATION_ID');
  }
  const baseUrl = process.env.TURNKEY_BASE_URL || undefined;

  const credsFile = path || process.env.TURNKEY_CREDENTIALS_FILE;
  if (credsFile) {
    const raw = JSON.parse(fs.readFileSync(credsFile, 'utf8')) as { publicKey: string; privateKey: string };
    if (!raw.publicKey || !raw.privateKey) {
      throw new Error(`Turnkey credentials file ${credsFile} is missing "publicKey"/"privateKey"`);
    }
    return { apiPublicKey: raw.publicKey, apiPrivateKey: raw.privateKey, organizationId, baseUrl };
  }

  const apiPublicKey = process.env.TURNKEY_API_PUBLIC_KEY;
  const apiPrivateKey = process.env.TURNKEY_API_PRIVATE_KEY;
  if (!apiPublicKey || !apiPrivateKey) {
    throw new Error(
      'Missing Turnkey API key: set TURNKEY_CREDENTIALS_FILE (path to the exported key JSON) ' +
        'or both TURNKEY_API_PUBLIC_KEY and TURNKEY_API_PRIVATE_KEY.'
    );
  }
  return { apiPublicKey, apiPrivateKey, organizationId, baseUrl };
}

export function createTurnkeyClient(creds: TurnkeyCredentials): TurnkeyClient {
  const stamper = new ApiKeyStamper({ apiPublicKey: creds.apiPublicKey, apiPrivateKey: creds.apiPrivateKey });
  return new TurnkeyClient({ baseUrl: creds.baseUrl || 'https://api.turnkey.com' }, stamper);
}

export interface TurnkeyAgentKey {
  privateKeyId: string;
  /** Stellar G... address derived from the key's raw Ed25519 public key. */
  publicKey: string;
}

/**
 * Creates a brand-new Ed25519 private key inside Turnkey's MPC cluster for one agent
 * identity. The key material is generated and held as secret shares across Turnkey's
 * signers — it is never reconstructed in, or transmitted to, this process. Only the
 * resulting `privateKeyId` (an opaque handle used for future sign requests) and the
 * derived Stellar public key ever leave Turnkey.
 */
export async function createTurnkeyAgentKey(
  client: TurnkeyClient,
  organizationId: string,
  agentLabel: string
): Promise<TurnkeyAgentKey> {
  const activity = await client.createPrivateKeys({
    type: 'ACTIVITY_TYPE_CREATE_PRIVATE_KEYS_V2',
    timestampMs: String(Date.now()),
    organizationId,
    parameters: {
      privateKeys: [
        {
          privateKeyName: `kairos-agent-${agentLabel}-${Date.now()}`,
          curve: 'CURVE_ED25519',
          addressFormats: [],
          privateKeyTags: [],
        },
      ],
    },
  });

  const created = activity.activity.result.createPrivateKeysResultV2?.privateKeys?.[0];
  if (!created?.privateKeyId) {
    throw new Error(
      `Turnkey did not return a privateKeyId for agent "${agentLabel}": ${JSON.stringify(activity.activity.result)}`
    );
  }

  const publicKey = await getTurnkeyStellarPublicKey(client, organizationId, created.privateKeyId);
  return { privateKeyId: created.privateKeyId, publicKey };
}

/** Reads a Turnkey private key's raw Ed25519 public key and encodes it as a Stellar G... address. */
export async function getTurnkeyStellarPublicKey(
  client: TurnkeyClient,
  organizationId: string,
  privateKeyId: string
): Promise<string> {
  const { privateKey } = await client.getPrivateKey({ organizationId, privateKeyId });
  const rawPublicKeyHex = privateKey.publicKey;
  if (!rawPublicKeyHex) {
    throw new Error(`Turnkey private key ${privateKeyId} has no public key`);
  }
  return StrKey.encodeEd25519PublicKey(Buffer.from(rawPublicKeyHex, 'hex'));
}

/**
 * A `RemoteSigner` (see `@wolf1276/kairos-sdk`) backed by one Turnkey-held Ed25519 private
 * key. Every `sign()` call is a network round-trip to Turnkey's MPC signing cluster — the
 * private key itself never exists assembled anywhere, including in this process's memory.
 * Drop-in wherever the SDK accepts a `Signer` (e.g. `client.execution.execute({ redeemer })`,
 * `client.submitTransaction(tx, signer)`).
 */
export class TurnkeySigner implements RemoteSigner {
  private constructor(
    private readonly client: TurnkeyClient,
    private readonly organizationId: string,
    private readonly privateKeyId: string,
    private readonly stellarPublicKey: string
  ) {}

  static async forExistingKey(
    client: TurnkeyClient,
    organizationId: string,
    privateKeyId: string
  ): Promise<TurnkeySigner> {
    const stellarPublicKey = await getTurnkeyStellarPublicKey(client, organizationId, privateKeyId);
    return new TurnkeySigner(client, organizationId, privateKeyId, stellarPublicKey);
  }

  static async forNewAgent(client: TurnkeyClient, organizationId: string, agentLabel: string): Promise<TurnkeySigner> {
    const { privateKeyId, publicKey } = await createTurnkeyAgentKey(client, organizationId, agentLabel);
    return new TurnkeySigner(client, organizationId, privateKeyId, publicKey);
  }

  get id(): string {
    return this.privateKeyId;
  }

  publicKey(): string {
    return this.stellarPublicKey;
  }

  /**
   * Signs `payload` (a transaction's 32-byte signature-base hash) via Turnkey's raw
   * payload signing activity. `hashFunction: 'HASH_FUNCTION_NOT_APPLICABLE'` tells Turnkey
   * to sign the given bytes directly — Stellar has already hashed the signature base, and
   * Ed25519 signs the message as-is rather than a digest of it.
   */
  async sign(payload: Buffer): Promise<Buffer> {
    const activity = await this.client.signRawPayload({
      type: 'ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2',
      timestampMs: String(Date.now()),
      organizationId: this.organizationId,
      parameters: {
        signWith: this.privateKeyId,
        payload: payload.toString('hex'),
        encoding: 'PAYLOAD_ENCODING_HEXADECIMAL',
        hashFunction: 'HASH_FUNCTION_NOT_APPLICABLE',
      },
    });

    const result = activity.activity.result.signRawPayloadResult;
    if (!result?.r || !result?.s) {
      throw new Error(
        `Turnkey did not return an Ed25519 signature for key ${this.privateKeyId}: ${JSON.stringify(activity.activity.result)}`
      );
    }
    // Ed25519 signatures are R (32 bytes) || S (32 bytes) = 64 bytes total; Turnkey's
    // sign-raw-payload result splits them the same way for every curve it supports.
    const signature = Buffer.concat([Buffer.from(result.r, 'hex'), Buffer.from(result.s, 'hex')]);
    if (signature.length !== 64) {
      throw new Error(`Unexpected Turnkey Ed25519 signature length: ${signature.length} bytes (expected 64)`);
    }
    return signature;
  }
}
