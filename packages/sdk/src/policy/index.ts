import { Caveat } from '../types';
import { encodeTargetWhitelistTerms, encodeTimeRestrictionTerms } from '../utils';

export interface PolicyCreateParams {
  type: 'spend-limit' | 'time-restriction' | 'target-whitelist';
  // Spend Limit options
  token?: string;
  spendLimit?: string | bigint;
  period?: bigint | number;
  // Time restriction options
  start?: bigint | number;
  expiry?: bigint | number;
  // Target Whitelist options
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
          throw new Error('Target address is required for target-whitelist policy');
        }
        terms = encodeTargetWhitelistTerms(params.target);
        break;
      }
      case 'spend-limit': {
        if (!params.token || params.spendLimit === undefined || params.period === undefined) {
          throw new Error('token, spendLimit, and period are required for spend-limit policy');
        }
        // Spend Limit: policy_type = 2
        // Next 32 bytes: token public key / contract ID
        // Next 16 bytes: limit (i128BE)
        // Next 8 bytes: period (u64BE)
        const tokenXdr = require('../utils').addressToPublicKey(params.token);
        const limitBuf = Buffer.alloc(16);
        limitBuf.writeBigInt64BE(BigInt(params.spendLimit) >> 64n, 0);
        limitBuf.writeBigInt64BE(BigInt(params.spendLimit) & 0xffffffffffffffffn, 8);
        
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
        throw new Error(`Unsupported policy type: ${params.type}`);
    }

    return {
      enforcer: this.enforcerAddress,
      terms,
    };
  }

  /**
   * Fake CRUD operations as policies are stored inline inside the delegation caveats.
   */
  async update(caveat: Caveat, newParams: Partial<PolicyCreateParams>): Promise<Caveat> {
    const parsed = this.decode(caveat);
    return this.create({
      ...parsed,
      ...newParams,
    } as PolicyCreateParams);
  }

  async delete(caveat: Caveat): Promise<void> {
    // No-op, just remove from delegation caveats
  }

  async get(caveat: Caveat): Promise<Caveat> {
    return caveat;
  }

  async list(): Promise<Caveat[]> {
    return [];
  }

  /**
   * Decodes raw terms byte array back into options.
   */
  decode(caveat: Caveat): PolicyCreateParams {
    const terms = Buffer.from(caveat.terms);
    if (terms.length === 0) {
      throw new Error('Empty terms');
    }
    const typeTag = terms.readUInt8(0);
    switch (typeTag) {
      case 1: {
        // Target Whitelist
        const { Address } = require('@stellar/stellar-sdk');
        const targetAddress = Address.fromScVal(
          this.parseScValFromBuffer(terms.subarray(1))
        ).toString();
        return {
          type: 'target-whitelist',
          target: targetAddress,
        };
      }
      case 2: {
        // Spend Limit
        // Decode token, limit, period
        const tokenBytes = terms.subarray(1, 33);
        // Find tokenAddress by converting contractId bytes back to address
        const { StrKey } = require('@stellar/stellar-sdk');
        const token = StrKey.encodeContract(tokenBytes);
        
        const limitHi = terms.readBigInt64BE(33);
        const limitLo = terms.readBigInt64BE(41);
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
        // Time restriction
        const start = terms.readBigUInt64BE(1);
        const expiry = terms.readBigUInt64BE(9);
        return {
          type: 'time-restriction',
          start,
          expiry,
        };
      }
      default:
        throw new Error(`Unknown policy type tag: ${typeTag}`);
    }
  }

  private parseScValFromBuffer(buf: Buffer) {
    const { xdr } = require('@stellar/stellar-sdk');
    return xdr.ScVal.fromXDR(buf);
  }
}
