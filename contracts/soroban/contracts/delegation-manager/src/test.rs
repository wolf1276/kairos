#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::{
    testutils::{Address as _, BytesN as _, Events as _, Ledger as _},
    token, Env, IntoVal,
};
use custom_account::{CustomAccount, CustomAccountArgs, CustomAccountClient};
use policies::{Policies, PoliciesArgs, PoliciesClient};
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

/// A harmless no-op caveat enforcer: every hook is a no-op that always allows the
/// action. Used to give delegations a non-empty `caveats` vec (required since the H2
/// fix rejects zero-caveat delegations) in tests that aren't exercising policy logic.
#[contract]
pub struct NoopEnforcer;

#[contractimpl]
impl NoopEnforcer {
    pub fn before_all(_env: Env, _terms: Bytes, _hash: BytesN<32>, _context: ExecutionContext) {}
    pub fn before_hook(_env: Env, _terms: Bytes, _hash: BytesN<32>, _context: ExecutionContext) {}
    pub fn after_hook(_env: Env, _terms: Bytes, _hash: BytesN<32>, _context: ExecutionContext) {}
    pub fn after_all(_env: Env, _terms: Bytes, _hash: BytesN<32>, _context: ExecutionContext) {}
}

/// Registers a fresh `NoopEnforcer`, configures it as the manager's Policies contract
/// (required since the H2 fix rejects any caveat whose enforcer isn't the configured
/// Policies contract), and returns a caveat pointing at it — a harmless stand-in caveat
/// for tests that need a non-empty `caveats` vec but aren't testing policy/caveat
/// semantics themselves.
fn noop_caveat(env: &Env, manager: &DelegationManagerClient) -> Caveat {
    let enforcer = env.register_contract(None, NoopEnforcer);
    manager.set_policies_contract(&enforcer);
    Caveat { enforcer, terms: Bytes::new(env) }
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

// --- P0-1: unauthenticated init() / front-run ownership takeover (DelegationManager) ---
//
// Same defect as CustomAccount::init originally had: no `.require_auth()` anywhere in
// `init()`, only an AlreadyInitialized-style reentry guard, and deploy+init were two
// separate transactions (`scripts/deploy-testnet.ts`), leaving an on-chain window where
// the singleton existed unowned. Fixed the same way as CustomAccount: `init()` is now
// `__constructor`, invoked atomically by the host inside the same `CreateContractV2`
// operation that creates the contract — there is no longer a separate transaction, so
// there's nothing left for a front-runner to race. See `custom_account::CustomAccount`'s
// test module for the full rationale (identical fix, identical guard behavior).

#[test]
fn test_manager_legitimate_init_succeeds_with_owner_auth() {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let manager_id = env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner));

    let stored_owner: Address = env.as_contract(&manager_id, || {
        env.storage().instance().get(&DataKey::Owner).unwrap()
    });
    assert_eq!(stored_owner, owner);
}

#[test]
#[should_panic]
fn test_manager_unauthorized_init_is_rejected() {
    let env = Env::default();
    // No mocked auths at all: nobody's signature is available for `owner`. Proves an
    // attacker cannot bring the manager into existence without the claimed owner's
    // authorization — there's no separate, unauthenticated init step to race anymore.
    let owner = Address::generate(&env);
    env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner));
}

#[test]
#[should_panic]
fn test_manager_front_run_cannot_impersonate_a_different_owner() {
    let env = Env::default();

    let legit_owner = Address::generate(&env);
    let attacker = Address::generate(&env);

    // Attacker only has their own signature but tries to construct the manager with the
    // real owner's address. Only the attacker's auth is mocked, not legit_owner's.
    let manager_id = Address::generate(&env);
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &attacker,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &manager_id,
            fn_name: "__constructor",
            args: (legit_owner.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    env.register_at(
        &manager_id,
        DelegationManager,
        DelegationManagerArgs::__constructor(&legit_owner),
    );
}

#[test]
#[should_panic]
fn test_manager_double_initialization_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let other = Address::generate(&env);
    let manager_id = env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner));
    // `__constructor` remains an ordinary function after creation — proves a second,
    // direct call (e.g. an attacker trying to reset ownership post-deploy) is still
    // rejected by the re-init guard, exactly as double-`init()` was before this fix.
    env.as_contract(&manager_id, || {
        DelegationManager::__constructor(env.clone(), other.clone());
    });
}

