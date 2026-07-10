import { describe, expect, it } from 'vitest';
import { Account, Keypair, StrKey, xdr } from '@stellar/stellar-sdk';
import { DelegationModule } from './index';
import { KairosClient } from '../client';
import { RpcError } from '../errors';

// Regression tests for P1-E: DelegationModule.getNonce/get/getWalletDelegation previously
// treated a malformed simulation response (success flagged, but `result` missing — the same
// degraded-RPC-node scenario documented in ../registry/index.test.ts) the same as a confirmed
// negative answer (nonce 0, "not disabled", "no delegation"). For `get()` in particular that
// meant an ambiguous RPC response silently reported a delegation as NOT revoked.

const DELEGATOR = Keypair.random().publicKey();
const DELEGATE = Keypair.random().publicKey();

function makeClient(simulateTx: () => Promise<unknown>) {
  return {
    contracts: { delegationManager: StrKey.encodeContract(Buffer.alloc(32)) },
    networkPassphrase: 'Test SDF Network ; September 2015',
    getAccount: async () => new Account('GBKKNVTF24OKM2V7YRRQHLQIH6PTWDYRFMZPD6AUKB4RXAPSCRKB3XMO', '0'),
    hexToBytesN32ScVal: (hexStr: string) => xdr.ScVal.scvBytes(Buffer.from(hexStr.padEnd(64, '0'), 'hex')),
    simulateTx,
  } as unknown as KairosClient;
}

const malformedResponse = async () => ({
  latestLedger: 100,
  transactionData: {},
  // no `result` key at all
});

describe('DelegationModule fail-open regressions', () => {
  it('getNonce: malformed simulation response throws, never returns 0n', async () => {
    const delegation = new DelegationModule(makeClient(malformedResponse));
    await expect(delegation.getNonce(DELEGATOR)).rejects.toThrow(RpcError);
  });

  it('get: malformed simulation response throws, never reports disabled: false', async () => {
    const delegation = new DelegationModule(makeClient(malformedResponse));
    await expect(delegation.get('a'.repeat(64))).rejects.toThrow(RpcError);
  });

  it('get: a genuine successful simulation still reports the real disabled status', async () => {
    const delegation = new DelegationModule(
      makeClient(async () => ({
        result: { retval: xdr.ScVal.scvBool(true) },
        latestLedger: 100,
        transactionData: {},
      }))
    );
    await expect(delegation.get('a'.repeat(64))).resolves.toEqual({ disabled: true });
  });

  it('getWalletDelegation: malformed simulation response throws, never returns null', async () => {
    const delegation = new DelegationModule(makeClient(malformedResponse));
    await expect(delegation.getWalletDelegation(DELEGATOR, DELEGATE)).rejects.toThrow(RpcError);
  });

  it('getWalletDelegation: a genuine scvVoid result still returns null (no delegation)', async () => {
    const delegation = new DelegationModule(
      makeClient(async () => ({
        result: { retval: xdr.ScVal.scvVoid() },
        latestLedger: 100,
        transactionData: {},
      }))
    );
    await expect(delegation.getWalletDelegation(DELEGATOR, DELEGATE)).resolves.toBeNull();
  });
});
