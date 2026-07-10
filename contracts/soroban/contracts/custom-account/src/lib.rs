#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short, Address, Bytes, BytesN, Env, Symbol, Val, Vec,
    panic_with_error, log, auth::Context, crypto::Hash, TryIntoVal, xdr::ToXdr,
};

#[contracttype]
pub enum DataKey {
    Owner,
    DelegationManager,
}

// The standard Stellar/Soroban account-signature convention (what `authorizeEntry`/Freighter's
// `signAuthEntry` actually produce for a Soroban auth entry): a list of these, one per signer.
// We only ever have a single owner key, so exactly one entry is expected.
#[contracttype]
pub struct AccountEd25519Signature {
    pub public_key: BytesN<32>,
    pub signature: BytesN<64>,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AccountError {
    NotAuthorized = 1,
    AlreadyInitialized = 2,
    InvalidSignature = 3,
}

#[contract]
pub struct CustomAccount;

#[contractimpl]
impl CustomAccount {
    // Initialize custom account
    pub fn init(env: Env, owner: Address, delegation_manager: Address) {
        if env.storage().instance().has(&DataKey::Owner) {
            panic_with_error!(&env, AccountError::AlreadyInitialized);
        }
        // P0-1 fix: require the claimed owner's own authorization. Without this, `init`
        // was callable by anyone with any `owner` argument, letting a third party (an
        // observer front-running the deploy tx, or a malicious sponsor/relayer) claim a
        // wallet that was never theirs. Combined with the deploy+init atomicity fix in
        // `WalletModule` (which removes the separate-transaction window entirely), this
        // also stops a sponsoring funder from silently substituting a different owner
        // than the one the real owner authorized.
        owner.require_auth();
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::DelegationManager, &delegation_manager);
        env.storage().instance().extend_ttl(10000, 100000);
    }

    // Standard execute function for direct transactions by owner
    pub fn execute(env: Env, target: Address, function: Symbol, args: Vec<Val>) -> Val {
        let owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();
        owner.require_auth();

        env.invoke_contract::<Val>(&target, &function, args)
    }

    // Execution called by DelegationManager
    pub fn execute_from_executor(env: Env, target: Address, function: Symbol, args: Vec<Val>) -> Val {
        let delegation_manager: Address = env.storage().instance().get(&DataKey::DelegationManager).unwrap();
        delegation_manager.require_auth();

        env.invoke_contract::<Val>(&target, &function, args)
    }

    // Helper for contract signature validation fallback (e.g. ERC-1271 counterpart).
    //
    // The owner signs via a browser wallet's SEP-53 message signing (e.g. Freighter's
    // `signMessage`), not a raw private-key signature — wallets deliberately refuse to sign
    // arbitrary raw bytes (that's exactly what a malicious tx would look like), so `hash` is
    // instead hex-encoded and wrapped per SEP-53 before verification:
    //   signed payload = SHA-256("Stellar Signed Message:\n" + hex(hash))
    pub fn is_valid_signature(env: Env, hash: BytesN<32>, signature: BytesN<64>) -> bool {
        let owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();

        let xdr = owner.to_xdr(&env);
        let mut key_bytes = [0u8; 32];
        for i in 0..32 {
            key_bytes[i] = xdr.get(xdr.len() - 32 + i as u32).unwrap();
        }
        let public_key = BytesN::from_array(&env, &key_bytes);

        let message: Bytes = env.crypto().sha256(&Self::sep53_payload(&env, &hash)).into();
        env.crypto().ed25519_verify(
            &public_key,
            &message,
            &signature,
        );
        true
    }

    // Builds the SEP-53 "Stellar Signed Message:\n" + hex(hash) payload (pre-SHA-256).
    fn sep53_payload(env: &Env, hash: &BytesN<32>) -> Bytes {
        let mut payload = Bytes::from_slice(env, b"Stellar Signed Message:\n");
        payload.append(&Self::hex_encode(env, &hash.to_array()));
        payload
    }

    // Lowercase-hex-encodes raw bytes into their ASCII representation (no_std, no alloc).
    fn hex_encode(env: &Env, bytes: &[u8]) -> Bytes {
        const HEX_CHARS: &[u8; 16] = b"0123456789abcdef";
        let mut out = Bytes::new(env);
        for b in bytes.iter() {
            out.push_back(HEX_CHARS[(b >> 4) as usize]);
            out.push_back(HEX_CHARS[(b & 0x0f) as usize]);
        }
        out
    }

    // Soroban's custom-account verification hook. The host always calls this with exactly
    // these three arguments (see `soroban_sdk::auth::CustomAccountInterface`) whenever
    // something does `require_auth()` against this contract's own address (e.g.
    // `disable_delegation`/`enable_delegation`'s `delegator.require_auth()`) —
    // `execute_from_executor`'s `delegation_manager.require_auth()` never reaches here, since
    // a contract authorizing as itself as the direct caller doesn't need a signature.
    //
    // The previous version of this function declared the wrong parameter types/order (a bare
    // `Val` first, `Vec<Context>` second, an unused `Vec<Val>` third) — Soroban still deserialized
    // the arguments positionally into whatever was declared, so `auth_context: Vec<Context>` was
    // actually being handed the real signature payload (a `Vec<{public_key, signature}>` struct),
    // which doesn't match the `Context` enum's shape and trapped immediately. Fixed to match the
    // real ABI: `(signature_payload: Hash<32>, signature: Val, auth_contexts: Vec<Context>)`.
    pub fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signature: Val,
        _auth_contexts: Vec<Context>,
    ) {
        let owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();

        let signatures: Vec<AccountEd25519Signature> = signature
            .try_into_val(&env)
            .unwrap_or_else(|_| panic_with_error!(&env, AccountError::InvalidSignature));
        if signatures.len() != 1 {
            panic_with_error!(&env, AccountError::InvalidSignature);
        }
        let sig = signatures.get(0).unwrap();

        let xdr = owner.to_xdr(&env);
        let mut key_bytes = [0u8; 32];
        for i in 0..32 {
            key_bytes[i] = xdr.get(xdr.len() - 32 + i as u32).unwrap();
        }
        let public_key = BytesN::from_array(&env, &key_bytes);

        let payload: Bytes = signature_payload.into();
        env.crypto().ed25519_verify(&public_key, &payload, &sig.signature);
    }
}
mod test;