#[test]
fn test_manager_init_and_pause() {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let manager = DelegationManagerClient::new(
        &env,
        &env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner)),
    );

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
    let manager = DelegationManagerClient::new(
        &env,
        &env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner)),
    );

    let delegator = Address::generate(&env);
    let delegate = Address::generate(&env);
    
    let delegation = Delegation {
        delegate: delegate.clone(),
        delegator: delegator.clone(),
        authority: BytesN::from_array(&env, &[0u8; 32]),
        caveats: Vec::from_array(&env, [noop_caveat(&env, &manager)]),
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
    let manager_id = env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner));
    let manager = DelegationManagerClient::new(&env, &manager_id);

    // Setup contract-based delegator
    let delegator_id = env.register_contract(None, MockCustomAccount);
    let delegator = MockCustomAccountClient::new(&env, &delegator_id);
    delegator.init(&owner, &manager_id);

    let delegate = Address::generate(&env);

    let delegation = Delegation {
        delegate: delegate.clone(),
        delegator: delegator_id.clone(),
        authority: BytesN::from_array(&env, &[0xff; 32]),
        caveats: Vec::from_array(&env, [noop_caveat(&env, &manager)]),
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
    let manager_id = env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner_admin));
    let manager = DelegationManagerClient::new(&env, &manager_id);

    // Smart wallet owned by a real ed25519 keypair.
    let (owner_key, owner_address) = generate_signing_identity(&env);
    let wallet_id = env.register(CustomAccount, CustomAccountArgs::__constructor(&owner_address, &manager_id));

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
        caveats: Vec::from_array(&env, [noop_caveat(&env, &manager)]),
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
    let manager_id = env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner_admin));
    let manager = DelegationManagerClient::new(&env, &manager_id);

    let (_owner_key, owner_address) = generate_signing_identity(&env);
    let (wrong_key, _wrong_address) = generate_signing_identity(&env);
    let wallet_id = env.register(CustomAccount, CustomAccountArgs::__constructor(&owner_address, &manager_id));

    let redeemer = Address::generate(&env);
    let target = env.register_contract(None, DummyContract);

    let delegation_unsigned = Delegation {
        delegate: redeemer.clone(),
        delegator: wallet_id.clone(),
        authority: BytesN::from_array(&env, &[0xff; 32]),
        caveats: Vec::from_array(&env, [noop_caveat(&env, &manager)]),
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
    let manager_id = env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner_admin));
    let manager = DelegationManagerClient::new(&env, &manager_id);

    let delegator_id = env.register_contract(None, MockCustomAccount);
    let delegator = MockCustomAccountClient::new(&env, &delegator_id);
    delegator.init(&owner_admin, &manager_id);

    let delegate = Address::generate(&env);
    let target = env.register_contract(None, DummyContract);

    let delegation = Delegation {
        delegate: delegate.clone(),
        delegator: delegator_id.clone(),
        authority: BytesN::from_array(&env, &[0xff; 32]),
        caveats: Vec::from_array(&env, [noop_caveat(&env, &manager)]),
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
    let manager_id = env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner_admin));
    let manager = DelegationManagerClient::new(&env, &manager_id);

    let delegator_id = env.register_contract(None, MockCustomAccount);
    let delegator = MockCustomAccountClient::new(&env, &delegator_id);
    delegator.init(&owner_admin, &manager_id);

    let delegate = Address::generate(&env);
    let target = env.register_contract(None, DummyContract);

    let delegation = Delegation {
        delegate: delegate.clone(),
        delegator: delegator_id.clone(),
        authority: BytesN::from_array(&env, &[0xff; 32]),
        caveats: Vec::from_array(&env, [noop_caveat(&env, &manager)]),
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
    let manager_id = env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner_admin));
    let manager = DelegationManagerClient::new(&env, &manager_id);

    let delegator_id = env.register_contract(None, MockCustomAccount);
    let delegator = MockCustomAccountClient::new(&env, &delegator_id);
    delegator.init(&owner_admin, &manager_id);

    let delegate = Address::generate(&env);
    let target = env.register_contract(None, DummyContract);

    let delegation = Delegation {
        delegate: delegate.clone(),
        delegator: delegator_id.clone(),
        authority: BytesN::from_array(&env, &[0xff; 32]),
        caveats: Vec::from_array(&env, [noop_caveat(&env, &manager)]),
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

/// H2 fix: a delegation with zero caveats has no policy constraining it whatsoever and
/// must be rejected outright, before signature/nonce/disabled checks even matter.
#[test]
#[should_panic]
fn test_redeem_delegation_zero_caveats_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let owner_admin = Address::generate(&env);
    let manager_id = env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner_admin));
    let manager = DelegationManagerClient::new(&env, &manager_id);

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
        target,
        function: Symbol::new(&env, "test"),
        args: Vec::new(&env),
    };
    let contexts = Vec::from_array(&env, [Vec::from_array(&env, [delegation])]);
    let executions = Vec::from_array(&env, [execution]);

    manager.redeem_delegations(&delegate, &contexts, &executions);
}

