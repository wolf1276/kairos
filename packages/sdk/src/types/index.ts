import { xdr } from '@stellar/stellar-sdk';

export interface NetworkConfig {
  rpcUrl: string;
  networkPassphrase: string;
}

export interface ContractConfig {
  delegationManager: string;
  smartWallet?: string;
  policyEngine: string;
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
