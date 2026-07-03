#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::{
    testutils::{Address as _, BytesN as _, Events as _},
    token, Env, IntoVal,
};
use custom_account::{CustomAccount, CustomAccountClient};
use policies::{Policies, PoliciesClient};
use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::OsRng;

/// Builds a real ed25519 keypair and its corresponding Stellar G-address so
/// tests can exercise the actual `ed25519_verify` signature-validation path
/// (not the always-true `MockCustomAccount` stub).
fn generate_signing_identity(env: &Env) -> (SigningKey, Address) {
    let signing_key = SigningKey::generate(&mut OsRng);
    let strkey = stellar_strkey::ed25519::PublicKey(signing_key.verifying_key().to_bytes())
        .to_string();
    let address = Address::from_str(env, &strkey);
    (signing_key, address)
}

/// Signs a 32-byte delegation hash with the raw ed25519 secret key, matching
/// the contract's `env.crypto().ed25519_verify(pubkey, hash_bytes, signature)` check.
/// Used for EOA (G-address) delegators only — smart-wallet (CustomAccount) delegators
/// verify via `is_valid_signature`, which expects a SEP-53-wrapped signature instead
/// (see `sign_hash_sep53`), since that's what a browser wallet's `signMessage` produces.
fn sign_hash(env: &Env, signing_key: &SigningKey, hash: &BytesN<32>) -> BytesN<64> {
    let sig = signing_key.sign(&hash.to_array());
    BytesN::from_array(env, &sig.to_bytes())
}

/// Signs a delegation hash the way a browser wallet's SEP-53 `signMessage` would for a
/// CustomAccount smart-wallet owner: `ed25519_sign(SHA256("Stellar Signed Message:\n" +
/// hex(hash)))`. Mirrors `custom_account::CustomAccount::is_valid_signature` exactly.
fn sign_hash_sep53(env: &Env, signing_key: &SigningKey, hash: &BytesN<32>) -> BytesN<64> {
    use sha2::{Digest, Sha256};
    let hex_hash: std::string::String = hash.to_array().iter().map(|b| std::format!("{:02x}", b)).collect();
    let payload = [b"Stellar Signed Message:\n".as_slice(), hex_hash.as_bytes()].concat();
    let message_hash = Sha256::digest(&payload);
    let sig = signing_key.sign(&message_hash);
    BytesN::from_array(env, &sig.to_bytes())
}

/// Spend-limit caveat terms: [type=2][token: 32 bytes][limit: i128 BE][period: u64 BE]
fn spend_limit_terms(env: &Env, token: &Address, limit: i128, period: u64) -> Bytes {
    let mut terms = Bytes::new(env);
    terms.push_back(2u32 as u8);
    let token_bytes = address_raw_bytes(env, token);
    terms.append(&token_bytes);
    terms.append(&Bytes::from_array(env, &limit.to_be_bytes()));
    terms.append(&Bytes::from_array(env, &period.to_be_bytes()));
    terms
}

/// Extracts the raw 32-byte contract/account id from an Address (mirrors what
/// the policies contract expects to find at terms[offset..offset+32]).
fn address_raw_bytes(env: &Env, address: &Address) -> Bytes {
    let xdr = address.to_xdr(env);
    xdr.slice(xdr.len() - 32..xdr.len())
}

#[contract]
pub struct DummyContract;

#[contractimpl]
impl DummyContract {
    pub fn test(_env: Env) -> u32 {
        42
    }
}

#[contract]
pub struct MockCustomAccount;

#[contractimpl]
impl MockCustomAccount {
    pub fn init(env: Env, owner: Address, delegation_manager: Address) {
        env.storage().instance().set(&symbol_short!("owner"), &owner);
        env.storage().instance().set(&symbol_short!("manager"), &delegation_manager);
    }

    pub fn execute_from_executor(env: Env, target: Address, function: Symbol, args: Vec<Val>) -> Val {
        env.invoke_contract::<Val>(&target, &function, args)
    }

    pub fn is_valid_signature(_env: Env, _hash: BytesN<32>, _signature: BytesN<64>) -> bool {
        true
    }
}

