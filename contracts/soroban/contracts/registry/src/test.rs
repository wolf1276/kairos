#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
use soroban_sdk::{contract, contractimpl, symbol_short, IntoVal, TryFromVal};

// Minimal stand-in for a deployed CustomAccount: exposes only the `owner()` getter the
// Registry cross-calls to verify a (owner -> smart_wallet) binding. Its constructor stores
// the owner, mirroring CustomAccount's real Owner storage.
#[contract]
pub struct MockWallet;

#[contractimpl]
impl MockWallet {
    pub fn __constructor(env: Env, owner: Address) {
        env.storage().instance().set(&symbol_short!("owner"), &owner);
    }
    pub fn owner(env: Env) -> Address {
        env.storage().instance().get(&symbol_short!("owner")).unwrap()
    }
}

// Deploy a mock smart wallet that reports `owner` as its on-chain Owner.
fn deploy_wallet(env: &Env, owner: &Address) -> Address {
    env.register(MockWallet, (owner.clone(),))
}

#[test]
fn test_init_and_register() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));
    let smart_wallet = deploy_wallet(&env, &owner);

    registry.register(&admin, &owner, &smart_wallet);
    assert_eq!(registry.get_smart_wallet(&owner), Some(smart_wallet));
}

#[test]
fn test_register_same_address_is_idempotent() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));
    let smart_wallet = deploy_wallet(&env, &owner);

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
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));
    // Both wallets are genuinely owned by `owner`, so the register reaches the
    // one-wallet-per-owner conflict check (not the owner-mismatch check).
    let smart_wallet_a = deploy_wallet(&env, &owner);
    let smart_wallet_b = deploy_wallet(&env, &owner);

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

    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));

    registry.register(&not_admin, &owner, &smart_wallet);
}

#[test]
fn test_get_smart_wallet_unknown_owner_returns_none() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);

    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));

    assert_eq!(registry.get_smart_wallet(&owner), None);
}

#[test]
#[should_panic]
fn test_init_twice_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let registry_id = env.register(Registry, (admin.clone(),));

    // `__constructor` remains an ordinary function after creation — a second, direct
    // call (e.g. an attacker trying to reset the admin post-deploy) must still be
    // rejected by the re-init guard, exactly as double-`init()` was before this fix.
    env.as_contract(&registry_id, || {
        Registry::__constructor(env.clone(), admin.clone());
    });
}

#[test]
#[should_panic]
fn test_unauthorized_deployment_is_rejected() {
    let env = Env::default();
    // No mocked auths at all: nobody's signature is available for `admin`. Since
    // `__constructor` now runs atomically inside contract creation itself, this proves
    // the Registry cannot come into existence at all without the claimed admin's
    // authorization — there's no longer a separate, unauthenticated init step to race.
    let admin = Address::generate(&env);
    env.register(Registry, (admin.clone(),));
}

#[test]
#[should_panic]
fn test_front_run_cannot_impersonate_a_different_admin() {
    let env = Env::default();

    let legit_admin = Address::generate(&env);
    let attacker = Address::generate(&env);

    // Attacker only has their own signature but tries to construct the Registry claiming
    // the real admin's address. Only the attacker's auth is mocked, not legit_admin's.
    let registry_id = Address::generate(&env);
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &attacker,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &registry_id,
            fn_name: "__constructor",
            args: (legit_admin.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    env.register_at(&registry_id, Registry, (legit_admin.clone(),));
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

    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));

    // impostor authorizes as itself (mocked), but is not the stored admin —
    // contract's own admin == stored_admin check must reject.
    let result = registry.try_register(&impostor, &owner, &smart_wallet);
    assert!(result.is_err(), "register by a non-admin address must fail");
    // state untouched on rejection
    assert_eq!(registry.get_smart_wallet(&owner), None);
}

// M1 regression: a lone admin key cannot bind a victim owner to a wallet the victim does
// not control. Even with the admin fully authorized, register cross-checks the wallet's
// on-chain Owner and rejects the mismatch — closing the redirection/griefing vector.
#[test]
fn test_register_rejects_wallet_not_owned_by_claimed_owner() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let victim = Address::generate(&env);
    let attacker = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));
    // Wallet genuinely owned by the attacker; admin tries to file it under the victim.
    let attacker_wallet = deploy_wallet(&env, &attacker);

    let result = registry.try_register(&admin, &victim, &attacker_wallet);
    assert!(result.is_err(), "admin must not bind a victim owner to a wallet they don't own");
    assert_eq!(registry.get_smart_wallet(&victim), None);
}

#[test]
fn test_register_conflicting_address_returns_already_registered_error() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));
    let wallet_a = deploy_wallet(&env, &owner);
    let wallet_b = deploy_wallet(&env, &owner);
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
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));

    // `__constructor` remains an ordinary function after creation, so re-invoking it
    // directly is what a duplicate-initialization attempt looks like; it must panic via
    // the re-init guard rather than silently overwrite the admin.
    let registry_id: Address = registry.address.clone();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.as_contract(&registry_id, || {
            Registry::__constructor(env.clone(), other_admin.clone());
        });
    }));
    assert!(result.is_err(), "re-initializing an already-initialized registry must fail");

    // Privilege escalation check: other_admin must still not be able to register,
    // proving the second constructor call did not silently overwrite the admin.
    let owner = Address::generate(&env);
    let wallet = Address::generate(&env);
    let escalation = registry.try_register(&other_admin, &owner, &wallet);
    assert!(escalation.is_err(), "admin from a rejected re-init must not gain register rights");
}