/// A delegation carrying a single (no-op) caveat is not rejected by the H2 zero-caveats
/// check and redeems normally.
#[test]
fn test_redeem_delegation_single_caveat_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let owner_admin = Address::generate(&env);
    let manager_id = env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner_admin));
    let manager = DelegationManagerClient::new(&env, &manager_id);

    let delegator_id = env.register_contract(None, MockCustomAccount);
    let delegator = MockCustomAccountClient::new(&env, &delegator_id);
    delegator.init(&owner_admin, &manager_id);

    let delegate = Address::generate(&env);
    let target = env.register_contract(None, DummyContract);

    let delegation = Delegation {
        delegate: delegate.clone(),
        delegator: delegator_id.clone(),
        authority: BytesN::from_array(&env, &[0xff; 32]),
        caveats: Vec::from_array(&env, [noop_caveat(&env, &manager)]),
        salt: 0,
        nonce: 0,
        signature: BytesN::from_array(&env, &[0u8; 64]),
    };
    let execution = Execution {
        target,
        function: Symbol::new(&env, "test"),
        args: Vec::new(&env),
    };
    let contexts = Vec::from_array(&env, [Vec::from_array(&env, [delegation])]);
    let executions = Vec::from_array(&env, [execution]);

    manager.redeem_delegations(&delegate, &contexts, &executions);
    assert_eq!(manager.get_nonce(&delegator_id), 1);
}

/// H2 fix: a caveat whose enforcer is NOT the configured Kairos Policies contract must be
/// rejected before any hook executes, even though it satisfies the (unrelated) non-zero
/// caveats rule. This is the arbitrary/no-op-enforcer bypass the fix closes.
#[test]
#[should_panic]
fn test_redeem_delegation_rejects_enforcer_other_than_configured_policies() {
    let env = Env::default();
    env.mock_all_auths();

    let owner_admin = Address::generate(&env);
    let manager_id = env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner_admin));
    let manager = DelegationManagerClient::new(&env, &manager_id);

    // Configure the real Policies contract as the only allowed enforcer...
    let policies_id = env.register(Policies, PoliciesArgs::__constructor(&manager_id));
    manager.set_policies_contract(&policies_id);

    let delegator_id = env.register_contract(None, MockCustomAccount);
    let delegator = MockCustomAccountClient::new(&env, &delegator_id);
    delegator.init(&owner_admin, &manager_id);

    let delegate = Address::generate(&env);
    let target = env.register_contract(None, DummyContract);

    // ...but the delegation's caveat points at an arbitrary no-op enforcer instead.
    let rogue_enforcer = env.register_contract(None, NoopEnforcer);
    let delegation = Delegation {
        delegate: delegate.clone(),
        delegator: delegator_id.clone(),
        authority: BytesN::from_array(&env, &[0xff; 32]),
        caveats: Vec::from_array(&env, [Caveat { enforcer: rogue_enforcer, terms: Bytes::new(&env) }]),
        salt: 0,
        nonce: 0,
        signature: BytesN::from_array(&env, &[0u8; 64]),
    };
    let execution = Execution {
        target,
        function: Symbol::new(&env, "test"),
        args: Vec::new(&env),
    };
    let contexts = Vec::from_array(&env, [Vec::from_array(&env, [delegation])]);
    let executions = Vec::from_array(&env, [execution]);

    manager.redeem_delegations(&delegate, &contexts, &executions);
}

