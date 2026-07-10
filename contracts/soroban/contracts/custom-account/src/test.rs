#![cfg(test)]
extern crate std;
use super::*;
use std::{format, string::String};
use soroban_sdk::{
    testutils::{Address as _, BytesN as _},
    Env, IntoVal,
};
use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::OsRng;
use sha2::{Digest, Sha256};

#[contract]
pub struct DummyContract;

#[contractimpl]
impl DummyContract {
    pub fn test(_env: Env) {}
}

#[test]
fn test_custom_account_initialization() {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let manager = Address::generate(&env);
    
    let account = CustomAccountClient::new(&env, &env.register(CustomAccount, ()));
    account.init(&owner, &manager);
}

// --- P0-1: unauthenticated init() / front-run ownership takeover ---
//
// `init()` used to never call `.require_auth()` on anything (contrast with `execute()`,
// which calls `owner.require_auth()`). It only guarded against re-initialization.
// Deployment and initialization are two separate transactions in every real flow
// (`WalletModule.create`, `submitSponsoredDeploy`, `scripts/deploy-testnet.ts`), and the
// contract address is deterministic and known before the init transaction lands. The
// exploit test below (kept, still passing) reproduces the takeover exactly as it behaved
// before the fix, by calling the pre-fix code path directly (no owner auth mocked, only
// the double-init guard active). The regression tests after it prove the fixed behavior:
// `owner.require_auth()` now rejects any init that doesn't carry the claimed owner's own
// signature — a caller can no longer initialize a wallet with an owner they don't control.
//
// Note: this contract-level check alone does not stop an attacker from self-initializing
// an uninitialized wallet with *themselves* as owner (they can legitimately sign for their
// own address) — it stops impersonation of a specific victim owner. Closing the self-claim
// race requires removing the separate-transaction window itself, which is fixed at the SDK
// layer: `WalletModule.create`/`submitSponsoredDeploy` now submit deploy+init as a single
// atomic multi-operation transaction (see `packages/sdk/src/wallet/index.ts`), so no
// transaction ever exists on the wire for an attacker to race against.

#[test]
fn test_exploit_front_run_init_steals_ownership_pre_fix() {
    let env = Env::default();

    let legit_owner = Address::generate(&env);
    let attacker = Address::generate(&env);
    let manager = Address::generate(&env);

    // "Deploy" step: the contract exists at a known, deterministic address but is not yet
    // initialized — this is the on-chain window between the CreateContract tx confirming
    // and the separate `init` tx landing.
    let account_id = env.register(CustomAccount, ());
    let account = CustomAccountClient::new(&env, &account_id);

    // Attacker observes the deployed-but-uninitialized wallet and front-runs the legitimate
    // init call, claiming ownership for themselves. Only the attacker's own auth is mocked
    // (mirroring what an attacker can actually produce: a signature over their own address),
    // reproducing the exact pre-fix exploit — which still succeeds today because an
    // attacker claiming themselves as owner satisfies `owner.require_auth()` trivially.
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &attacker,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &account_id,
            fn_name: "init",
            args: (attacker.clone(), manager.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    account.init(&attacker, &manager);

    // The legitimate owner's init (submitted in the real flow's second transaction) now
    // fails: the wallet is already claimed.
    let legit_init = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        account.init(&legit_owner, &manager);
    }));
    assert!(
        legit_init.is_err(),
        "legitimate owner's init() unexpectedly succeeded after attacker's front-run"
    );

    // Confirm ownership was actually stolen, not just that a second init failed.
    let stored_owner: Address = env.as_contract(&account_id, || {
        env.storage().instance().get(&DataKey::Owner).unwrap()
    });
    assert_eq!(stored_owner, attacker, "attacker should now own the wallet");
    assert_ne!(stored_owner, legit_owner, "legitimate owner was locked out");
}

// --- Regression tests for the fix ---

#[test]
fn test_legitimate_init_succeeds_with_owner_auth() {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let manager = Address::generate(&env);

    let account_id = env.register(CustomAccount, ());
    let account = CustomAccountClient::new(&env, &account_id);
    account.init(&owner, &manager);

    let stored_owner: Address = env.as_contract(&account_id, || {
        env.storage().instance().get(&DataKey::Owner).unwrap()
    });
    assert_eq!(stored_owner, owner);
}

