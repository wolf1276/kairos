import { describe, expect, it, vi } from 'vitest';
import { Account, Keypair, StrKey, xdr } from '@stellar/stellar-sdk';
import { RegistryModule } from './index';
import { KairosClient } from '../client';
import { RpcError, TransactionSimulationError } from '../errors';

// Regression tests for the Registry-lookup fail-open bug: `getSmartWallet` must distinguish
// "the contract confirmed no registration" (a real `null`) from "we couldn't find out" (RPC
// failure, network error, simulation failure, timeout — all of which must throw). Collapsing
// the latter into `null` makes apps/web/app/api/connect/check/route.ts tell an existing owner
// their wallet doesn't exist, which is a fail-open security bug (see that route + its tests).

const OWNER = Keypair.random().publicKey();
const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32));

function makeClient(overrides: { getAccount?: () => Promise<Account>; simulateTx?: () => Promise<unknown> }) {
  return {
    contracts: { registry: CONTRACT_ID },
    networkPassphrase: 'Test SDF Network ; September 2015',
    getAccount:
      overrides.getAccount ??
      (async () => new Account('GBKKNVTF24OKM2V7YRRQHLQIH6PTWDYRFMZPD6AUKB4RXAPSCRKB3XMO', '0')),
    simulateTx: overrides.simulateTx,
  } as unknown as KairosClient;
}

function scvVoidResult() {
  return {
    result: { retval: xdr.ScVal.scvVoid() },
    latestLedger: 100,
    transactionData: {},
  };
}

function scAddressResult(address: string) {
  const { Address } = require('@stellar/stellar-sdk');
  return {
    result: { retval: Address.fromString(address).toScVal() },
    latestLedger: 100,
    transactionData: {},
  };
}

describe('RegistryModule.getSmartWallet', () => {
  it('wallet found: returns the on-chain smart wallet address', async () => {
    const smartWallet = StrKey.encodeContract(Buffer.alloc(32, 1));
    const client = makeClient({ simulateTx: async () => scAddressResult(smartWallet) });
    const registry = new RegistryModule(client);

    await expect(registry.getSmartWallet(OWNER)).resolves.toBe(smartWallet);
  });

  it('wallet not found: a successful simulation with scvVoid returns null (not an error)', async () => {
    const client = makeClient({ simulateTx: async () => scvVoidResult() });
    const registry = new RegistryModule(client);

    await expect(registry.getSmartWallet(OWNER)).resolves.toBeNull();
  });

  it('RPC failure during simulation throws, never returns null', async () => {
    const client = makeClient({
      simulateTx: async () => {
        throw new RpcError('connection refused');
      },
    });
    const registry = new RegistryModule(client);

    await expect(registry.getSmartWallet(OWNER)).rejects.toThrow(RpcError);
  });

  it('simulation failure (contract trap / non-success response) throws, never returns null', async () => {
    const client = makeClient({
      simulateTx: async () => {
        throw new TransactionSimulationError('Transaction simulation failed: HostError', {});
      },
    });
    const registry = new RegistryModule(client);

    await expect(registry.getSmartWallet(OWNER)).rejects.toThrow(TransactionSimulationError);
  });

  it('network timeout throws, never returns null', async () => {
    const client = makeClient({
      simulateTx: async () => {
        throw new Error('fetch failed: ETIMEDOUT');
      },
    });
    const registry = new RegistryModule(client);

    const err = await registry.getSmartWallet(OWNER).catch((e) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as Error).message).toContain('ETIMEDOUT');
  });

  it('getAccount failure (RPC unavailable while building the lookup tx) throws, never returns null', async () => {
    const client = makeClient({
      getAccount: async () => {
        throw new Error('network unreachable');
      },
      simulateTx: async () => scvVoidResult(),
    });
    // getAccount itself doesn't throw in the real client (it swallows to a bare account), but if
    // some other step in tx-building throws for a network reason, it must still surface as an
    // explicit error rather than a `null` "not registered" verdict.
    const registry = new RegistryModule(client);
    await expect(registry.getSmartWallet(OWNER)).rejects.toThrow(RpcError);
  });
});
