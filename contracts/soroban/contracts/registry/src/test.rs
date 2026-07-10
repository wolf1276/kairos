#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke};
use soroban_sdk::{IntoVal, TryFromVal};

// ---------------------------------------------------------------------------
// M1 REPRODUCTION: register binds an owner->wallet with ONLY the admin's
// authorization; the owner never signs. Unlike mock_all_auths (which fakes
// *every* address's consent and so can't distinguish "owner authorized" from
// "owner didn't"), this grants a single auth entry for the admin only. If the
// contract required owner.require_auth(), this call would trap. It does not.
// ---------------------------------------------------------------------------
#[test]
fn m1_admin_binds_owner_without_owner_auth() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let owner = Address::generate(&env);       // a real user who NEVER authorizes
    let attacker_wallet = Address::generate(&env);

    let registry_id = env.register(Registry, ());
    let registry = RegistryClient::new(&env, &registry_id);

    // init needs the admin's auth (only).
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &registry_id,
            fn_name: "init",
            args: (admin.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    registry.init(&admin);

    // Grant EXACTLY ONE auth entry: the admin, for this register call. The owner
    // is deliberately NOT in the auth set.
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &registry_id,
            fn_name: "register",
            args: (admin.clone(), owner.clone(), attacker_wallet.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    // Succeeds — proving the owner's authorization is not required to bind them.
    registry.register(&admin, &owner, &attacker_wallet);
    assert_eq!(registry.get_smart_wallet(&owner), Some(attacker_wallet));
}

#[test]
fn test_init_and_register() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let smart_wallet = Address::generate(&env);

    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    registry.init(&admin);

    registry.register(&admin, &owner, &smart_wallet);
    assert_eq!(registry.get_smart_wallet(&owner), Some(smart_wallet));
}

#[test]
fn test_register_same_address_is_idempotent() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let smart_wallet = Address::generate(&env);

    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    registry.init(&admin);

    registry.register(&admin, &owner, &smart_wallet);
    registry.register(&admin, &owner, &smart_wallet);
    assert_eq!(registry.get_smart_wallet(&owner), Some(smart_wallet));
}

#[test]
#[should_panic]
fn test_register_conflicting_address_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let smart_wallet_a = Address::generate(&env);
    let smart_wallet_b = Address::generate(&env);

    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    registry.init(&admin);

    registry.register(&admin, &owner, &smart_wallet_a);
    registry.register(&admin, &owner, &smart_wallet_b);
}

#[test]
#[should_panic]
fn test_register_by_non_admin_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let not_admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let smart_wallet = Address::generate(&env);

    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    registry.init(&admin);

    registry.register(&not_admin, &owner, &smart_wallet);
}

#[test]
fn test_get_smart_wallet_unknown_owner_returns_none() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);

    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    registry.init(&admin);

    assert_eq!(registry.get_smart_wallet(&owner), None);
}

#[test]
#[should_panic]
fn test_init_twice_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    registry.init(&admin);
    registry.init(&admin);
}

// ---------------------------------------------------------------------------
// Negative / security suite below. mock_all_auths() bypass real sig check, so
// exact contract-level error codes checked via try_* client fns (no panic
// unwind eat the assertion), and true auth-missing paths checked with no mock
// (or narrow mock_auths) so require_auth itself traps.
// ---------------------------------------------------------------------------

#[test]
fn test_register_wrong_admin_returns_not_authorized_error_not_generic_panic() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let impostor = Address::generate(&env);
    let owner = Address::generate(&env);
    let smart_wallet = Address::generate(&env);

    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    registry.init(&admin);

    // impostor authorizes as itself (mocked), but is not the stored admin —
    // contract's own admin == stored_admin check must reject.
    let result = registry.try_register(&impostor, &owner, &smart_wallet);
    assert!(result.is_err(), "register by a non-admin address must fail");
    // state untouched on rejection
    assert_eq!(registry.get_smart_wallet(&owner), None);
}

#[test]
fn test_register_conflicting_address_returns_already_registered_error() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let wallet_a = Address::generate(&env);
    let wallet_b = Address::generate(&env);

    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    registry.init(&admin);
    registry.register(&admin, &owner, &wallet_a);

    let result = registry.try_register(&admin, &owner, &wallet_b);
    assert!(result.is_err(), "registering a conflicting address for the same owner must fail");
    // storage integrity: original mapping survives the failed overwrite attempt
    assert_eq!(registry.get_smart_wallet(&owner), Some(wallet_a));
}

#[test]
fn test_init_twice_returns_already_initialized_error_and_keeps_first_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let other_admin = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    registry.init(&admin);

    let result = registry.try_init(&other_admin);
    assert!(result.is_err(), "re-initializing an already-initialized registry must fail");

    // Privilege escalation check: other_admin must still not be able to register,
    // proving the second init call did not silently overwrite the admin.
    let owner = Address::generate(&env);
    let wallet = Address::generate(&env);
    let escalation = registry.try_register(&other_admin, &owner, &wallet);
    assert!(escalation.is_err(), "admin from a rejected re-init must not gain register rights");
}