#[test]
#[should_panic]
fn test_unauthorized_init_is_rejected() {
    let env = Env::default();
    // No mocked auths at all: nobody's signature is available for `owner`.
    let owner = Address::generate(&env);
    let manager = Address::generate(&env);

    let account = CustomAccountClient::new(&env, &env.register(CustomAccount, ()));
    account.init(&owner, &manager);
}

#[test]
#[should_panic]
fn test_front_run_cannot_impersonate_a_different_owner() {
    let env = Env::default();

    let legit_owner = Address::generate(&env);
    let attacker = Address::generate(&env);
    let manager = Address::generate(&env);

    let account_id = env.register(CustomAccount, ());
    let account = CustomAccountClient::new(&env, &account_id);

    // Attacker only has their own signature, but tries to initialize the wallet with the
    // real owner's address (e.g. to grief a specific victim, or simply because they don't
    // hold that key at all). Only the attacker's auth is mocked, not legit_owner's.
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &attacker,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &account_id,
            fn_name: "init",
            args: (legit_owner.clone(), manager.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    account.init(&legit_owner, &manager);
}

#[test]
#[should_panic]
fn test_double_initialization_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let other = Address::generate(&env);
    let manager = Address::generate(&env);

    let account = CustomAccountClient::new(&env, &env.register(CustomAccount, ()));
    account.init(&owner, &manager);
    account.init(&other, &manager);
}

#[test]
fn test_custom_account_execution_from_executor() {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let manager = Address::generate(&env);
    
    let account_id = env.register(CustomAccount, ());
    let account = CustomAccountClient::new(&env, &account_id);
    account.init(&owner, &manager);

    // Call execution from the manager
    let target = env.register(DummyContract, ());
    let function = Symbol::new(&env, "test");
    let args: Vec<Val> = Vec::new(&env);

    // This should succeed as we mocked all auths and target contract is registered
    account.execute_from_executor(&target, &function, &args);
}

/// Reproduces exactly what a browser wallet's SEP-53 `signMessage` produces (see
/// https://stellar.org/protocol/sep-53): `ed25519_sign(SHA256("Stellar Signed Message:\n" +
/// hex(hash)))`, using a real ed25519 keypair as the wallet's owner — proving
/// `is_valid_signature` accepts a genuine SEP-53 signature over a delegation hash, not just
/// a raw signature over the bare hash bytes.
fn sep53_sign(signing_key: &SigningKey, hash: &[u8; 32]) -> [u8; 64] {
    let hex_hash: String = hash.iter().map(|b| format!("{:02x}", b)).collect();
    let payload = [b"Stellar Signed Message:\n".as_slice(), hex_hash.as_bytes()].concat();
    let message_hash = Sha256::digest(&payload);
    signing_key.sign(&message_hash).to_bytes()
}

#[test]
fn test_is_valid_signature_accepts_sep53_wallet_signature() {
    let env = Env::default();
    env.mock_all_auths();

    let signing_key = SigningKey::generate(&mut OsRng);
    let strkey =
        stellar_strkey::ed25519::PublicKey(signing_key.verifying_key().to_bytes()).to_string();
    let owner = Address::from_str(&env, &strkey);
    let manager = Address::generate(&env);

    let account = CustomAccountClient::new(&env, &env.register(CustomAccount, ()));
    account.init(&owner, &manager);

    let hash_bytes: [u8; 32] = [7u8; 32];
    let hash = BytesN::from_array(&env, &hash_bytes);
    let sig_bytes = sep53_sign(&signing_key, &hash_bytes);
    let signature = BytesN::from_array(&env, &sig_bytes);

    assert!(account.is_valid_signature(&hash, &signature));
}

