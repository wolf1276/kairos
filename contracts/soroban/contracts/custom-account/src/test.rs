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

    let _account = CustomAccountClient::new(
        &env,
        &env.register(CustomAccount, CustomAccountArgs::__constructor(&owner, &manager)),
    );
}

// --- P0-1: unauthenticated init() / front-run ownership takeover ---
//
// `init()` used to never call `.require_auth()` on anything (contrast with `execute()`,
// which calls `owner.require_auth()`). It only guarded against re-initialization.
// Deployment and initialization were two separate transactions in every real flow
// (`WalletModule.create`, `submitSponsoredDeploy`, `scripts/deploy-testnet.ts`), and the
// contract address was deterministic and known before the init transaction landed —
// a real on-chain window where the contract existed, uninitialized, at a known address.
//
// P0-1 first closed the impersonation half of this (`owner.require_auth()`), but left a
// residual race: an attacker could still front-run the separate init tx and self-init
// with *themselves* as owner (a self-claim, not an impersonation — their own signature
// satisfies `require_auth()` trivially). That residual race is closed here by removing
// the separate init transaction entirely: `init()` is now `__constructor`, invoked by the
// Soroban host as part of the same `CreateContractV2` operation that creates the
// contract (soroban-sdk 22 / protocol 22). There is no longer any on-chain state where
// this address exists without also being owned — the two former transactions collapse
// into one atomic operation, so there is nothing left for a front-runner to race.
//
// This also holds for the sponsored-deploy path even though a funder ≠ owner submits the
// transaction: `soroban-env-host::host::lifecycle::create_contract_with_optional_auth`
// requires an authorization from the address embedded in the contract-id preimage (the
// intended owner) to create the contract at all, on top of whatever `__constructor`
// itself requires — so an attacker who doesn't hold the real owner's key cannot create a
// competing contract at that same deterministic address in the first place, regardless of
// constructor args.
//
// The tests below prove the two remaining, meaningful contract-level properties:
// unauthenticated construction is rejected outright, impersonation is rejected, and a
// second direct call to `__constructor` (Soroban does not block re-invoking it as an
// ordinary function after creation) cannot reset ownership.

#[test]
fn test_legitimate_init_succeeds_with_owner_auth() {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let manager = Address::generate(&env);

    let account_id = env.register(CustomAccount, CustomAccountArgs::__constructor(&owner, &manager));

    let stored_owner: Address = env.as_contract(&account_id, || {
        env.storage().instance().get(&DataKey::Owner).unwrap()
    });
    assert_eq!(stored_owner, owner);
}

#[test]
#[should_panic]
fn test_unauthorized_init_is_rejected() {
    let env = Env::default();
    // No mocked auths at all: nobody's signature is available for `owner`. Since
    // `__constructor` now runs as part of contract creation itself, this proves an
    // attacker cannot bring a wallet into existence at all without the claimed owner's
    // authorization — there's no longer a separate, unauthenticated init step to race.
    let owner = Address::generate(&env);
    let manager = Address::generate(&env);

    env.register(CustomAccount, CustomAccountArgs::__constructor(&owner, &manager));
}

#[test]
#[should_panic]
fn test_front_run_cannot_impersonate_a_different_owner() {
    let env = Env::default();

    let legit_owner = Address::generate(&env);
    let attacker = Address::generate(&env);
    let manager = Address::generate(&env);

    // Attacker only has their own signature, but tries to construct the wallet with the
    // real owner's address (e.g. to grief a specific victim, or simply because they don't
    // hold that key at all). Only the attacker's auth is mocked, not legit_owner's.
    let account_id = Address::generate(&env);
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &attacker,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &account_id,
            fn_name: "__constructor",
            args: (legit_owner.clone(), manager.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    env.register_at(
        &account_id,
        CustomAccount,
        CustomAccountArgs::__constructor(&legit_owner, &manager),
    );
}

#[test]
#[should_panic]
fn test_double_initialization_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let other = Address::generate(&env);
    let manager = Address::generate(&env);

    let account_id = env.register(CustomAccount, CustomAccountArgs::__constructor(&owner, &manager));
    // `__constructor` remains an ordinary function after creation (the generated client
    // doesn't expose it, but the host has no special block on re-invoking it) — this
    // proves a second, direct call (e.g. an attacker trying to reset ownership post-deploy)
    // is still rejected by the re-init guard, exactly as double-`init()` was before this fix.
    env.as_contract(&account_id, || {
        CustomAccount::__constructor(env.clone(), other.clone(), manager.clone());
    });
}

#[test]
fn test_custom_account_execution_from_executor() {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let manager = Address::generate(&env);

    let account_id = env.register(CustomAccount, CustomAccountArgs::__constructor(&owner, &manager));
    let account = CustomAccountClient::new(&env, &account_id);

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

    let account = CustomAccountClient::new(
        &env,
        &env.register(CustomAccount, CustomAccountArgs::__constructor(&owner, &manager)),
    );

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

    let account = CustomAccountClient::new(
        &env,
        &env.register(CustomAccount, CustomAccountArgs::__constructor(&owner, &manager)),
    );

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

    let account_id = env.register(CustomAccount, CustomAccountArgs::__constructor(&owner, &manager));

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

    let account_id = env.register(CustomAccount, CustomAccountArgs::__constructor(&owner, &manager));

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
