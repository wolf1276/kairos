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
