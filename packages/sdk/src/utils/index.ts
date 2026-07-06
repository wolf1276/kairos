import { Address, hash, xdr, StrKey, Transaction } from '@stellar/stellar-sdk';
import { Delegation, Signer, isRemoteSigner } from '../types';
import { RpcError } from '../errors';

/**
 * Signs `tx` in place with either a local `Keypair` (synchronous, via stellar-sdk's own
 * `Transaction.sign`) or a `RemoteSigner` (async — e.g. an MPC provider like Turnkey). For
 * the remote-signer path, this reimplements what `Transaction.sign` does internally: sign
 * the transaction's signature-base hash and append a `DecoratedSignature` whose 4-byte hint
 * is the signer's raw public key's last 4 bytes — so a `RemoteSigner` wrapping the same key
 * material as a `Keypair` produces an identical signed transaction either way.
 */
export async function signTransaction(tx: Transaction, signer: Signer): Promise<void> {
  if (!isRemoteSigner(signer)) {
    tx.sign(signer);
    return;
  }
  const txHash = tx.hash();
  const rawSignature = await signer.sign(txHash);
  if (rawSignature.length !== 64) {
    throw new RpcError(`RemoteSigner.sign must return a 64-byte Ed25519 signature. Received: ${rawSignature.length}`);
  }
  const rawPublicKey = StrKey.decodeEd25519PublicKey(signer.publicKey());
  const hint = rawPublicKey.subarray(rawPublicKey.length - 4);
  tx.signatures.push(new xdr.DecoratedSignature({ hint, signature: rawSignature }));
}

/**
 * Gets the raw ScAddress XDR bytes (without ScVal wrapper).
 * Used for encoding terms and extracting public keys.
 * G...: 40 bytes (ScAddressType::Account + PublicKey + ed25519 key)
 * C...: 36 bytes (ScAddressType::Contract + contract ID)
 *
 * Throws on an invalid/malformed strkey rather than silently substituting a synthetic
 * contract address — this is used for terms encoding, delegation-hash computation, and
 * public-key extraction, all of which are security-relevant. Silently accepting a garbage
 * address here previously meant a malformed caller input would produce a validly-shaped but
 * wrong address baked into a caveat or hash, instead of failing loudly at the boundary.
 */
export function getAddressXdrBytes(addressString: string): Buffer {
  let addr: Address;
  try {
    addr = Address.fromString(addressString);
  } catch (e) {
    throw new RpcError(`Invalid Stellar/Soroban address: ${addressString}`);
  }
  return Buffer.from(addr.toScAddress().toXDR());
}

/**
 * Gets the ScVal::Address XDR bytes matching the Rust soroban-sdk's `address.to_xdr()`.
 * This wraps the ScAddress in an ScVal envelope with type discriminator.
 * G...: 44 bytes (ScValType::Address + ScAddress)
 * C...: 40 bytes (ScValType::Address + ScAddress)
 * Throws on an invalid address — see `getAddressXdrBytes`.
 */
export function getAddressScValXdrBytes(addressString: string): Buffer {
  let addr: Address;
  try {
    addr = Address.fromString(addressString);
  } catch (e) {
    throw new RpcError(`Invalid Stellar/Soroban address: ${addressString}`);
  }
  return Buffer.from(xdr.ScVal.scvAddress(addr.toScAddress()).toXDR());
}

/**
 * Serializes a bigint into 8-byte big-endian bytes (uint64 in XDR).
 * Used for encoding terms, NOT for hash computation.
 */
export function uint64ToXdrBytes(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(value);
  return buf;
}

/**
 * Gets the ScVal::U64 XDR bytes matching the Rust soroban-sdk's `u64.to_xdr()`.
 * Used for hash computation: 4 bytes ScValType::U64 + 8 bytes value = 12 bytes.
 */
