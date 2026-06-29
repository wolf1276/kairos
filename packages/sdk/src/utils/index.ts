import { Address, hash, xdr } from '@stellar/stellar-sdk';
import { Delegation } from '../types';

/**
 * Gets the raw XDR bytes for a Soroban Address.
 */
export function getAddressXdrBytes(addressString: string): Buffer {
  const address = Address.fromString(addressString);
  const scAddress = address.toScAddress();
  return scAddress.toXDR();
}

/**
 * Serializes a bigint into 8-byte big-endian bytes (uint64 in XDR).
 */
export function uint64ToXdrBytes(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(value);
  return buf;
}

/**
 * Extracts the 32-byte public key/contract ID from an Address XDR representation.
 * Mimics the contract's `address_to_public_key` logic.
 */
export function addressToPublicKey(addressStr: string): Buffer {
  const xdrBytes = getAddressXdrBytes(addressStr);
  if (xdrBytes.length < 32) {
    throw new Error(`Invalid XDR length for address: ${addressStr}`);
  }
  return xdrBytes.subarray(xdrBytes.length - 32);
}

/**
 * Validates whether a string is a valid Stellar/Soroban address.
 */
export function validateAddress(addressStr: string): boolean {
  try {
    Address.fromString(addressStr);
    return true;
  } catch {
    return false;
  }
}

/**
 * Computes the SHA-256 delegation hash exactly as DelegationManager contract does.
 */
export function computeDelegationHash(delegation: Omit<Delegation, 'signature'>): string {
  const parts: Buffer[] = [];
  
  // 1. delegate
  parts.push(getAddressXdrBytes(delegation.delegate));
  
  // 2. delegator
  parts.push(getAddressXdrBytes(delegation.delegator));
  
  // 3. authority (32 bytes hex)
  parts.push(Buffer.from(delegation.authority, 'hex'));
  
  // 4. salt
  parts.push(uint64ToXdrBytes(delegation.salt));
  
  // 5. nonce
  parts.push(uint64ToXdrBytes(delegation.nonce));
  
  // 6. caveats
  for (const caveat of delegation.caveats) {
    parts.push(getAddressXdrBytes(caveat.enforcer));
    parts.push(Buffer.from(caveat.terms));
  }
  
  const totalBuffer = Buffer.concat(parts);
  const delegationHash = hash(totalBuffer);
  return delegationHash.toString('hex');
}

/**
 * Helper to encode time restriction policy terms.
 * Policy Type = 3, start timestamp u64, end timestamp u64.
 */
export function encodeTimeRestrictionTerms(start: bigint, end: bigint): Uint8Array {
  const buf = Buffer.alloc(17);
  buf.writeUInt8(3, 0); // policy_type = 3
  buf.writeBigUInt64BE(start, 1);
  buf.writeBigUInt64BE(end, 9);
  return buf;
}

/**
 * Helper to encode target whitelist policy terms.
 * Policy Type = 1, allowed target Address XDR.
 */
export function encodeTargetWhitelistTerms(targetAddress: string): Uint8Array {
  const targetXdr = getAddressXdrBytes(targetAddress);
  const buf = Buffer.alloc(1 + targetXdr.length);
  buf.writeUInt8(1, 0); // policy_type = 1
  targetXdr.copy(buf, 1);
  return buf;
}

/**
 * Helper to encode spend limit policy terms.
 * Policy Type = 2, token address XDR (32 bytes), limit i128 (16 bytes), period u64 (8 bytes).
 * Wait, in lib.rs lines 92-94:
 *   let token = Address::from_xdr(&env, &terms.slice(1..33)).unwrap();
 *   let limit = Self::decode_i128(&terms, 33);
 *   let period = Self::decode_u64(&terms, 49);
 * This means:
 *   Offset 0: policy_type = 2 (1 byte)
 *   Offset 1..33: token address XDR (32 bytes). Wait! How does the address XDR fit into 32 bytes?
 *   Wait, we saw standard ScAddress XDR is 36 bytes!
 *   Why does the contract do: `&terms.slice(1..33)`? That is exactly 32 bytes (indices 1 to 32 inclusive).
 *   Ah! Let's check: how can a 36-byte ScAddress XDR fit in 32 bytes?
 *   If the token address is represented as a 32-byte contract ID / public key, does it omit the 4-byte type prefix?
 *   Wait, in Rust, `Address::from_xdr(&env, &terms.slice(1..33))` is called.
 *   `from_xdr` parses a `ScAddress`. But a `ScAddress` type tag is 4 bytes, and the 32 bytes payload follows.
 *   Wait! How can a `ScAddress` be parsed from exactly 32 bytes?
 *   Actually, if the slice is 1..33, it is indeed 32 bytes.
 *   Does `Address::from_xdr` work on a 32-byte slice?
 *   Wait! If the XDR payload has no prefix, can `from_xdr` decode it?
 *   No, `from_xdr` parses the full XDR. If the contract was compiled and tested, how did they test spend limits?
 *   Let's check if there are other files in `soroban-delegation` or if the test has any policy tests.
 *   Wait, let's run a grep search for "before_hook" or "spend" in `soroban-delegation`.
 */