#[test]
fn test_manager_init_and_pause() {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let manager = DelegationManagerClient::new(&env, &env.register_contract(None, DelegationManager));
    manager.init(&owner);

    assert_eq!(manager.is_paused(), false);
    manager.pause();
    assert_eq!(manager.is_paused(), true);
    manager.unpause();
    assert_eq!(manager.is_paused(), false);
}

#[test]
fn test_disable_and_enable_delegation() {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let manager = DelegationManagerClient::new(&env, &env.register_contract(None, DelegationManager));
    manager.init(&owner);

    let delegator = Address::generate(&env);
    let delegate = Address::generate(&env);
    
    let delegation = Delegation {
        delegate: delegate.clone(),
        delegator: delegator.clone(),
        authority: BytesN::from_array(&env, &[0u8; 32]),
        caveats: Vec::new(&env),
        salt: 0,
        nonce: 0,
        signature: BytesN::from_array(&env, &[0u8; 64]),
    };

    let hash = manager.get_delegation_hash(&delegation);
    assert_eq!(manager.is_delegation_disabled(&hash), false);

    // Disable
    manager.disable_delegation(&delegator, &delegation);
    assert_eq!(manager.is_delegation_disabled(&hash), true);

    // Re-enable
    manager.enable_delegation(&delegator, &delegation);
    assert_eq!(manager.is_delegation_disabled(&hash), false);
}

#[test]
fn test_redeem_delegation_pipeline() {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let manager_id = env.register_contract(None, DelegationManager);
    let manager = DelegationManagerClient::new(&env, &manager_id);
    manager.init(&owner);

    // Setup contract-based delegator
    let delegator_id = env.register_contract(None, MockCustomAccount);
    let delegator = MockCustomAccountClient::new(&env, &delegator_id);
    delegator.init(&owner, &manager_id);

    let delegate = Address::generate(&env);

    let delegation = Delegation {
        delegate: delegate.clone(),
        delegator: delegator_id.clone(),
        authority: BytesN::from_array(&env, &[0xff; 32]),
        caveats: Vec::new(&env),
        salt: 0,
        nonce: 0,
        signature: BytesN::from_array(&env, &[0u8; 64]),
    };

    let target = env.register_contract(None, DummyContract);
    let execution = Execution {
        target: target.clone(),
        function: Symbol::new(&env, "test"),
        args: Vec::new(&env),
    };

    let contexts = Vec::from_array(&env, [Vec::from_array(&env, [delegation.clone()])]);
    let executions = Vec::from_array(&env, [execution]);

    // First execution should succeed
    manager.redeem_delegations(&delegate, &contexts, &executions);

    // Nonce should be incremented to 1
    assert_eq!(manager.get_nonce(&delegator_id), 1);
}

/// End-to-end trade: a smart wallet (CustomAccount) delegates spending power to a
/// redeemer, which invokes a real SAC token `transfer`. Verifies the signature is
/// checked via the *real* `ed25519_verify` path (not a stubbed always-true account),
/// balances move by exact i128 stroops-scale amounts, and the delegation's nonce
/// advances so it cannot be replayed.
#[test]
fn test_redeem_delegation_moves_token_balance_with_i128_precision() {
    let env = Env::default();
    env.mock_all_auths();

    let owner_admin = Address::generate(&env);
    let manager_id = env.register_contract(None, DelegationManager);
    let manager = DelegationManagerClient::new(&env, &manager_id);
    manager.init(&owner_admin);

    // Smart wallet owned by a real ed25519 keypair.
    let (owner_key, owner_address) = generate_signing_identity(&env);
    let wallet_id = env.register_contract(None, CustomAccount);
    let wallet = CustomAccountClient::new(&env, &wallet_id);
    wallet.init(&owner_address, &manager_id);

    let redeemer = Address::generate(&env);
    let receiver = Address::generate(&env);

    // Real SAC token so balance movement uses the same i128 arithmetic as XLM stroops.
    let token_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_id = sac.address();
    let token_asset_client = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);

    // Large, non-round amount to prove no floating-point rounding is involved.
    let starting_balance: i128 = 123_456_789_012_345i128; // > u32/f64-safe-integer scale
    let transfer_amount: i128 = 987_654_321i128;
    token_asset_client.mint(&wallet_id, &starting_balance);

    let delegation_unsigned = Delegation {
        delegate: redeemer.clone(),
        delegator: wallet_id.clone(),
        authority: BytesN::from_array(&env, &[0xff; 32]),
        caveats: Vec::new(&env),
        salt: 7,
        nonce: 0,
        signature: BytesN::from_array(&env, &[0u8; 64]),
    };
    let hash = manager.get_delegation_hash(&delegation_unsigned);
    let signature = sign_hash_sep53(&env, &owner_key, &hash);
    let delegation = Delegation { signature, ..delegation_unsigned };

    let args: Vec<Val> = Vec::from_array(
        &env,
        [
            wallet_id.clone().into_val(&env),
            receiver.clone().into_val(&env),
            transfer_amount.into_val(&env),
        ],
    );
    let execution = Execution {
        target: token_id.clone(),
        function: Symbol::new(&env, "transfer"),
        args,
    };

    let contexts = Vec::from_array(&env, [Vec::from_array(&env, [delegation.clone()])]);
    let executions = Vec::from_array(&env, [execution]);

    manager.redeem_delegations(&redeemer, &contexts, &executions);

    // Balances moved by the exact BigInt/i128 amount — smart wallet down, receiver up.
    assert_eq!(token_client.balance(&wallet_id), starting_balance - transfer_amount);
    assert_eq!(token_client.balance(&receiver), transfer_amount);

    // Nonce consumed exactly once.
    assert_eq!(manager.get_nonce(&wallet_id), 1);
}

