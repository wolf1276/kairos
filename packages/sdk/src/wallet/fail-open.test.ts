import { describe, expect, it } from 'vitest';
import { Account, Keypair, StrKey, xdr } from '@stellar/stellar-sdk';
import { WalletModule } from './index';
import { KairosClient } from '../client';
import { RpcError } from '../errors';

// Regression test for P1-E: WalletModule.balance previously treated a malformed simulation
// response (missing `result`) the same as a confirmed zero balance.

const ADDRESS = Keypair.random().publicKey();
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 1));

function makeClient(simulateTx: () => Promise<unknown>) {
  return {
    contracts: {},
    networkPassphrase: 'Test SDF Network ; September 2015',
    getAccount: async () => new Account('GBKKNVTF24OKM2V7YRRQHLQIH6PTWDYRFMZPD6AUKB4RXAPSCRKB3XMO', '0'),
    simulateTx,
  } as unknown as KairosClient;
}

describe('WalletModule.balance fail-open regression', () => {
  it('malformed simulation response throws, never returns 0n', async () => {
    const wallet = new WalletModule(
      makeClient(async () => ({
        latestLedger: 100,
        transactionData: {},
        // no `result` key at all
      }))
    );
    await expect(wallet.balance(ADDRESS, TOKEN)).rejects.toThrow(RpcError);
  });

  it('a genuine successful simulation still returns the real balance', async () => {
    const wallet = new WalletModule(
      makeClient(async () => ({
        result: { retval: xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: xdr.Int64.fromString('0'), lo: xdr.Uint64.fromString('42') })) },
        latestLedger: 100,
        transactionData: {},
      }))
    );
    await expect(wallet.balance(ADDRESS, TOKEN)).resolves.toBe(42n);
  });
});