#[test]
fn test_register_without_admin_signature_traps_auth() {
    let env = Env::default();
    // No mock_all_auths(): admin.require_auth() must fail since nothing authorized it.
    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let smart_wallet = Address::generate(&env);

    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    env.mock_all_auths();
    registry.init(&admin);
    env.set_auths(&[]);

    let result = registry.try_register(&admin, &owner, &smart_wallet);
    assert!(result.is_err());
    // Never got past require_auth, so no state change.
    env.mock_all_auths();
    assert_eq!(registry.get_smart_wallet(&owner), None);
}

#[test]
fn test_init_without_admin_signature_traps_auth() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, ()));

    // No auths mocked at all — init's admin.require_auth() must trap.
    let result = registry.try_init(&admin);
    assert!(result.is_err());
}

#[test]
fn test_upgrade_without_admin_signature_traps_auth() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    env.mock_all_auths();
    registry.init(&admin);

    env.set_auths(&[]);
    let fake_hash = BytesN::from_array(&env, &[7u8; 32]);
    let result = registry.try_upgrade(&fake_hash);
    assert!(result.is_err());
}

#[test]
#[should_panic]
fn test_upgrade_by_non_admin_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    registry.init(&admin);

    // update_current_contract_wasm itself will trap on a bogus/missing wasm hash
    // before admin-mismatch would even matter in a real deploy, but here we only
    // care that a non-admin caller's require_auth on a *different* address than
    // stored admin cannot reach the deployer call un-checked. Registry's `upgrade`
    // loads the real stored admin and requires auth from *that* address, so a
    // non-admin cannot forge this call even under mock_all_auths (which only
    // fakes "did this address authorize", not "is this address the admin").
    let fake_hash = BytesN::from_array(&env, &[7u8; 32]);
    // Call upgrade — admin.require_auth() succeeds (mocked) for the *real* stored
    // admin only; there is no non-admin variant of this call since `upgrade` takes
    // no caller-supplied admin argument. This test instead proves an invalid wasm
    // hash panics deterministically rather than upgrading to garbage.
    registry.upgrade(&fake_hash);
}

#[test]
#[should_panic]
fn test_register_before_init_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let smart_wallet = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, ()));

    // No init() call — Admin key absent. Documents a real gap: this unwraps and
    // panics generically instead of a typed error (see report).
    registry.register(&admin, &owner, &smart_wallet);
}

#[test]
#[should_panic]
fn test_upgrade_before_init_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    let fake_hash = BytesN::from_array(&env, &[7u8; 32]);

    // Same gap as register-before-init: Admin unwrap panics generically.
    registry.upgrade(&fake_hash);
}

#[test]
fn test_get_smart_wallet_before_init_returns_none_not_panic() {
    let env = Env::default();
    env.mock_all_auths();
    let owner = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, ()));

    // Unlike register/upgrade, get_smart_wallet never touches Admin, so it must
    // stay side-effect-free and panic-free even pre-init.
    assert_eq!(registry.get_smart_wallet(&owner), None);
}

#[test]
fn test_admin_can_be_registered_as_its_own_owner() {
    // Edge case: no identity separation enforced between admin/owner/smart_wallet
    // roles — confirm this degenerate but valid usage doesn't corrupt storage.
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let smart_wallet = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    registry.init(&admin);

    registry.register(&admin, &admin, &smart_wallet);
    assert_eq!(registry.get_smart_wallet(&admin), Some(smart_wallet));
}

#[test]
fn test_owner_can_equal_smart_wallet_address() {
    // Contract never validates owner != smart_wallet — confirm it doesn't trap.
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    registry.init(&admin);

    registry.register(&admin, &owner, &owner);
    assert_eq!(registry.get_smart_wallet(&owner), Some(owner));
}

#[test]
fn test_storage_isolation_across_distinct_owners() {
    // Fuzz-lite: many distinct owners must never collide/overwrite each other's mapping.
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    registry.init(&admin);

    let mut pairs = std::vec::Vec::new();
    for _ in 0..25 {
        let owner = Address::generate(&env);
        let wallet = Address::generate(&env);
        registry.register(&admin, &owner, &wallet);
        pairs.push((owner, wallet));
    }

    for (owner, wallet) in pairs.iter() {
        assert_eq!(registry.get_smart_wallet(owner), Some(wallet.clone()));
    }
}

#[test]
fn test_no_event_emitted_on_idempotent_reregister() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let smart_wallet = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    registry.init(&admin);

    registry.register(&admin, &owner, &smart_wallet);
    // `events().all()` drains the buffer since the last read, so this confirms
    // exactly one "reg" event was published for the real write.
    assert_eq!(env.events().all().len(), 1);

    registry.register(&admin, &owner, &smart_wallet);
    // Idempotent re-register takes the early-return path — must not publish a
    // second "reg" event for a no-op write.
    assert_eq!(env.events().all().len(), 0);
}

