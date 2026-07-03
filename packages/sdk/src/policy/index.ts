import { Address, xdr, StrKey } from '@stellar/stellar-sdk';
import { Caveat, Delegation } from '../types';
import { addressToPublicKey, encodeTargetWhitelistTerms, encodeTimeRestrictionTerms, i128ToBuffer } from '../utils';
import { PolicyViolationError, ExecutionFailedError } from '../errors';

export interface PolicyCreateParams {
  type: 'spend-limit' | 'time-restriction' | 'target-whitelist';
  token?: string;
  spendLimit?: string | bigint;
  period?: bigint | number;
  start?: bigint | number;
  expiry?: bigint | number;
  target?: string;
}

export class PolicyModule {
  private enforcerAddress: string;

  constructor(enforcerAddress: string) {
    this.enforcerAddress = enforcerAddress;
  }

  /**
   * Helper to create a Caveat structure for a policy.
   */
  async create(params: PolicyCreateParams): Promise<Caveat> {
    const terms = this.encodeTerms(params);
    return { enforcer: this.enforcerAddress, terms };
  }

  /**
   * Builds a caveat whose terms are an indirection marker (`0xFE ++ policy_id:u64_be`)
   * pointing at (delegator, policyId) in the DelegationManager's on-chain Policy storage,
   * instead of embedding the terms inline. This is what makes a policy editable later via
   * `client.delegation.prepareSponsoredSetPolicy`/`set_policies` — the delegation's hash and
   * signature never change when the policy's limits/assets/expiry are updated.
   *
   * Returns both the marker caveat (to put in the Delegation) and the actual encoded terms
   * (to seed into on-chain Policy storage via `set_policy`/`set_policies` once the delegation
   * is registered).
   */
  createIndexed(policyId: bigint, params: PolicyCreateParams): { caveat: Caveat; terms: Uint8Array } {
    const actualTerms = this.encodeTerms(params);

    const marker = new Uint8Array(9);
    marker[0] = 0xfe;
    const idBuf = Buffer.alloc(8);
    idBuf.writeBigUInt64BE(policyId, 0);
    marker.set(idBuf, 1);

    return {
      caveat: { enforcer: this.enforcerAddress, terms: marker },
      terms: actualTerms,
    };
  }

  /** True if the caveat's terms are an indirection marker (`0xFE ++ policy_id:u64_be`)
   * created by `createIndexed`, pointing at on-chain Policy storage instead of inline terms. */
  isIndexedCaveat(caveat: Caveat): boolean {
    return caveat.terms.length === 9 && caveat.terms[0] === 0xfe;
  }

  /** Extracts the policy id an indexed caveat points at. Throws if the caveat isn't indexed. */
  getIndexedPolicyId(caveat: Caveat): bigint {
    if (!this.isIndexedCaveat(caveat)) {
      throw new PolicyViolationError('decode', 'Caveat terms are not an indexed-policy marker');
    }
    return Buffer.from(caveat.terms).readBigUInt64BE(1);
  }

  private encodeTerms(params: PolicyCreateParams): Uint8Array {
    let terms: Uint8Array;

    switch (params.type) {
      case 'time-restriction': {
        const start = BigInt(params.start || 0);
        const expiry = BigInt(params.expiry || 0);
        terms = encodeTimeRestrictionTerms(start, expiry);
        break;
      }
      case 'target-whitelist': {
        if (!params.target) {
          throw new PolicyViolationError('target-whitelist', 'Target address is required');
        }
        terms = encodeTargetWhitelistTerms(params.target);
        break;
      }
      case 'spend-limit': {
        if (!params.token || params.spendLimit === undefined || params.period === undefined) {
          throw new PolicyViolationError('spend-limit', 'token, spendLimit, and period are required');
        }
        // Spend Limit: policy_type = 2
        // Next 32 bytes: token contract public key
        // Next 16 bytes: limit (i128BE split into hi and lo 64-bit segments)
        // Next 8 bytes: period (u64BE)
        const tokenXdr = addressToPublicKey(params.token);
        
        const limitBuf = i128ToBuffer(BigInt(params.spendLimit));
        
        const periodBuf = Buffer.alloc(8);
        periodBuf.writeBigUInt64BE(BigInt(params.period), 0);

        const termsBuf = Buffer.alloc(1 + 32 + 16 + 8);
        termsBuf.writeUInt8(2, 0); // policy_type = 2
        tokenXdr.copy(termsBuf, 1);
        limitBuf.copy(termsBuf, 33);
        periodBuf.copy(termsBuf, 49);

        terms = new Uint8Array(termsBuf);
        break;
      }
      default:
        throw new PolicyViolationError(params.type, `Unsupported policy type: ${params.type}`);
    }

    return terms;
  }

  /**
   * Updates a policy's configuration.
   */
  async update(caveat: Caveat, newParams: Partial<PolicyCreateParams>): Promise<Caveat> {
    const parsed = this.decode(caveat);
    const merged: PolicyCreateParams = {
      ...parsed,
      ...newParams,
    };
    return this.create(merged);
  }

  /**
   * Deletes a policy caveat from a delegation.
   */
  async delete(delegation: Delegation, index: number): Promise<Delegation> {
    const caveats = [...delegation.caveats];
    if (index < 0 || index >= caveats.length) {
      throw new PolicyViolationError('policy-list', `Policy index out of bounds: ${index}`);
    }
    caveats.splice(index, 1);
    return {
      ...delegation,
      caveats,
    };
  }

  async get(caveat: Caveat): Promise<Caveat> {
    return caveat;
  }

  /**
   * Returns policies configured in a delegation.
   */
  async list(delegation?: Delegation): Promise<Caveat[]> {
    if (delegation) {
      return delegation.caveats;
    }
    return [];
  }

  /**
   * Decodes raw terms byte array back into human-readable options.
   */
  decode(caveat: Caveat): PolicyCreateParams {
    const terms = Buffer.from(caveat.terms);
    if (terms.length === 0) {
      throw new PolicyViolationError('decode', 'Empty terms');
    }
    const typeTag = terms.readUInt8(0);
    switch (typeTag) {
      case 1: {
        const targetAddress = Address.fromScVal(
          this.parseScValFromBuffer(terms.subarray(1))
        ).toString();
        return {
          type: 'target-whitelist',
          target: targetAddress,
        };
      }
      case 2: {
        const tokenBytes = terms.subarray(1, 33);
        const token = StrKey.encodeContract(tokenBytes);
        
        const limitHi = terms.readBigInt64BE(33);
        const limitLo = terms.readBigUInt64BE(41);
        const spendLimit = (limitHi << 64n) | (limitLo & 0xffffffffffffffffn);
        
        const period = terms.readBigUInt64BE(49);
        return {
          type: 'spend-limit',
          token,
          spendLimit,
          period,
        };
      }
      case 3: {
        const start = terms.readBigUInt64BE(1);
        const expiry = terms.readBigUInt64BE(9);
        return {
          type: 'time-restriction',
          start,
          expiry,
        };
      }
      default:
        throw new PolicyViolationError('decode', `Unknown policy type tag: ${typeTag}`);
    }
  }

  private parseScValFromBuffer(buf: Buffer): xdr.ScVal {
    return xdr.ScVal.fromXDR(buf);
  }
}
