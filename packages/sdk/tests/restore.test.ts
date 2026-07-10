import { describe, expect, it, vi } from 'vitest';
import { Account, Keypair, Operation, rpc, SorobanDataBuilder, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { KairosClient } from '../src/client';
import { TransactionSimulationError } from '../src/errors';
import type { Signer } from '../src/types';

const mockContracts = {
  delegationManager: 'CCGZ3IDTERFBQYVGHGNUI46R4HMSEJMJ2LXYQD5A2GXU6DA6INNKBTGL',
  policyEngine: 'CAMFIEJACX5BJSJ4YIDNPWSNHTEWHHZSODQFQ4JZ32W7LVAW46LDYVQ6',
  smartWallet: 'CB4DP5NR67AZAH4FMB4TLAJ2LLOEOLZ5Z3FMDODHR23AUM22ZWLYBU72',
};

function restoreResponse() {
  return {
    transactionData: new SorobanDataBuilder(),
    minResourceFee: '100',
    restorePreamble: {
      minResourceFee: '100',
      transactionData: new SorobanDataBuilder(),
    },
    latestLedger: 100,
    events: [],
    _parsed: true,
  };
}

function successResponse() {
  return {
    transactionData: new SorobanDataBuilder(),
    minResourceFee: '100',
    result: {
      auth: [],
      retval: xdr.ScVal.scvVoid(),
    },
    latestLedger: 100,
    events: [],
    _parsed: true,
  };
}

function errorResponse(error: string) {
  return {
    error,
    latestLedger: 100,
    events: [],
    _parsed: true,
  };
}

function dummyTx(client: KairosClient): Transaction {
  const acct = new Account(
    'GBKKNVTF24OKM2V7YRRQHLQIH6PTWDYRFMZPD6AUKB4RXAPSCRKB3XMO',
    '0',
  );
  return new TransactionBuilder(acct, {
    fee: '100',
    networkPassphrase: client.networkPassphrase,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: client.contracts.delegationManager,
        function: 'get_nonce',
        args: [],
      }),
    )
    .setTimeout(30)
    .build();
}

function makeSigner(): Signer {
  const kp = Keypair.random();
  return {
    publicKey: () => kp.publicKey(),
    sign: async (payload: Buffer) => kp.sign(payload),
  };
}

describe('simulateTx — archived entry detection', () => {
  it('throws TransactionSimulationError on restore response', async () => {
    const client = new KairosClient({ network: 'testnet', contracts: mockContracts });
    (client.rpcProvider as any).simulateTransaction = vi.fn().mockResolvedValue(restoreResponse());

    const tx = dummyTx(client);
    await expect(client.simulateTx(tx)).rejects.toThrow(TransactionSimulationError);
  });

  it('returns response on successful simulation', async () => {
    const client = new KairosClient({ network: 'testnet', contracts: mockContracts });
    (client.rpcProvider as any).simulateTransaction = vi.fn().mockResolvedValue(successResponse());

    const tx = dummyTx(client);
    const result = await client.simulateTx(tx);

    expect(rpc.Api.isSimulationSuccess(result)).toBe(true);
    expect(rpc.Api.isSimulationRestore(result)).toBe(false);
  });

  it('throws TransactionSimulationError on simulation error', async () => {
    const client = new KairosClient({ network: 'testnet', contracts: mockContracts });
    (client.rpcProvider as any).simulateTransaction = vi.fn().mockResolvedValue(errorResponse('HostError'));

    const tx = dummyTx(client);
    await expect(client.simulateTx(tx)).rejects.toThrow(TransactionSimulationError);
  });

  it('prefers restore detection over success when both match', async () => {
    const client = new KairosClient({ network: 'testnet', contracts: mockContracts });

    // A restore response matches BOTH isSimulationRestore AND isSimulationSuccess.
    // simulateTx must throw, not silently return success.
    (client.rpcProvider as any).simulateTransaction = vi.fn().mockResolvedValue(restoreResponse());

    const tx = dummyTx(client);
    const err = await client.simulateTx(tx).catch((e) => e);
    expect(err).toBeInstanceOf(TransactionSimulationError);
    expect((err as Error).message).toContain('restoration');
  });
});