/// A delegation carrying multiple caveats redeems normally — the H2 check only rejects
/// zero caveats, not multiple.
#[test]
fn test_redeem_delegation_multi_caveat_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let owner_admin = Address::generate(&env);
    let manager_id = env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner_admin));
    let manager = DelegationManagerClient::new(&env, &manager_id);

    let delegator_id = env.register_contract(None, MockCustomAccount);
    let delegator = MockCustomAccountClient::new(&env, &delegator_id);
    delegator.init(&owner_admin, &manager_id);

    let delegate = Address::generate(&env);
    let target = env.register_contract(None, DummyContract);

    let shared_caveat = noop_caveat(&env, &manager);
    let delegation = Delegation {
        delegate: delegate.clone(),
        delegator: delegator_id.clone(),
        authority: BytesN::from_array(&env, &[0xff; 32]),
        caveats: Vec::from_array(&env, [shared_caveat.clone(), shared_caveat]),
        salt: 0,
        nonce: 0,
        signature: BytesN::from_array(&env, &[0u8; 64]),
    };
    let execution = Execution {
        target,
        function: Symbol::new(&env, "test"),
        args: Vec::new(&env),
    };
    let contexts = Vec::from_array(&env, [Vec::from_array(&env, [delegation])]);
    let executions = Vec::from_array(&env, [execution]);

    manager.redeem_delegations(&delegate, &contexts, &executions);
    assert_eq!(manager.get_nonce(&delegator_id), 1);
}

/// Registering a delegation records it as the active delegation for that (delegator,
/// delegate) pair, and a second `register_delegation` call for the *same* pair must be
/// rejected while it's still active — this is the on-chain "one delegation per pair"
/// enforcement. A second delegate for the *same* delegator wallet must succeed
/// concurrently — this is the multi-agent-per-wallet guarantee.
#[test]
fn test_register_delegation_enforces_one_per_delegate_pair() {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let manager = DelegationManagerClient::new(
        &env,
        &env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner)),
    );

    let delegator = Address::generate(&env);
    let delegate_a = Address::generate(&env);
    let delegate_b = Address::generate(&env);

    let delegation_a = Delegation {
        delegate: delegate_a.clone(),
        delegator: delegator.clone(),
        authority: BytesN::from_array(&env, &[0xff; 32]),
        caveats: Vec::new(&env),
        salt: 1,
        nonce: 0,
        signature: BytesN::from_array(&env, &[0u8; 64]),
    };
    manager.register_delegation(&delegator, &delegation_a);
    let hash_a = manager.get_delegation_hash(&delegation_a);
    assert_eq!(manager.get_wallet_delegation(&delegator, &delegate_a), Some(hash_a.clone()));

    // A second delegation for a *different* delegate from the same wallet must succeed
    // while the first is still active — one wallet, two concurrently-funded agents.
    let delegation_b = Delegation {
        delegate: delegate_b.clone(),
        delegator: delegator.clone(),
        authority: BytesN::from_array(&env, &[0xff; 32]),
        caveats: Vec::new(&env),
        salt: 2,
        nonce: 0,
        signature: BytesN::from_array(&env, &[0u8; 64]),
    };
    manager.register_delegation(&delegator, &delegation_b);
    let hash_b = manager.get_delegation_hash(&delegation_b);
    assert_eq!(manager.get_wallet_delegation(&delegator, &delegate_b), Some(hash_b.clone()));
    // delegate_a's delegation is untouched by registering delegate_b's.
    assert_eq!(manager.get_wallet_delegation(&delegator, &delegate_a), Some(hash_a));

    // A second delegation for the *same* delegate (delegate_a), while the first is still
    // active, must be rejected.
    let delegation_a2 = Delegation {
        delegate: delegate_a.clone(),
        delegator: delegator.clone(),
        authority: BytesN::from_array(&env, &[0xff; 32]),
        caveats: Vec::new(&env),
        salt: 3,
        nonce: 0,
        signature: BytesN::from_array(&env, &[0u8; 64]),
    };
    let result = manager.try_register_delegation(&delegator, &delegation_a2);
    assert!(result.is_err(), "registering a second active delegation for the same (delegator, delegate) pair must fail");

    // Once delegate_a's delegation is revoked, a new one for delegate_a can be registered
    // without disturbing delegate_b's still-active delegation.
    manager.revoke_by_wallet(&delegator, &delegate_a);
    manager.register_delegation(&delegator, &delegation_a2);
    let hash_a2 = manager.get_delegation_hash(&delegation_a2);
    assert_eq!(manager.get_wallet_delegation(&delegator, &delegate_a), Some(hash_a2));
    assert_eq!(manager.get_wallet_delegation(&delegator, &delegate_b), Some(hash_b));
}