/// A delegation signed by the wrong key must be rejected by the real
/// `ed25519_verify` signature-validation path, and no balance should move.
#[test]
fn test_redeem_delegation_rejects_invalid_signature() {
    let env = Env::default();
    env.mock_all_auths();

    let owner_admin = Address::generate(&env);
    let manager_id = env.register_contract(None, DelegationManager);
    let manager = DelegationManagerClient::new(&env, &manager_id);
    manager.init(&owner_admin);

    let (_owner_key, owner_address) = generate_signing_identity(&env);
    let (wrong_key, _wrong_address) = generate_signing_identity(&env);
    let wallet_id = env.register_contract(None, CustomAccount);
    let wallet = CustomAccountClient::new(&env, &wallet_id);
    wallet.init(&owner_address, &manager_id);

    let redeemer = Address::generate(&env);
    let target = env.register_contract(None, DummyContract);

    let delegation_unsigned = Delegation {
        delegate: redeemer.clone(),
        delegator: wallet_id.clone(),
        authority: BytesN::from_array(&env, &[0xff; 32]),
        caveats: Vec::new(&env),
        salt: 1,
        nonce: 0,
        signature: BytesN::from_array(&env, &[0u8; 64]),
    };
    let hash = manager.get_delegation_hash(&delegation_unsigned);
    // Sign with a key that does NOT match the wallet owner.
    let bad_signature = sign_hash(&env, &wrong_key, &hash);
    let delegation = Delegation { signature: bad_signature, ..delegation_unsigned };

    let execution = Execution {
        target,
        function: Symbol::new(&env, "test"),
        args: Vec::new(&env),
    };
    let contexts = Vec::from_array(&env, [Vec::from_array(&env, [delegation])]);
    let executions = Vec::from_array(&env, [execution]);

    let result = manager.try_redeem_delegations(&redeemer, &contexts, &executions);
    assert!(result.is_err(), "redeem_delegations must reject an invalid signature");

    // Nonce must remain untouched since the whole batch reverted.
    assert_eq!(manager.get_nonce(&wallet_id), 0);
}

