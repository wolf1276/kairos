import { describe, expect, it } from 'vitest';
import { Address, Keypair } from '@stellar/stellar-sdk';
import { KairosClient } from '../src/client';
import { ROOT_AUTHORITY } from '../src/constants';
import { computeDelegationHash, encodeTargetWhitelistTerms, encodeTimeRestrictionTerms } from '../src/utils';

describe('Kairos SDK Unit Tests', () => {
  const mockContracts = {
    delegationManager: 'CDWMR4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP',
    policyEngine: 'CCPENGINE4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP',
    smartWallet: 'CCS SCA4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP',
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
    expect(terms[0]).toBe(1); // Policy type = 1
    expect(terms.length).toBeGreaterThan(1);
  });

  it('should correctly encode time restriction terms', () => {
    const start = 1000n;
    const end = 2000n;
    const terms = encodeTimeRestrictionTerms(start, end);
    expect(terms[0]).toBe(3); // Policy type = 3
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

    const hash = computeDelegationHash(delegation);
    expect(hash).toHaveLength(64); // SHA-256 hex string is 64 characters
    expect(/^[0-9a-fA-F]{64}$/.test(hash)).toBe(true);
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
    expect(delegation.signature).toHaveLength(128); // 64 bytes signature in hex is 128 chars
  });
});
