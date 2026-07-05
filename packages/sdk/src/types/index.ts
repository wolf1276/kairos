import { Keypair, xdr } from '@stellar/stellar-sdk';

/**
 * A signer whose private key never lives in this process — e.g. an MPC/HSM-backed key
 * (Turnkey, Fireblocks, etc.). `sign` returns the raw 64-byte Ed25519 signature over
 * `payload` (the transaction's signature-base hash); the caller wraps it in the XDR
 * `DecoratedSignature` structure Stellar transactions require. Mirrors the subset of
 * `Keypair` that transaction signing needs, but async — remote signing is a network call.
 */
export interface RemoteSigner {
  /** The signer's Stellar account id (G...). Must be synchronous like `Keypair.publicKey()`. */
  publicKey(): string;
  /** Signs `payload` and resolves to the raw 64-byte Ed25519 signature. */
  sign(payload: Buffer): Promise<Buffer>;
}

/** Anything that can authorize a transaction: a local `Keypair`, or a `RemoteSigner`
 * (MPC/HSM-backed) that signs out-of-process. */
export type Signer = Keypair | RemoteSigner;

export function isRemoteSigner(signer: Signer): signer is RemoteSigner {
  return !(signer instanceof Keypair);
}

export interface NetworkConfig {
  rpcUrl: string;
  networkPassphrase: string;
}

export interface ContractConfig {
  delegationManager: string;
  smartWallet?: string;
  policyEngine: string;
  registry?: string;
}

export interface Caveat {
  enforcer: string;
  terms: Uint8Array;
}

export interface Delegation {
  delegate: string;
  delegator: string;
  authority: string;
  caveats: Caveat[];
  salt: bigint;
  nonce: bigint;
  signature: string;
}

export interface Execution {
  target: string;
  function: string;
  args: xdr.ScVal[];
}

export interface ExecutionContext {
  target: string;
  function: string;
  args: xdr.ScVal[];
  redeemer: string;
  delegate: string;
  delegator: string;
  ledger_sequence: number;
  timestamp: bigint;
}

export interface Wallet {
  address: string;
  owner: string;
  delegationManager: string;
}

export interface Policy {
  type: 'spend-limit' | 'time-restriction' | 'target-whitelist';
  terms: Uint8Array;
}

export interface TransactionResult {
  hash: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  ledger?: number;
  resultXdr?: string;
  error?: string;
}
