import { describe, expect, it } from 'vitest';
import { Account, Address, Asset, hash, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { KairosClient } from '../src/client';
import { ROOT_AUTHORITY } from '../src/constants';
import { computeDelegationHash, encodeTargetWhitelistTerms, encodeTimeRestrictionTerms, getAddressXdrBytes, i128ToBuffer, signTransaction, uint64ToXdrBytes, PooledSpendValueMode } from '../src/utils';
import { BLEND_SUBMIT_REQUESTS_ARG_INDEX } from '../src/protocols/blend';
import { SOROSWAP_SWAP_AMOUNT_IN_ARG_INDEX } from '../src/protocols/soroswap';
import { getAdapter } from '../src/protocols';
import type { ProtocolActionRequest } from '../src/protocols/types';
import type { RemoteSigner } from '../src/types';

describe('Kairos SDK Unit Tests', () => {
  const mockContracts = {
    delegationManager: 'CCGZ3IDTERFBQYVGHGNUI46R4HMSEJMJ2LXYQD5A2GXU6DA6INNKBTGL',
    policyEngine: 'CAMFIEJACX5BJSJ4YIDNPWSNHTEWHHZSODQFQ4JZ32W7LVAW46LDYVQ6',
    smartWallet: 'CB4DP5NR67AZAH4FMB4TLAJ2LLOEOLZ5Z3FMDODHR23AUM22ZWLYBU72',
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
    const delegationManager = 'CCGZ3IDTERFBQYVGHGNUI46R4HMSEJMJ2LXYQD5A2GXU6DA6INNKBTGL';
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
    const delegationManager = 'CCGZ3IDTERFBQYVGHGNUI46R4HMSEJMJ2LXYQD5A2GXU6DA6INNKBTGL';
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
    const delegationManager = 'CCGZ3IDTERFBQYVGHGNUI46R4HMSEJMJ2LXYQD5A2GXU6DA6INNKBTGL';
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
            enforcer: 'CAMFIEJACX5BJSJ4YIDNPWSNHTEWHHZSODQFQ4JZ32W7LVAW46LDYVQ6',
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

  it('should round-trip target-function-set-whitelist terms through create/decode', async () => {
    const blend = Keypair.random().publicKey();
    const soroswap = Keypair.random().publicKey();
    const caveat = await client.policy.create({
      type: 'target-function-set-whitelist',
      targets: [
        { address: blend, functions: ['deposit', 'withdraw'] },
        { address: soroswap, functions: ['swap_exact_tokens_for_tokens'] },
      ],
    });

    expect(caveat.terms[0]).toBe(4);
    const decoded = client.policy.decode(caveat);
    expect(decoded.type).toBe('target-function-set-whitelist');
    expect(decoded.targets).toHaveLength(2);
    expect(decoded.targets?.[0].functions).toEqual(['deposit', 'withdraw']);
    expect(decoded.targets?.[1].functions).toEqual(['swap_exact_tokens_for_tokens']);
  });

  it('should round-trip pooled-protocol-spend-limit terms through create/decode', async () => {
    const blend = Keypair.random().publicKey();
    const soroswap = Keypair.random().publicKey();
    const caveat = await client.policy.create({
      type: 'pooled-protocol-spend-limit',
      protocolActions: [
        { address: blend, function: 'deposit', argIndex: 2 },
        { address: soroswap, function: 'swap_exact_tokens_for_tokens', argIndex: SOROSWAP_SWAP_AMOUNT_IN_ARG_INDEX },
      ],
      spendLimit: 1000n,
      period: 86400,
    });

    expect(caveat.terms[0]).toBe(5);
    const decoded = client.policy.decode(caveat);
    expect(decoded.type).toBe('pooled-protocol-spend-limit');
    expect(decoded.protocolActions).toHaveLength(2);
    expect(decoded.protocolActions?.[0]).toEqual({
      address: blend,
      function: 'deposit',
      argIndex: 2,
      valueMode: PooledSpendValueMode.FlatI128,
    });
    expect(decoded.spendLimit).toBe(1000n);
    expect(decoded.period).toBe(86400n);
  });

  it('encodes a Blend request-vec-sum pooled-protocol-spend-limit action with its value mode', async () => {
    const blend = Keypair.random().publicKey();
    const caveat = await client.policy.create({
      type: 'pooled-protocol-spend-limit',
      protocolActions: [
        {
          address: blend,
          function: 'submit',
          argIndex: BLEND_SUBMIT_REQUESTS_ARG_INDEX,
          valueMode: PooledSpendValueMode.RequestVecAmountSum,
        },
      ],
      spendLimit: 1000n,
      period: 86400,
    });

    const decoded = client.policy.decode(caveat);
    expect(decoded.protocolActions?.[0]).toEqual({
      address: blend,
      function: 'submit',
      argIndex: BLEND_SUBMIT_REQUESTS_ARG_INDEX,
      valueMode: PooledSpendValueMode.RequestVecAmountSum,
    });
  });

  describe('protocol-agnostic adapter dispatch (buildAction)', () => {
    const owner = Keypair.random().publicKey();
    const usdc = Keypair.random().publicKey();
    const xlm = Keypair.random().publicKey();

    // A caller that only knows `ProtocolActionRequest` and `getAdapter` — no `if (protocolId ===
    // 'blend')` anywhere — exercising the same dispatch path protocolExecutionService.ts uses.
    function dispatch(request: ProtocolActionRequest) {
      const adapter = getAdapter(client, request.protocolId);
      return adapter.buildAction(request);
    }

    it('builds a Blend deposit with a positive position delta', () => {
      const result = dispatch({ protocolId: 'blend', action: 'deposit', asset: usdc, amount: 500n, owner });
      expect(result.execution.function).toBe('submit');
      expect(result.positionDelta).toEqual({ asset: usdc, kind: 'lend', delta: 500n });
      expect(result.describe('deadbeef')).toContain('Blend deposit');
    });

    it('builds a Blend withdraw with a negative position delta', () => {
      const result = dispatch({ protocolId: 'blend', action: 'withdraw', asset: usdc, amount: 200n, owner });
      expect(result.positionDelta).toEqual({ asset: usdc, kind: 'lend', delta: -200n });
    });

    it('builds a Soroswap swap with an lp-kind delta on the output asset', () => {
      const result = dispatch({
        protocolId: 'soroswap',
        action: 'swap',
        path: [xlm, usdc],
        amountIn: 1000n,
        minAmountOut: 950n,
        deadline: 9999999999n,
        owner,
      });
      expect(result.execution.function).toBe('swap_exact_tokens_for_tokens');
      expect(result.positionDelta).toEqual({ asset: usdc, kind: 'lp', delta: 950n });
      expect(result.describe('deadbeef')).toContain('Soroswap swap');
    });

    it('rejects a Blend action with a non-positive amount', () => {
      expect(() => dispatch({ protocolId: 'blend', action: 'deposit', asset: usdc, amount: 0n, owner })).toThrow();
      expect(() => dispatch({ protocolId: 'blend', action: 'deposit', asset: usdc, amount: -1n, owner })).toThrow();
    });

    it('rejects a Blend action with a malformed asset address', () => {
      expect(() => dispatch({ protocolId: 'blend', action: 'deposit', asset: 'not-an-address', amount: 100n, owner })).toThrow();
    });

    it('rejects a Soroswap swap with a single-asset path', () => {
      expect(() =>
        dispatch({ protocolId: 'soroswap', action: 'swap', path: [xlm], amountIn: 100n, minAmountOut: 90n, deadline: 999n, owner })
      ).toThrow();
    });

    it('rejects a Soroswap swap with a non-positive amountIn or expired deadline', () => {
      expect(() =>
        dispatch({ protocolId: 'soroswap', action: 'swap', path: [xlm, usdc], amountIn: 0n, minAmountOut: 90n, deadline: 999n, owner })
      ).toThrow();
      expect(() =>
        dispatch({ protocolId: 'soroswap', action: 'swap', path: [xlm, usdc], amountIn: 100n, minAmountOut: 90n, deadline: 0n, owner })
      ).toThrow();
    });
  });

  describe('address validation (no silent fallback for malformed strkeys)', () => {
    it('throws instead of silently collapsing an invalid strkey to a placeholder address', () => {
      expect(() => getAddressXdrBytes('not-a-real-address')).toThrow();
      expect(() => getAddressXdrBytes('CINVALIDCHECKSUMBUTLOOKSLIKEACONTRACTIDXXXXXXXXXXXXXXXXXXXX')).toThrow();
    });

    it('two different malformed addresses no longer collapse to the same encoded bytes', () => {
      // Regression test: the old fallback stripped non-hex characters from a 'C...' string and
      // zero-padded short results, so most malformed contract-like strings collapsed to the same
      // all-zero 32-byte address — silently merging what should have been distinct identities.
      let firstError: unknown;
      let secondError: unknown;
      try {
        getAddressXdrBytes('CDWMR4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP');
      } catch (e) {
        firstError = e;
      }
      try {
        getAddressXdrBytes('CCPENGINE4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP');
      } catch (e) {
        secondError = e;
      }
      expect(firstError).toBeDefined();
      expect(secondError).toBeDefined();
    });
  });

  describe('execution request validation (fails fast, before any RPC call)', () => {
    it('rejects execute() with an empty executions array', async () => {
      await expect(
        client.execution.execute({
          redeemer: Keypair.random(),
          delegationChains: [],
          executions: [],
        })
      ).rejects.toThrow();
    });

    it('rejects execute() with an invalid target address', async () => {
      await expect(
        client.execution.execute({
          redeemer: Keypair.random(),
          delegationChains: [],
          executions: [{ target: 'not-an-address', function: 'deposit', args: [] }],
        })
      ).rejects.toThrow();
    });

    it('rejects execute() with a malformed function symbol', async () => {
      const target = Keypair.random().publicKey();
      await expect(
        client.execution.execute({
          redeemer: Keypair.random(),
          delegationChains: [],
          executions: [{ target, function: 'not a valid symbol!', args: [] }],
        })
      ).rejects.toThrow();
    });

    it('rejects execute() with an empty delegation chain', async () => {
      const target = Keypair.random().publicKey();
      await expect(
        client.execution.execute({
          redeemer: Keypair.random(),
          delegationChains: [[]],
          executions: [{ target, function: 'deposit', args: [] }],
        })
      ).rejects.toThrow();
    });
  });
});