/// `revoke_by_wallet` disables only the given (delegator, delegate) pair's registered
/// delegation without needing the caller to reconstruct the full `Delegation` struct, and
/// without touching any other delegate funded by the same wallet.
#[test]
fn test_revoke_by_wallet() {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let manager = DelegationManagerClient::new(
        &env,
        &env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner)),
    );

    let delegator = Address::generate(&env);
    let delegate = Address::generate(&env);
    let other_delegate = Address::generate(&env);
    let delegation = Delegation {
        delegate: delegate.clone(),
        delegator: delegator.clone(),
        authority: BytesN::from_array(&env, &[0xff; 32]),
        caveats: Vec::new(&env),
        salt: 1,
        nonce: 0,
        signature: BytesN::from_array(&env, &[0u8; 64]),
    };
    let other_delegation = Delegation {
        delegate: other_delegate.clone(),
        delegator: delegator.clone(),
        authority: BytesN::from_array(&env, &[0xff; 32]),
        caveats: Vec::new(&env),
        salt: 2,
        nonce: 0,
        signature: BytesN::from_array(&env, &[0u8; 64]),
    };
    manager.register_delegation(&delegator, &delegation);
    manager.register_delegation(&delegator, &other_delegation);
    let hash = manager.get_delegation_hash(&delegation);
    let other_hash = manager.get_delegation_hash(&other_delegation);
    assert_eq!(manager.is_delegation_disabled(&hash), false);
    assert_eq!(manager.is_delegation_disabled(&other_hash), false);

    manager.revoke_by_wallet(&delegator, &delegate);
    assert_eq!(manager.is_delegation_disabled(&hash), true);
    // The other delegate's delegation from the same wallet stays live.
    assert_eq!(manager.is_delegation_disabled(&other_hash), false);

    // Revoking a (delegator, delegate) pair with no active delegation must fail cleanly.
    let other_delegator = Address::generate(&env);
    let result = manager.try_revoke_by_wallet(&other_delegator, &delegate);
    assert!(result.is_err(), "revoking a pair with no registered delegation must fail");
}

