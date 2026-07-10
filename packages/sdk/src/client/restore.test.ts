import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  Account,
  Address,
  Keypair,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { KairosClient } from './index';

// P1-C reproduction: when simulation reports that a touched ledger entry has been archived
// (TTL expired), `submitTransaction` must restore the footprint and retry — not fail. This is
// the live agent path (backend tick -> execution.execute -> submitTransaction), so a failure
// here means an agent whose smart-wallet/SAC/delegation storage archives is stuck permanently.

const CONTRACT = 'CCGZ3IDTERFBQYVGHGNUI46R4HMSEJMJ2LXYQD5A2GXU6DA6INNKBTGL';

// Consumed only by the fix (restore branch), so parsed shape (SorobanDataBuilder) is fine.
function restoreSim() {
  return {
    transactionData: new SorobanDataBuilder(),
    minResourceFee: '100',
    result: { auth: [], retval: xdr.ScVal.scvVoid() },
    events: [],
    latestLedger: 100,
    restorePreamble: {
      minResourceFee: '200',
      transactionData: new SorobanDataBuilder(),
    },
  };
}

// Already-parsed (`_parsed`) success response, used as-is by rpc.assembleTransaction.
function successSim() {
  return {
    _parsed: true,
    transactionData: new SorobanDataBuilder(),
    minResourceFee: '100',
    result: { auth: [], retval: xdr.ScVal.scvVoid() },
    events: [],
    latestLedger: 100,
  };
}

describe('submitTransaction archived-footprint restore (P1-C)', () => {
  const signer = Keypair.random();
  let client: KairosClient;

  function buildTx(): any {
    const account = new Account(signer.publicKey(), '5');
    const op = Operation.invokeContractFunction({
      contract: CONTRACT,
      function: 'transfer',
      args: [Address.fromString(signer.publicKey()).toScVal()],
    });
    return new TransactionBuilder(account, { fee: '100000', networkPassphrase: client.networkPassphrase })
      .addOperation(op)
      .setTimeout(30)
      .build();
  }

  beforeEach(() => {
    client = new KairosClient({ network: 'testnet', contracts: { delegationManager: CONTRACT } as any });
    vi.spyOn(client.rpcProvider, 'getAccount').mockResolvedValue(new Account(signer.publicKey(), '5'));
    vi.spyOn(client, 'pollTransaction').mockResolvedValue({ hash: 'POLLED', status: 'SUCCESS' } as any);
  });

  it('restores the archived footprint, then submits the real transaction', async () => {
    const simulate = vi
      .spyOn(client.rpcProvider, 'simulateTransaction')
      .mockResolvedValueOnce(restoreSim() as any)
      .mockResolvedValueOnce(successSim() as any);
    const send = vi
      .spyOn(client.rpcProvider, 'sendTransaction')
      .mockResolvedValueOnce({ status: 'PENDING', hash: 'RESTORE_HASH' } as any)
      .mockResolvedValueOnce({ status: 'PENDING', hash: 'REAL_HASH' } as any);

    const result = await client.submitTransaction(buildTx(), signer);

    // A restore transaction (restoreFootprint op) must be sent first, then the real invoke.
    expect(send).toHaveBeenCalledTimes(2);
    const restoreTx = send.mock.calls[0][0] as any;
    expect(restoreTx.operations[0].type).toBe('restoreFootprint');
    expect(simulate).toHaveBeenCalledTimes(2); // detect archived, then re-simulate live
    expect(result.status).toBe('SUCCESS');
  });

  it('returns FAILED (does not submit the real tx) when the restore itself fails', async () => {
    vi.spyOn(client.rpcProvider, 'simulateTransaction').mockResolvedValueOnce(restoreSim() as any);
    const send = vi
      .spyOn(client.rpcProvider, 'sendTransaction')
      .mockResolvedValueOnce({ status: 'ERROR', hash: 'RESTORE_HASH' } as any);

    const result = await client.submitTransaction(buildTx(), signer);

    expect(send).toHaveBeenCalledTimes(1); // only the restore attempt; never the real invoke
    expect(result.status).toBe('FAILED');
  });
});