describe('submitTransaction — restore and retry', () => {
  function mockAll(client: KairosClient, overrides: {
    simulateCalls?: Array<() => any | Promise<any>>;
    sendTransactionResult?: any;
    pollResult?: any;
  } = {}) {
    let callIndex = 0;
    if (overrides.simulateCalls) {
      vi.spyOn(client, 'simulateTx').mockImplementation(async () => {
        const fn = overrides.simulateCalls![callIndex];
        callIndex++;
        return fn();
      });
    }
    const defaultAccount = new Account(
      'GBKKNVTF24OKM2V7YRRQHLQIH6PTWDYRFMZPD6AUKB4RXAPSCRKB3XMO',
      '1',
    );
    vi.spyOn(client, 'waitForAccount').mockResolvedValue(defaultAccount);
    vi.spyOn(client, 'pollTransaction').mockResolvedValue(
      overrides.pollResult ?? {
        hash: '0'.repeat(64),
        status: 'SUCCESS',
        resultXdr: 'AAAA',
      },
    );
    (client.rpcProvider as any).sendTransaction = vi
      .fn()
      .mockResolvedValue(
        overrides.sendTransactionResult ?? {
          status: 'PENDING',
          hash: '0'.repeat(64),
        },
      );
  }

  it('returns FAILED when simulation throws a non-restore error', async () => {
    const client = new KairosClient({ network: 'testnet', contracts: mockContracts });
    mockAll(client, {
      simulateCalls: [
        () => { throw new TransactionSimulationError('RPC unreachable', undefined); },
      ],
    });

    const tx = dummyTx(client);
    const result = await client.submitTransaction(tx, makeSigner());

    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('RPC unreachable');
  });

  it('normal invocation (no restore needed) succeeds', async () => {
    const client = new KairosClient({ network: 'testnet', contracts: mockContracts });

    mockAll(client, {
      simulateCalls: [
        () => successResponse(),
      ],
    });

    const tx = dummyTx(client);
    const result = await client.submitTransaction(tx, makeSigner());

    expect(result.status).toBe('SUCCESS');
    expect(result.hash).toBe('0'.repeat(64));
  });

  it('restore-during-submission surfaces restore failure clearly', async () => {
    const client = new KairosClient({ network: 'testnet', contracts: mockContracts });

    mockAll(client, {
      simulateCalls: [
        () => { throw new TransactionSimulationError(
          'Transaction simulation requires storage restoration (restore transaction needed)',
          restoreResponse(),
        ); },
      ],
      sendTransactionResult: {
        status: 'ERROR',
        hash: 'restore-failed-hash',
      },
    });

    const tx = dummyTx(client);
    const result = await client.submitTransaction(tx, makeSigner());

    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('Restore transaction failed');
  });

  it('successful restore then retry succeeds', async () => {
    const client = new KairosClient({ network: 'testnet', contracts: mockContracts });

    mockAll(client, {
      simulateCalls: [
        () => { throw new TransactionSimulationError(
          'Transaction simulation requires storage restoration (restore transaction needed)',
          restoreResponse(),
        ); },
        () => successResponse(),
      ],
    });

    const tx = dummyTx(client);
    const result = await client.submitTransaction(tx, makeSigner());

    expect(result.status).toBe('SUCCESS');
  });

  it('retry after restore with simulation error returns FAILED', async () => {
    const client = new KairosClient({ network: 'testnet', contracts: mockContracts });

    mockAll(client, {
      simulateCalls: [
        () => { throw new TransactionSimulationError(
          'Transaction simulation requires storage restoration (restore transaction needed)',
          restoreResponse(),
        ); },
        () => { throw new TransactionSimulationError('HostError on retry', {}); },
      ],
    });

    const tx = dummyTx(client);
    const result = await client.submitTransaction(tx, makeSigner());

    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('HostError on retry');
  });
});

describe('simulation error propagation', () => {
  it('simulateTx passes through HostError as TransactionSimulationError', async () => {
    const client = new KairosClient({ network: 'testnet', contracts: mockContracts });
    (client.rpcProvider as any).simulateTransaction = vi
      .fn()
      .mockResolvedValue(errorResponse('HostError: contract error'));

    const tx = dummyTx(client);
    await expect(client.simulateTx(tx)).rejects.toThrow(
      TransactionSimulationError,
    );
  });

  it('simulateTx passes through RPC-level errors as TransactionSimulationError', async () => {
    const client = new KairosClient({ network: 'testnet', contracts: mockContracts });
    (client.rpcProvider as any).simulateTransaction = vi
      .fn()
      .mockResolvedValue(errorResponse('Contract error: before_hook error'));

    const tx = dummyTx(client);
    await expect(client.simulateTx(tx)).rejects.toThrow(
      TransactionSimulationError,
    );
  });
});