/// `set_policy` updates a policy's terms in place — a caveat referencing that policy_id
/// (via the `0xFE`-prefixed marker) picks up the new terms on the very next redemption,
/// with no change to the delegation's hash or signature.
#[test]
fn test_set_policy_updates_terms_without_new_delegation() {
    let env = Env::default();
    env.mock_all_auths();

    let owner_admin = Address::generate(&env);
    let manager_id = env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner_admin));
    let manager = DelegationManagerClient::new(&env, &manager_id);

    let (owner_key, owner_address) = generate_signing_identity(&env);
    let wallet_id = env.register(CustomAccount, CustomAccountArgs::__constructor(&owner_address, &manager_id));

    let policies_id = env.register(Policies, PoliciesArgs::__constructor(&manager_id));
    manager.set_policies_contract(&policies_id);

    let redeemer = Address::generate(&env);
    let receiver = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_id = sac.address();
    let token_asset_client = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);

    let starting_balance: i128 = 1_000_000_000i128;
    token_asset_client.mint(&wallet_id, &starting_balance);

    // Seed a tight initial spend limit under policy_id 1.
    let policy_id: u64 = 1;
    let tight_limit: i128 = 10_000_000i128;
    manager.set_policy(&wallet_id, &policy_id, &spend_limit_terms(&env, &token_id, tight_limit, 86_400));

    // Caveat terms are the marker `0xFE ++ policy_id:u64_be`, not inline terms.
    let mut marker_terms = Bytes::new(&env);
    marker_terms.push_back(0xFEu32 as u8);
    marker_terms.append(&Bytes::from_array(&env, &policy_id.to_be_bytes()));
    let caveats = Vec::from_array(&env, [Caveat { enforcer: policies_id.clone(), terms: marker_terms }]);

    let delegation_unsigned = Delegation {
        delegate: redeemer.clone(),
        delegator: wallet_id.clone(),
        authority: BytesN::from_array(&env, &[0xff; 32]),
        caveats,
        salt: 9,
        nonce: u64::MAX,
        signature: BytesN::from_array(&env, &[0u8; 64]),
    };
    let hash = manager.get_delegation_hash(&delegation_unsigned);
    let signature = sign_hash_sep53(&env, &owner_key, &hash);
    let delegation = Delegation { signature, ..delegation_unsigned };

    let make_transfer_execution = |amount: i128| {
        let args: Vec<Val> = Vec::from_array(
            &env,
            [wallet_id.clone().into_val(&env), receiver.clone().into_val(&env), amount.into_val(&env)],
        );
        Execution { target: token_id.clone(), function: Symbol::new(&env, "transfer"), args }
    };

    let contexts = Vec::from_array(&env, [Vec::from_array(&env, [delegation.clone()])]);

    // An amount that exceeds the tight initial limit must be rejected.
    let over_tight_limit: i128 = 50_000_000i128;
    let blocked = manager.try_redeem_delegations(
        &redeemer,
        &contexts,
        &Vec::from_array(&env, [make_transfer_execution(over_tight_limit)]),
    );
    assert!(blocked.is_err(), "transfer over the tight initial limit must be rejected");
    assert_eq!(token_client.balance(&wallet_id), starting_balance);

    // Raise the limit via set_policy — no new delegation, hash/signature untouched.
    let raised_limit: i128 = 100_000_000i128;
    manager.set_policy(&wallet_id, &policy_id, &spend_limit_terms(&env, &token_id, raised_limit, 86_400));

    // The same delegation, unmodified, now permits the previously-blocked amount.
    manager.redeem_delegations(
        &redeemer,
        &contexts,
        &Vec::from_array(&env, [make_transfer_execution(over_tight_limit)]),
    );
    assert_eq!(token_client.balance(&wallet_id), starting_balance - over_tight_limit);
}

/// `set_policies` seeds/updates several policy ids in a single signed call — used right
/// after registering a delegation whose caveats reference those ids.
#[test]
fn test_set_policies_batch() {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let manager = DelegationManagerClient::new(
        &env,
        &env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner)),
    );

    let delegator = Address::generate(&env);
    let terms_a = Bytes::from_array(&env, &[1, 2, 3]);
    let terms_b = Bytes::from_array(&env, &[4, 5, 6]);

    manager.set_policies(
        &delegator,
        &Vec::from_array(&env, [1u64, 2u64]),
        &Vec::from_array(&env, [terms_a.clone(), terms_b.clone()]),
    );

    assert_eq!(manager.get_policy(&delegator, &1u64), terms_a);
    assert_eq!(manager.get_policy(&delegator, &2u64), terms_b);

    // Mismatched batch lengths must be rejected.
    let result = manager.try_set_policies(
        &delegator,
        &Vec::from_array(&env, [3u64]),
        &Vec::from_array(&env, [terms_a.clone(), terms_b.clone()]),
    );
    assert!(result.is_err(), "mismatched policy_ids/terms_list lengths must fail");
}