export function uint64ScValXdrBytes(value: bigint): Buffer {
  const u64 = xdr.Uint64.fromString(value.toString());
  return Buffer.from(xdr.ScVal.scvU64(u64).toXDR());
}

/**
 * Extracts the 32-byte public key/contract ID from an Address XDR representation.
 * Mimics the contract's `address_to_public_key` logic.
 */
export function addressToPublicKey(addressStr: string): Buffer {
  const xdrBytes = getAddressXdrBytes(addressStr);
  if (xdrBytes.length < 32) {
    throw new RpcError(`Invalid XDR length for address: ${addressStr}`);
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
 * Helper to safely convert different ScVal numeric types into bigint.
 */
export function scValToBigInt(val: xdr.ScVal): bigint {
  const switchName = val.switch().name;
  switch (switchName) {
    case 'scvU32':
      return BigInt(val.u32());
    case 'scvI32':
      return BigInt(val.i32());
    case 'scvU64':
      return val.u64().toBigInt();
    case 'scvI64':
      return val.i64().toBigInt();
    case 'scvU128': {
      const u128Val = val.u128();
      const hi = u128Val.hi().toBigInt();
      const lo = u128Val.lo().toBigInt();
      return (hi << 64n) | lo;
    }
    case 'scvI128': {
      const i128Val = val.i128();
      const hi = i128Val.hi().toBigInt();
      const lo = i128Val.lo().toBigInt();
      return (hi << 64n) | lo;
    }
    default:
      throw new RpcError(`ScVal is not a number type: ${switchName}`);
  }
}

/**
 * Computes the SHA-256 delegation hash exactly as DelegationManager contract does.
 * Uses ScVal::Address for all address fields and ScVal::U64 for salt/nonce.
 * Raw bytes for domain, network_id, authority, and caveat terms.
 */
export function computeDelegationHash(
  delegation: Omit<Delegation, 'signature'>,
  delegationManagerAddress: string,
  networkPassphrase: string
): string {
  const parts: Buffer[] = [];

  parts.push(Buffer.from('soroban-delegation'));

  parts.push(getAddressScValXdrBytes(delegationManagerAddress));

  const networkId = hash(Buffer.from(networkPassphrase));
  parts.push(networkId);

  parts.push(getAddressScValXdrBytes(delegation.delegate));
  parts.push(getAddressScValXdrBytes(delegation.delegator));

  parts.push(Buffer.from(delegation.authority, 'hex'));

  parts.push(uint64ScValXdrBytes(delegation.salt));
  parts.push(uint64ScValXdrBytes(delegation.nonce));

  for (const caveat of delegation.caveats) {
    parts.push(getAddressScValXdrBytes(caveat.enforcer));
    parts.push(Buffer.from(caveat.terms));
  }

  const totalBuffer = Buffer.concat(parts);
  const delegationHash = hash(totalBuffer);
  return delegationHash.toString('hex');
}

/**
 * Encodes a signed i128 bigint into a 16-byte big-endian buffer.
 * Properly splits into hi (i64) and lo (u64) parts for Soroban i128 encoding.
 */
export function i128ToBuffer(value: bigint): Buffer {
  const buf = Buffer.alloc(16);
  const hi = BigInt.asIntN(64, value >> 64n);
  const lo = BigInt.asUintN(64, value);
  buf.writeBigInt64BE(hi, 0);
  buf.writeBigUInt64BE(lo, 8);
  return buf;
}

/**
 * Helper to encode time restriction policy terms.
 * Policy Type = 3, start timestamp u64, end timestamp u64.
 */
export function encodeTimeRestrictionTerms(start: bigint, end: bigint): Uint8Array {
  const buf = Buffer.alloc(17);
  buf.writeUInt8(3, 0);
  buf.writeBigUInt64BE(start, 1);
  buf.writeBigUInt64BE(end, 9);
  return new Uint8Array(buf);
}

/**
 * Helper to encode target whitelist policy terms.
 * Policy Type = 1, allowed target Address XDR (ScVal::Address format,
 * as expected by the contract's `Address::from_xdr` deserialization).
 */
export function encodeTargetWhitelistTerms(targetAddress: string): Uint8Array {
  const targetXdr = getAddressScValXdrBytes(targetAddress);
  const buf = Buffer.alloc(1 + targetXdr.length);
  buf.writeUInt8(1, 0);
  buf.set(targetXdr, 1);
  return new Uint8Array(buf);
}

/**
 * Gets the ScVal::Symbol XDR bytes matching the Rust soroban-sdk's `Symbol::to_xdr()`.
 */
export function getSymbolScValXdrBytes(name: string): Buffer {
  return Buffer.from(xdr.ScVal.scvSymbol(name).toXDR());
}

/**
 * Helper to encode a target-function-set whitelist policy's terms.
 * Policy Type = 4: [4][count:u8]{[addr_len:u8][addr ScVal-XDR][fn_count:u8]{[fn_len:u8][fn ScVal-XDR]}*fn_count}*count
 * Matches the contract's `check_target_function_whitelist` decode in `policies/src/lib.rs`.
 */
export function encodeTargetFunctionSetWhitelistTerms(
  entries: { address: string; functions: string[] }[]
): Uint8Array {
  const chunks: Buffer[] = [Buffer.from([4, entries.length])];
  for (const entry of entries) {
    const addrXdr = getAddressScValXdrBytes(entry.address);
    chunks.push(Buffer.from([addrXdr.length]), addrXdr, Buffer.from([entry.functions.length]));
    for (const fn of entry.functions) {
      const fnXdr = getSymbolScValXdrBytes(fn);
      chunks.push(Buffer.from([fnXdr.length]), fnXdr);
    }
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * How the pooled-protocol-spend-limit caveat (policy tag 5) reads the tracked spend amount
 * out of `context.args[argIndex]` on-chain. Must match `value_mode` in
 * `contracts/soroban/contracts/policies/src/lib.rs`.
 */
export enum PooledSpendValueMode {
  /** A flat i128 arg (e.g. SEP-41 `transfer`/`xfer`, Soroswap's `amount_in`). */
  FlatI128 = 0,
  /**
   * A `Vec<Map<Symbol, Val>>` of Blend-style `Request { amount, ... }` structs — the tracked
   * amount is the sum of every entry's "amount" field. Required for Blend's
   * `submit(from, spender, to, requests: Vec<Request>)`, whose spend isn't a flat arg.
   */
  RequestVecAmountSum = 1,
}

/**
 * Helper to encode a pooled protocol spend limit policy's terms.
 * Policy Type = 5:
 * [5][count:u8]{[addr_len:u8][addr ScVal-XDR][fn_len:u8][fn ScVal-XDR][arg_index:u8][value_mode:u8]}*count[limit:i128][period:u64]
 * All listed (target, function) actions accumulate against one shared limit/period.
 */
export function encodePooledProtocolSpendLimitTerms(
  entries: { address: string; function: string; argIndex: number; valueMode?: PooledSpendValueMode }[],
  limit: bigint,
  period: bigint | number
): Uint8Array {
  const chunks: Buffer[] = [Buffer.from([5, entries.length])];
  for (const entry of entries) {
    const addrXdr = getAddressScValXdrBytes(entry.address);
    const fnXdr = getSymbolScValXdrBytes(entry.function);
    chunks.push(
      Buffer.from([addrXdr.length]),
      addrXdr,
      Buffer.from([fnXdr.length]),
      fnXdr,
      Buffer.from([entry.argIndex, entry.valueMode ?? PooledSpendValueMode.FlatI128])
    );
  }
  chunks.push(i128ToBuffer(limit));
  const periodBuf = Buffer.alloc(8);
  periodBuf.writeBigUInt64BE(BigInt(period), 0);
  chunks.push(periodBuf);
  return new Uint8Array(Buffer.concat(chunks));
}