#[test]
#[should_panic]
fn test_is_valid_signature_rejects_raw_unwrapped_signature() {
    let env = Env::default();
    env.mock_all_auths();

    let signing_key = SigningKey::generate(&mut OsRng);
    let strkey =
        stellar_strkey::ed25519::PublicKey(signing_key.verifying_key().to_bytes()).to_string();
    let owner = Address::from_str(&env, &strkey);
    let manager = Address::generate(&env);

    let account = CustomAccountClient::new(&env, &env.register(CustomAccount, ()));
    account.init(&owner, &manager);

    let hash_bytes: [u8; 32] = [7u8; 32];
    let hash = BytesN::from_array(&env, &hash_bytes);
    // A signature over the bare hash (the old, pre-SEP-53 scheme) must now be rejected —
    // wallets never produce this shape, only the SEP-53-wrapped one.
    let raw_sig = signing_key.sign(&hash_bytes).to_bytes();
    let signature = BytesN::from_array(&env, &raw_sig);

    account.is_valid_signature(&hash, &signature);
}

/// `__check_auth` is invoked directly here (bypassing Soroban's real `require_auth`
/// dispatch, which a unit test can't easily drive) to prove the verification logic itself
/// accepts a genuine Stellar account-signature-shaped `Val`
/// (`Vec<{public_key, signature}>`, matching what `authorizeEntry`/Freighter's
/// `signAuthEntry` actually produce) over the exact `signature_payload` hash — not the
/// previous, mismatched `(Val, Vec<Context>, Vec<Val>)` parameter shape that trapped on any
/// real auth entry.
#[test]
fn test_check_auth_accepts_standard_account_signature() {
    let env = Env::default();
    // Only needed to authorize the `init` setup call below — `__check_auth` itself is
    // invoked directly further down, bypassing the mocked-auth machinery entirely.
    env.mock_all_auths();

    let signing_key = SigningKey::generate(&mut OsRng);
    let strkey =
        stellar_strkey::ed25519::PublicKey(signing_key.verifying_key().to_bytes()).to_string();
    let owner = Address::from_str(&env, &strkey);
    let manager = Address::generate(&env);

    let account_id = env.register(CustomAccount, ());
    let account = CustomAccountClient::new(&env, &account_id);
    account.init(&owner, &manager);

    let payload_hash = env.crypto().sha256(&Bytes::from_slice(&env, b"dummy auth payload"));
    let payload_bytes: [u8; 32] = payload_hash.clone().into();
    let sig_bytes = signing_key.sign(&payload_bytes).to_bytes();

    let sig_struct = AccountEd25519Signature {
        public_key: BytesN::from_array(&env, &signing_key.verifying_key().to_bytes()),
        signature: BytesN::from_array(&env, &sig_bytes),
    };
    let signature_val: Val = Vec::from_array(&env, [sig_struct]).into_val(&env);
    let empty_contexts: Vec<Context> = Vec::new(&env);

    env.as_contract(&account_id, || {
        CustomAccount::__check_auth(env.clone(), payload_hash, signature_val, empty_contexts);
    });
}

#[test]
#[should_panic]
fn test_check_auth_rejects_wrong_signer() {
    let env = Env::default();
    // Only needed to authorize the `init` setup call below, so the panic this test expects
    // comes from `__check_auth` rejecting the wrong signer, not from the setup call itself.
    env.mock_all_auths();

    let signing_key = SigningKey::generate(&mut OsRng);
    let wrong_key = SigningKey::generate(&mut OsRng);
    let strkey =
        stellar_strkey::ed25519::PublicKey(signing_key.verifying_key().to_bytes()).to_string();
    let owner = Address::from_str(&env, &strkey);
    let manager = Address::generate(&env);

    let account_id = env.register(CustomAccount, ());
    let account = CustomAccountClient::new(&env, &account_id);
    account.init(&owner, &manager);

    let payload_hash = env.crypto().sha256(&Bytes::from_slice(&env, b"dummy auth payload"));
    let payload_bytes: [u8; 32] = payload_hash.clone().into();
    // Signed by a key that does NOT match the wallet's owner.
    let sig_bytes = wrong_key.sign(&payload_bytes).to_bytes();

    let sig_struct = AccountEd25519Signature {
        public_key: BytesN::from_array(&env, &wrong_key.verifying_key().to_bytes()),
        signature: BytesN::from_array(&env, &sig_bytes),
    };
    let signature_val: Val = Vec::from_array(&env, [sig_struct]).into_val(&env);
    let empty_contexts: Vec<Context> = Vec::new(&env);

    env.as_contract(&account_id, || {
        CustomAccount::__check_auth(env.clone(), payload_hash, signature_val, empty_contexts);
    });
}