// --- P0-2: empty delegation chain bypassed ALL policy/delegation validation (fixed) ---
//
// Before the fix, `redeem_delegations` special-cased a zero-length chain: phase 1 `continue`d
// past every signature/nonce/authority check, and phase 2 invoked the execution directly from
// the DelegationManager instead of through the policy hooks. Pointing that direct invoke at a
// *victim* wallet's `execute_from_executor` turned the manager into a confused deputy — the
// wallet trusts any call whose direct caller is the manager, and the manager would make that
// call for anyone passing an empty chain. Any wallet on this manager was drainable by anyone,
// with no delegation, no victim signature, and no policy. This is the exact exploit payload,
// authorized by ONLY the attacker (`mock_auths`, not `mock_all_auths`) to prove no victim
// signature is involved; it must now be rejected with `EmptyChain` and move zero funds.
#[test]
fn test_empty_chain_confused_deputy_drain_is_rejected() {
    let env = Env::default();

    let admin = Address::generate(&env);
    let (_victim_key, victim_owner) = generate_signing_identity(&env);
    let attacker = Address::generate(&env);

    env.mock_all_auths();

    let manager_id = env.register(DelegationManager, DelegationManagerArgs::__constructor(&admin));
    let manager = DelegationManagerClient::new(&env, &manager_id);

    let wallet_id = env.register(CustomAccount, CustomAccountArgs::__constructor(&victim_owner, &manager_id));
    let _wallet = CustomAccountClient::new(&env, &wallet_id);

    let token_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_id = sac.address();
    let token_asset_client = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);
    let starting_balance: i128 = 500_000_000i128;
    token_asset_client.mint(&wallet_id, &starting_balance);

    let inner_args: Vec<Val> = Vec::from_array(
        &env,
        [
            wallet_id.clone().into_val(&env),
            attacker.clone().into_val(&env),
            starting_balance.into_val(&env),
        ],
    );
    let execution = Execution {
        target: wallet_id.clone(),
        function: Symbol::new(&env, "execute_from_executor"),
        args: Vec::from_array(
            &env,
            [
                token_id.clone().into_val(&env),
                Symbol::new(&env, "transfer").into_val(&env),
                inner_args.into_val(&env),
            ],
        ),
    };

    let empty_chain: Vec<Delegation> = Vec::new(&env);
    let contexts = Vec::from_array(&env, [empty_chain]);
    let executions = Vec::from_array(&env, [execution.clone()]);

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &attacker,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &manager_id,
            fn_name: "redeem_delegations",
            args: (attacker.clone(), contexts.clone(), executions.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    let result = manager.try_redeem_delegations(&attacker, &contexts, &executions);
    assert!(result.is_err(), "empty-chain redemption must be rejected");
    // No funds moved: the confused-deputy drain is fully blocked.
    assert_eq!(token_client.balance(&wallet_id), starting_balance);
    assert_eq!(token_client.balance(&attacker), 0);
}

/// A batch that mixes one valid chain with one empty chain must reject the *whole* batch —
/// the empty chain cannot piggyback on a legitimate redemption to slip an unpoliced execution
/// through. Nothing in the batch may execute.
#[test]
fn test_empty_chain_in_batch_rejects_entire_batch() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let manager_id = env.register(DelegationManager, DelegationManagerArgs::__constructor(&admin));
    let manager = DelegationManagerClient::new(&env, &manager_id);

    let delegator_id = env.register_contract(None, MockCustomAccount);
    let delegator = MockCustomAccountClient::new(&env, &delegator_id);
    delegator.init(&admin, &manager_id);

    let delegate = Address::generate(&env);
    let target = env.register_contract(None, DummyContract);

    let valid = Delegation {
        delegate: delegate.clone(),
        delegator: delegator_id.clone(),
        authority: BytesN::from_array(&env, &[0xff; 32]),
        caveats: Vec::from_array(&env, [noop_caveat(&env, &manager)]),
        salt: 0,
        nonce: 0,
        signature: BytesN::from_array(&env, &[0u8; 64]),
    };
    let exec = Execution { target: target.clone(), function: Symbol::new(&env, "test"), args: Vec::new(&env) };

    let contexts = Vec::from_array(
        &env,
        [Vec::from_array(&env, [valid]), Vec::<Delegation>::new(&env)],
    );
    let executions = Vec::from_array(&env, [exec.clone(), exec]);

    let result = manager.try_redeem_delegations(&delegate, &contexts, &executions);
    assert!(result.is_err(), "a batch containing any empty chain must be rejected wholesale");
    // The valid chain's nonce must be untouched — the whole batch reverted before execution.
    assert_eq!(manager.get_nonce(&delegator_id), 0);
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
    let manager_id = env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner_admin));
    let manager = DelegationManagerClient::new(&env, &manager_id);

    let (owner_key, owner_address) = generate_signing_identity(&env);
    let wallet_id = env.register(CustomAccount, CustomAccountArgs::__constructor(&owner_address, &manager_id));

    let policies_id = env.register(Policies, PoliciesArgs::__constructor(&manager_id));
    manager.set_policies_contract(&policies_id);

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