/// Replaying the exact same (non-reusable) nonce a second time must fail, and the
/// balances from the first successful redemption must not be double-applied.
#[test]
fn test_redeem_delegation_nonce_replay_protection() {
    let env = Env::default();
    env.mock_all_auths();

    let owner_admin = Address::generate(&env);
    let manager_id = env.register_contract(None, DelegationManager);
    let manager = DelegationManagerClient::new(&env, &manager_id);
    manager.init(&owner_admin);

    let delegator_id = env.register_contract(None, MockCustomAccount);
    let delegator = MockCustomAccountClient::new(&env, &delegator_id);
    delegator.init(&owner_admin, &manager_id);

    let delegate = Address::generate(&env);
    let target = env.register_contract(None, DummyContract);

    let delegation = Delegation {
        delegate: delegate.clone(),
        delegator: delegator_id.clone(),
        authority: BytesN::from_array(&env, &[0xff; 32]),
        caveats: Vec::new(&env),
        salt: 0,
        nonce: 0,
        signature: BytesN::from_array(&env, &[0u8; 64]),
    };
    let execution = Execution {
        target: target.clone(),
        function: Symbol::new(&env, "test"),
        args: Vec::new(&env),
    };
    let contexts = Vec::from_array(&env, [Vec::from_array(&env, [delegation.clone()])]);
    let executions = Vec::from_array(&env, [execution.clone()]);

    // First redemption succeeds and consumes nonce 0.
    manager.redeem_delegations(&delegate, &contexts, &executions);
    assert_eq!(manager.get_nonce(&delegator_id), 1);

    // Replaying the same delegation (still nonce 0) must fail.
    let contexts2 = Vec::from_array(&env, [Vec::from_array(&env, [delegation])]);
    let executions2 = Vec::from_array(&env, [execution]);
    let result = manager.try_redeem_delegations(&delegate, &contexts2, &executions2);
    assert!(result.is_err(), "replaying a consumed nonce must be rejected");

    // Nonce must stay at 1 (the failed replay must not further mutate state).
    assert_eq!(manager.get_nonce(&delegator_id), 1);
}

/// A delegation with `nonce == u64::MAX` is reusable-until-revoked: it must be
/// redeemable more than once without the stored nonce ever advancing.
#[test]
fn test_redeem_delegation_reusable_nonce_stays_usable() {
    let env = Env::default();
    env.mock_all_auths();

    let owner_admin = Address::generate(&env);
    let manager_id = env.register_contract(None, DelegationManager);
    let manager = DelegationManagerClient::new(&env, &manager_id);
    manager.init(&owner_admin);

    let delegator_id = env.register_contract(None, MockCustomAccount);
    let delegator = MockCustomAccountClient::new(&env, &delegator_id);
    delegator.init(&owner_admin, &manager_id);

    let delegate = Address::generate(&env);
    let target = env.register_contract(None, DummyContract);

    let delegation = Delegation {
        delegate: delegate.clone(),
        delegator: delegator_id.clone(),
        authority: BytesN::from_array(&env, &[0xff; 32]),
        caveats: Vec::new(&env),
        salt: 0,
        nonce: u64::MAX,
        signature: BytesN::from_array(&env, &[0u8; 64]),
    };
    let execution = Execution {
        target: target.clone(),
        function: Symbol::new(&env, "test"),
        args: Vec::new(&env),
    };

    for _ in 0..3 {
        let contexts = Vec::from_array(&env, [Vec::from_array(&env, [delegation.clone()])]);
        let executions = Vec::from_array(&env, [execution.clone()]);
        manager.redeem_delegations(&delegate, &contexts, &executions);
    }

    // Reusable delegations never advance the stored nonce counter.
    assert_eq!(manager.get_nonce(&delegator_id), 0);
}

/// Once a delegation is disabled on-chain, redemption must be rejected even
/// though the signature and nonce would otherwise be valid.
#[test]
fn test_redeem_delegation_rejects_disabled_delegation() {
    let env = Env::default();
    env.mock_all_auths();

    let owner_admin = Address::generate(&env);
    let manager_id = env.register_contract(None, DelegationManager);
    let manager = DelegationManagerClient::new(&env, &manager_id);
    manager.init(&owner_admin);

    let delegator_id = env.register_contract(None, MockCustomAccount);
    let delegator = MockCustomAccountClient::new(&env, &delegator_id);
    delegator.init(&owner_admin, &manager_id);

    let delegate = Address::generate(&env);
    let target = env.register_contract(None, DummyContract);

    let delegation = Delegation {
        delegate: delegate.clone(),
        delegator: delegator_id.clone(),
        authority: BytesN::from_array(&env, &[0xff; 32]),
        caveats: Vec::new(&env),
        salt: 0,
        nonce: 0,
        signature: BytesN::from_array(&env, &[0u8; 64]),
    };
    manager.disable_delegation(&delegator_id, &delegation);

    let execution = Execution {
        target,
        function: Symbol::new(&env, "test"),
        args: Vec::new(&env),
    };
    let contexts = Vec::from_array(&env, [Vec::from_array(&env, [delegation])]);
    let executions = Vec::from_array(&env, [execution]);

    let result = manager.try_redeem_delegations(&delegate, &contexts, &executions);
    assert!(result.is_err(), "a disabled delegation must not be redeemable");
}