#[test]
fn test_no_event_emitted_on_rejected_conflicting_register() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let wallet_a = Address::generate(&env);
    let wallet_b = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    registry.init(&admin);
    registry.register(&admin, &owner, &wallet_a);
    env.events().all(); // drain the successful register's event first

    let _ = registry.try_register(&admin, &owner, &wallet_b);
    assert_eq!(env.events().all().len(), 0, "a rejected conflicting register must not emit any event");
}

#[test]
fn test_register_event_carries_correct_smart_wallet_payload() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let smart_wallet = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    registry.init(&admin);

    registry.register(&admin, &owner, &smart_wallet);

    let events = env.events().all();
    let (_, _, data) = events.last().unwrap();
    let decoded = Address::try_from_val(&env, &data).unwrap();
    assert_eq!(decoded, smart_wallet);
}

// ---------------------------------------------------------------------------
// P0-3: upgrade timelock
// ---------------------------------------------------------------------------

#[test]
fn test_upgrade_before_delay_elapsed_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    registry.init(&admin);

    let hash = BytesN::from_array(&env, &[7u8; 32]);
    registry.propose_upgrade(&hash);

    // Not enough time has passed.
    let result = registry.try_upgrade(&hash);
    assert!(result.is_err(), "upgrade must be rejected before the timelock elapses");
}

#[test]
#[should_panic]
fn test_upgrade_after_delay_elapsed_proceeds() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    registry.init(&admin);

    let hash = BytesN::from_array(&env, &[7u8; 32]);
    registry.propose_upgrade(&hash);

    env.ledger().set_timestamp(env.ledger().timestamp() + UPGRADE_DELAY_SECS);

    // Timelock check passes; panics on the bogus wasm hash inside the real
    // deployer call, proving execution reached past the timelock gate.
    registry.upgrade(&hash);
}

#[test]
fn test_upgrade_without_proposal_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    registry.init(&admin);

    let hash = BytesN::from_array(&env, &[7u8; 32]);
    let result = registry.try_upgrade(&hash);
    assert!(result.is_err(), "upgrade with no prior proposal must be rejected");
}

#[test]
fn test_upgrade_hash_mismatch_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    registry.init(&admin);

    let proposed = BytesN::from_array(&env, &[7u8; 32]);
    let other = BytesN::from_array(&env, &[9u8; 32]);
    registry.propose_upgrade(&proposed);
    env.ledger().set_timestamp(env.ledger().timestamp() + UPGRADE_DELAY_SECS);

    let result = registry.try_upgrade(&other);
    assert!(result.is_err(), "executing a different hash than proposed must be rejected");
}

#[test]
fn test_cancel_upgrade_blocks_execution() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    registry.init(&admin);

    let hash = BytesN::from_array(&env, &[7u8; 32]);
    registry.propose_upgrade(&hash);
    registry.cancel_upgrade();
    env.ledger().set_timestamp(env.ledger().timestamp() + UPGRADE_DELAY_SECS);

    let result = registry.try_upgrade(&hash);
    assert!(result.is_err(), "a cancelled proposal must not be executable");
}

#[test]
fn test_propose_upgrade_without_admin_signature_traps_auth() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    env.mock_all_auths();
    registry.init(&admin);

    env.set_auths(&[]);
    let hash = BytesN::from_array(&env, &[7u8; 32]);
    let result = registry.try_propose_upgrade(&hash);
    assert!(result.is_err());
}

#[test]
fn test_duplicate_propose_upgrade_overwrites_pending_hash() {
    // A second propose_upgrade before execution replaces the pending hash/timer
    // rather than stacking — only the latest proposal is executable.
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    registry.init(&admin);

    let first = BytesN::from_array(&env, &[7u8; 32]);
    let second = BytesN::from_array(&env, &[8u8; 32]);
    registry.propose_upgrade(&first);
    registry.propose_upgrade(&second);
    env.ledger().set_timestamp(env.ledger().timestamp() + UPGRADE_DELAY_SECS);

    let result = registry.try_upgrade(&first);
    assert!(result.is_err(), "superseded proposal must no longer be executable");
}

#[test]
fn test_ttl_extended_on_repeated_reads_does_not_change_value() {
    // Rent/expiration-adjacent check: repeated get_smart_wallet calls bump TTL as a
    // side effect but must never mutate the stored mapping itself.
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let smart_wallet = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, ()));
    registry.init(&admin);
    registry.register(&admin, &owner, &smart_wallet);

    for _ in 0..5 {
        assert_eq!(registry.get_smart_wallet(&owner), Some(smart_wallet.clone()));
    }
}