// ---------------------------------------------------------------------------
// P0-3: upgrade timelock
// ---------------------------------------------------------------------------

#[test]
fn test_manager_upgrade_before_delay_elapsed_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let owner = Address::generate(&env);
    let manager = DelegationManagerClient::new(
        &env,
        &env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner)),
    );

    let hash = BytesN::from_array(&env, &[7u8; 32]);
    manager.propose_upgrade(&hash);

    let result = manager.try_update_current_contract_wasm(&hash);
    assert!(result.is_err(), "upgrade must be rejected before the timelock elapses");
}

#[test]
#[should_panic]
fn test_manager_upgrade_after_delay_elapsed_proceeds() {
    let env = Env::default();
    env.mock_all_auths();
    let owner = Address::generate(&env);
    let manager = DelegationManagerClient::new(
        &env,
        &env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner)),
    );

    let hash = BytesN::from_array(&env, &[7u8; 32]);
    manager.propose_upgrade(&hash);
    env.ledger().set_timestamp(env.ledger().timestamp() + UPGRADE_DELAY_SECS);

    // Timelock check passes; panics on the bogus wasm hash inside the real
    // deployer call, proving execution reached past the timelock gate.
    manager.update_current_contract_wasm(&hash);
}

#[test]
fn test_manager_upgrade_without_proposal_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let owner = Address::generate(&env);
    let manager = DelegationManagerClient::new(
        &env,
        &env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner)),
    );

    let hash = BytesN::from_array(&env, &[7u8; 32]);
    let result = manager.try_update_current_contract_wasm(&hash);
    assert!(result.is_err(), "upgrade with no prior proposal must be rejected");
}

#[test]
fn test_manager_upgrade_hash_mismatch_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let owner = Address::generate(&env);
    let manager = DelegationManagerClient::new(
        &env,
        &env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner)),
    );

    let proposed = BytesN::from_array(&env, &[7u8; 32]);
    let other = BytesN::from_array(&env, &[9u8; 32]);
    manager.propose_upgrade(&proposed);
    env.ledger().set_timestamp(env.ledger().timestamp() + UPGRADE_DELAY_SECS);

    let result = manager.try_update_current_contract_wasm(&other);
    assert!(result.is_err(), "executing a different hash than proposed must be rejected");
}

#[test]
fn test_manager_cancel_upgrade_blocks_execution() {
    let env = Env::default();
    env.mock_all_auths();
    let owner = Address::generate(&env);
    let manager = DelegationManagerClient::new(
        &env,
        &env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner)),
    );

    let hash = BytesN::from_array(&env, &[7u8; 32]);
    manager.propose_upgrade(&hash);
    manager.cancel_upgrade();
    env.ledger().set_timestamp(env.ledger().timestamp() + UPGRADE_DELAY_SECS);

    let result = manager.try_update_current_contract_wasm(&hash);
    assert!(result.is_err(), "a cancelled proposal must not be executable");
}

#[test]
fn test_manager_propose_upgrade_without_owner_signature_traps_auth() {
    let env = Env::default();
    let owner = Address::generate(&env);
    env.mock_all_auths();
    let manager = DelegationManagerClient::new(
        &env,
        &env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner)),
    );

    env.set_auths(&[]);
    let hash = BytesN::from_array(&env, &[7u8; 32]);
    let result = manager.try_propose_upgrade(&hash);
    assert!(result.is_err());
}

#[test]
fn test_manager_duplicate_propose_upgrade_overwrites_pending_hash() {
    let env = Env::default();
    env.mock_all_auths();
    let owner = Address::generate(&env);
    let manager = DelegationManagerClient::new(
        &env,
        &env.register(DelegationManager, DelegationManagerArgs::__constructor(&owner)),
    );

    let first = BytesN::from_array(&env, &[7u8; 32]);
    let second = BytesN::from_array(&env, &[8u8; 32]);
    manager.propose_upgrade(&first);
    manager.propose_upgrade(&second);
    env.ledger().set_timestamp(env.ledger().timestamp() + UPGRADE_DELAY_SECS);

    let result = manager.try_update_current_contract_wasm(&first);
    assert!(result.is_err(), "superseded proposal must no longer be executable");
}