/// The spend-limit policy caveat must actually stop an over-limit token transfer.
/// This exercises the caveat pipeline end-to-end (before_all -> before_hook) with a
/// real SAC token, proving policy enforcement is wired into execution, not just
/// invoked as a no-op.
#[test]
fn test_redeem_delegation_enforces_spend_limit_policy() {
    let env = Env::default();
    env.mock_all_auths();

    let owner_admin = Address::generate(&env);
    let manager_id = env.register_contract(None, DelegationManager);
    let manager = DelegationManagerClient::new(&env, &manager_id);
    manager.init(&owner_admin);

    let (owner_key, owner_address) = generate_signing_identity(&env);
    let wallet_id = env.register_contract(None, CustomAccount);
    let wallet = CustomAccountClient::new(&env, &wallet_id);
    wallet.init(&owner_address, &manager_id);

    let policies_id = env.register_contract(None, Policies);

    let redeemer = Address::generate(&env);
    let receiver = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_id = sac.address();
    let token_asset_client = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);

    let starting_balance: i128 = 1_000_000_000i128;
    token_asset_client.mint(&wallet_id, &starting_balance);

    let spend_limit: i128 = 100_000_000i128; // caveat allows at most this much
    let within_limit_amount: i128 = 50_000_000i128;
    let over_limit_amount: i128 = 500_000_000i128; // attempted transfer exceeds the limit

    let terms = spend_limit_terms(&env, &token_id, spend_limit, 86_400);
    let caveats = Vec::from_array(
        &env,
        [Caveat { enforcer: policies_id.clone(), terms }],
    );

    let delegation_unsigned = Delegation {
        delegate: redeemer.clone(),
        delegator: wallet_id.clone(),
        authority: BytesN::from_array(&env, &[0xff; 32]),
        caveats,
        salt: 3,
        // Reusable nonce — this delegation is redeemed twice below (once within the
        // spend limit, once over it), which a single-use nonce wouldn't allow.
        nonce: u64::MAX,
        signature: BytesN::from_array(&env, &[0u8; 64]),
    };
    let hash = manager.get_delegation_hash(&delegation_unsigned);
    let signature = sign_hash_sep53(&env, &owner_key, &hash);
    let delegation = Delegation { signature, ..delegation_unsigned };

    let make_transfer_execution = |amount: i128| {
        let args: Vec<Val> = Vec::from_array(
            &env,
            [
                wallet_id.clone().into_val(&env),
                receiver.clone().into_val(&env),
                amount.into_val(&env),
            ],
        );
        Execution {
            target: token_id.clone(),
            function: Symbol::new(&env, "transfer"),
            args,
        }
    };

    // A within-limit transfer must succeed first — this proves the delegation's signature
    // and target-match are valid, so the later assertion that the over-limit call fails is
    // actually exercising the spend-limit check, not being masked by an unrelated rejection
    // (e.g. an invalid signature) earlier in the pipeline.
    let contexts = Vec::from_array(&env, [Vec::from_array(&env, [delegation.clone()])]);
    manager.redeem_delegations(
        &redeemer,
        &contexts,
        &Vec::from_array(&env, [make_transfer_execution(within_limit_amount)]),
    );
    assert_eq!(token_client.balance(&wallet_id), starting_balance - within_limit_amount);

    let over_limit_result = manager.try_redeem_delegations(
        &redeemer,
        &contexts,
        &Vec::from_array(&env, [make_transfer_execution(over_limit_amount)]),
    );
    assert!(
        over_limit_result.is_err(),
        "spend-limit caveat must block a transfer exceeding the configured limit"
    );
    // Balance must reflect only the within-limit transfer — the over-limit one must not
    // have moved any funds despite being rejected mid-batch.
    assert_eq!(token_client.balance(&wallet_id), starting_balance - within_limit_amount);
    assert_eq!(token_client.balance(&receiver), within_limit_amount);
}
