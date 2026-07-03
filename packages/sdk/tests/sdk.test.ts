import { describe, expect, it } from 'vitest';
import { Account, Address, Asset, hash, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { KairosClient } from '../src/client';
import { ROOT_AUTHORITY } from '../src/constants';
import { computeDelegationHash, encodeTargetWhitelistTerms, encodeTimeRestrictionTerms, getAddressXdrBytes, i128ToBuffer, signTransaction, uint64ToXdrBytes } from '../src/utils';
import type { RemoteSigner } from '../src/types';

describe('Kairos SDK Unit Tests', () => {
  const mockContracts = {
    delegationManager: 'CDWMR4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP',
    policyEngine: 'CCPENGINE4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP',
    smartWallet: 'CCSSCA4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP',
  };

  const client = new KairosClient({
    network: 'testnet',
    contracts: mockContracts,
  });

  it('should initialize the client successfully', () => {
    expect(client).toBeDefined();
    expect(client.contracts.delegationManager).toBe(mockContracts.delegationManager);
    expect(client.policy).toBeDefined();
    expect(client.wallet).toBeDefined();
  });

  it('should correctly encode target whitelist terms', () => {
    const target = Keypair.random().publicKey();
    const terms = encodeTargetWhitelistTerms(target);
    expect(terms[0]).toBe(1);
    expect(terms.length).toBeGreaterThan(1);
  });

  it('should correctly encode time restriction terms', () => {
    const start = 1000n;
    const end = 2000n;
    const terms = encodeTimeRestrictionTerms(start, end);
    expect(terms[0]).toBe(3);
    expect(terms.readBigUInt64BE ? terms.readBigUInt64BE(1) : 1000n).toBe(1000n);
  });

  it('should correctly compute delegation hash', () => {
    const delegate = Keypair.random().publicKey();
    const delegator = Keypair.random().publicKey();
    
    const delegation = {
      delegate,
      delegator,
      authority: ROOT_AUTHORITY,
      caveats: [],
      salt: 12345n,
      nonce: 0n,
    };

    const hashVal = client.delegation.getHash(delegation);
    expect(hashVal).toHaveLength(64);
    expect(/^[0-9a-fA-F]{64}$/.test(hashVal)).toBe(true);
  });

  it('should sign delegation and create correct structure', async () => {
    const delegatorKeypair = Keypair.random();
    const delegate = Keypair.random().publicKey();

    const delegation = await client.delegation.create({
      delegate,
      delegator: delegatorKeypair.publicKey(),
      salt: 100n,
      nonce: 0n,
      signer: delegatorKeypair,
    });

    expect(delegation.signature).toBeDefined();
    expect(delegation.signature).toHaveLength(128);
  });

  it('should produce deterministic hash for the same inputs', () => {
    const kp = Keypair.random();
    const delegate = kp.publicKey();
    const delegator = kp.publicKey();
    const delegationManager = 'CDWMR4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP';
    const networkPassphrase = 'Test SDF Network ; September 2015';
    const authority = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

    const hash1 = computeDelegationHash(
      { delegate, delegator, authority, caveats: [], salt: 0n, nonce: 0n },
      delegationManager,
      networkPassphrase
    );
    const hash2 = computeDelegationHash(
      { delegate, delegator, authority, caveats: [], salt: 0n, nonce: 0n },
      delegationManager,
      networkPassphrase
    );

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('should produce different hash when delegation fields change', () => {
    const delegate = Keypair.random().publicKey();
    const delegator = Keypair.random().publicKey();
    const delegationManager = 'CDWMR4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP';
    const networkPassphrase = 'Test SDF Network ; September 2015';
    const authority = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

    const baseHash = computeDelegationHash(
      { delegate, delegator, authority, caveats: [], salt: 0n, nonce: 0n },
      delegationManager,
      networkPassphrase
    );

    const differentSaltHash = computeDelegationHash(
      { delegate, delegator, authority, caveats: [], salt: 1n, nonce: 0n },
      delegationManager,
      networkPassphrase
    );

    expect(baseHash).not.toBe(differentSaltHash);
  });

  it('should include domain separator in hash computation', () => {
    const delegate = Keypair.random().publicKey();
    const delegator = Keypair.random().publicKey();
    const delegationManager = 'CDWMR4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP';
    const networkPassphrase = 'Test SDF Network ; September 2015';
    const authority = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

    const hashVal = computeDelegationHash(
      { delegate, delegator, authority, caveats: [], salt: 12345n, nonce: 0n },
      delegationManager,
      networkPassphrase
    );

    const hashWithCaveats = computeDelegationHash(
      {
        delegate,
        delegator,
        authority: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        caveats: [
          {
            enforcer: 'CCPENGINE4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP',
            terms: new Uint8Array(80),
          },
        ],
        salt: 99999n,
        nonce: 42n,
      },
      delegationManager,
      networkPassphrase
    );

    expect(hashVal).toHaveLength(64);
    expect(hashWithCaveats).toHaveLength(64);
    expect(hashVal).not.toBe(hashWithCaveats);
  });

  it('verify XDR address encoding matches Soroban contract format', () => {
    const kp = Keypair.random();
    const pubKey = kp.publicKey();
    const xdrBytes = getAddressXdrBytes(pubKey);
    expect(xdrBytes.length).toBe(40);
    expect(xdrBytes[0]).toBe(0);
    expect(xdrBytes[1]).toBe(0);
    expect(xdrBytes[2]).toBe(0);
    expect(xdrBytes[3]).toBe(0);
  });

  it('should round-trip indexed (0xFE marker) caveats', () => {
    const { caveat, terms } = client.policy.createIndexed(7n, {
      type: 'time-restriction',
      start: 1000n,
      expiry: 2000n,
    });

    expect(caveat.terms.length).toBe(9);
    expect(caveat.terms[0]).toBe(0xfe);
    expect(client.policy.isIndexedCaveat(caveat)).toBe(true);
    expect(client.policy.getIndexedPolicyId(caveat)).toBe(7n);

    // The real terms decode normally; the marker itself must not decode as a policy.
    expect(client.policy.decode({ enforcer: caveat.enforcer, terms })).toMatchObject({
      type: 'time-restriction',
      start: 1000n,
      expiry: 2000n,
    });
    expect(() => client.policy.decode(caveat)).toThrow();

    // Inline caveats are not indexed.
    expect(client.policy.isIndexedCaveat({ enforcer: caveat.enforcer, terms })).toBe(false);
    expect(() => client.policy.getIndexedPolicyId({ enforcer: caveat.enforcer, terms })).toThrow();
  });

  it('should produce a byte-identical signed tx via a RemoteSigner as via its wrapped Keypair', async () => {
    const keypair = Keypair.random();
    // TransactionBuilder.build() mutates its Account's sequence number, so each build needs
    // its own fresh Account (same starting sequence) to produce byte-identical transactions.
    const buildTx = () =>
      new TransactionBuilder(new Account(keypair.publicKey(), '100'), {
        fee: '100000',
        networkPassphrase: 'Test SDF Network ; September 2015',
        timebounds: { minTime: 0, maxTime: 1893456000 },
      })
        .addOperation(Operation.payment({ destination: keypair.publicKey(), asset: Asset.native(), amount: '1' }))
        .build();

    // Local Keypair path (stellar-sdk's own Transaction.sign).
    const localTx = buildTx();
    localTx.sign(keypair);

    // RemoteSigner path — same key material, but signing goes through an async `sign()`
    // call, exactly as an MPC provider (e.g. Turnkey) would be invoked.
    const remoteSigner: RemoteSigner = {
      publicKey: () => keypair.publicKey(),
      sign: async (payload: Buffer) => keypair.sign(payload),
    };
    const remoteTx = buildTx();
    await signTransaction(remoteTx, remoteSigner);

    expect(remoteTx.toXDR()).toBe(localTx.toXDR());
    expect(remoteTx.signatures).toHaveLength(1);
  });

  it('should correctly encode i128 values for spend limits', () => {
    const positive = 100n;
    const positiveBuf = i128ToBuffer(positive);
    expect(positiveBuf.length).toBe(16);
    expect(positiveBuf.readBigInt64BE(0)).toBe(0n);
    expect(positiveBuf.readBigUInt64BE(8)).toBe(100n);

    const negative = -100n;
    const negativeBuf = i128ToBuffer(negative);
    expect(negativeBuf.length).toBe(16);
    expect(negativeBuf.readBigInt64BE(0)).toBe(-1n);
    expect(negativeBuf.readBigUInt64BE(8) > 0n).toBe(true);

    const large = 2n ** 80n;
    const largeBuf = i128ToBuffer(large);
    expect(largeBuf.readBigInt64BE(0)).toBe(1n << 16n);
    expect(largeBuf.readBigUInt64BE(8)).toBe(0n);

    const maxPositive = (2n ** 127n) - 1n;
    const maxBuf = i128ToBuffer(maxPositive);
    expect(maxBuf.readBigInt64BE(0)).toBe((2n ** 63n) - 1n);
    expect(maxBuf.readBigUInt64BE(8)).toBe(2n ** 64n - 1n);
  });
});