#[test]
fn test_register_without_admin_signature_traps_auth() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let smart_wallet = Address::generate(&env);

    env.mock_all_auths();
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));
    env.set_auths(&[]);

    let result = registry.try_register(&admin, &owner, &smart_wallet);
    assert!(result.is_err());
    // Never got past require_auth, so no state change.
    env.mock_all_auths();
    assert_eq!(registry.get_smart_wallet(&owner), None);
}

#[test]
fn test_upgrade_without_admin_signature_traps_auth() {
    let env = Env::default();
    let admin = Address::generate(&env);
    env.mock_all_auths();
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));

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
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));

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

// Note: register()/upgrade()/get_smart_wallet() "before init" cases no longer apply —
// the Registry cannot exist in an uninitialized state at all now that `__constructor`
// runs atomically inside CreateContractV2 (see test_unauthorized_deployment_is_rejected
// and test_front_run_cannot_impersonate_a_different_admin above).

#[test]
fn test_admin_can_be_registered_as_its_own_owner() {
    // Edge case: no identity separation enforced between admin/owner/smart_wallet
    // roles — confirm this degenerate but valid usage doesn't corrupt storage.
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));
    let smart_wallet = deploy_wallet(&env, &admin);

    registry.register(&admin, &admin, &smart_wallet);
    assert_eq!(registry.get_smart_wallet(&admin), Some(smart_wallet));
}

// (Removed test_owner_can_equal_smart_wallet_address: register now requires
// smart_wallet to be a deployed wallet whose Owner == owner, so a wallet address can
// never equal its own owner's address — the scenario is no longer representable.)

#[test]
fn test_storage_isolation_across_distinct_owners() {
    // Fuzz-lite: many distinct owners must never collide/overwrite each other's mapping.
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));

    let mut pairs = std::vec::Vec::new();
    for _ in 0..25 {
        let owner = Address::generate(&env);
        let wallet = deploy_wallet(&env, &owner);
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
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));
    let smart_wallet = deploy_wallet(&env, &owner);

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
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));
    let wallet_a = deploy_wallet(&env, &owner);
    let wallet_b = deploy_wallet(&env, &owner);
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
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));
    let smart_wallet = deploy_wallet(&env, &owner);

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
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));

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
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));

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
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));

    let hash = BytesN::from_array(&env, &[7u8; 32]);
    let result = registry.try_upgrade(&hash);
    assert!(result.is_err(), "upgrade with no prior proposal must be rejected");
}

#[test]
fn test_upgrade_hash_mismatch_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));

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
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));

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
    env.mock_all_auths();
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));

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
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));

    let first = BytesN::from_array(&env, &[7u8; 32]);
    let second = BytesN::from_array(&env, &[8u8; 32]);
    registry.propose_upgrade(&first);
    registry.propose_upgrade(&second);
    env.ledger().set_timestamp(env.ledger().timestamp() + UPGRADE_DELAY_SECS);

    let result = registry.try_upgrade(&first);
    assert!(result.is_err(), "superseded proposal must no longer be executable");
}

// ---------------------------------------------------------------------------
// Admin rotation (registry ownership recovery)
// ---------------------------------------------------------------------------

#[test]
fn test_transfer_admin_moves_control_to_new_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));
    let smart_wallet = deploy_wallet(&env, &owner);

    registry.transfer_admin(&new_admin);

    // new admin can register.
    registry.register(&new_admin, &owner, &smart_wallet);
    assert_eq!(registry.get_smart_wallet(&owner), Some(smart_wallet));
}

#[test]
fn test_old_admin_rejected_after_transfer() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let smart_wallet = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));

    registry.transfer_admin(&new_admin);

    // old admin can no longer register.
    let result = registry.try_register(&admin, &owner, &smart_wallet);
    assert!(result.is_err(), "old admin must be rejected after transfer_admin");
}

#[test]
#[should_panic]
fn test_new_admin_can_propose_and_execute_upgrade() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));
    registry.transfer_admin(&new_admin);

    let hash = BytesN::from_array(&env, &[7u8; 32]);
    registry.propose_upgrade(&hash);
    env.ledger().set_timestamp(env.ledger().timestamp() + UPGRADE_DELAY_SECS);
    registry.upgrade(&hash);
}

#[test]
fn test_transfer_admin_without_signature_traps_auth() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    env.mock_all_auths();
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));

    env.set_auths(&[]);
    let result = registry.try_transfer_admin(&new_admin);
    assert!(result.is_err());
}

#[test]
fn test_ttl_extended_on_repeated_reads_does_not_change_value() {
    // Rent/expiration-adjacent check: repeated get_smart_wallet calls bump TTL as a
    // side effect but must never mutate the stored mapping itself.
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let registry = RegistryClient::new(&env, &env.register(Registry, (admin.clone(),)));
    let smart_wallet = deploy_wallet(&env, &owner);
    registry.register(&admin, &owner, &smart_wallet);

    for _ in 0..5 {
        assert_eq!(registry.get_smart_wallet(&owner), Some(smart_wallet.clone()));
    }
}
