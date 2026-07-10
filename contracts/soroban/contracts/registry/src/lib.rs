#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short, panic_with_error, Address, BytesN, Env,
};

const BUMP_THRESHOLD: u32 = 10000;
const BUMP_LIMIT: u32 = 100000;
// P0-3 fix: upgrade timelock. Compromised/malicious admin key can no longer swap the
// deployed wasm in the same transaction that proposes it — there must be a 3-day gap
// during which the pending hash is observable on-chain and the upgrade can be cancelled.
const UPGRADE_DELAY_SECS: u64 = 259200; // 3 days

#[contracttype]
pub enum DataKey {
    Admin,
    SmartWallet(Address),
    PendingUpgrade,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RegistryError {
    NotAuthorized = 1,
    AlreadyInitialized = 2,
    AlreadyRegistered = 3,
    NoPendingUpgrade = 4,
    TimelockNotElapsed = 5,
}

#[contract]
pub struct Registry;

#[contractimpl]
impl Registry {
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, RegistryError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().extend_ttl(BUMP_THRESHOLD, BUMP_LIMIT);
    }

    // Funder/backend attests that `owner` deployed `smart_wallet`. Owner-gating is
    // intentionally skipped here (the funder already sponsors and observes the deploy
    // transaction) so onboarding doesn't need a third Freighter signing round trip.
    pub fn register(env: Env, admin: Address, owner: Address, smart_wallet: Address) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != stored_admin {
            panic_with_error!(&env, RegistryError::NotAuthorized);
        }

        let key = DataKey::SmartWallet(owner);
        if let Some(existing) = env.storage().persistent().get::<_, Address>(&key) {
            if existing != smart_wallet {
                panic_with_error!(&env, RegistryError::AlreadyRegistered);
            }
            env.storage().persistent().extend_ttl(&key, BUMP_THRESHOLD, BUMP_LIMIT);
            return;
        }

        env.storage().persistent().set(&key, &smart_wallet);
        env.storage().persistent().extend_ttl(&key, BUMP_THRESHOLD, BUMP_LIMIT);

        env.events().publish((symbol_short!("reg"),), smart_wallet);
    }

    pub fn get_smart_wallet(env: Env, owner: Address) -> Option<Address> {
        let key = DataKey::SmartWallet(owner);
        if env.storage().persistent().has(&key) {
            env.storage().persistent().extend_ttl(&key, BUMP_THRESHOLD, BUMP_LIMIT);
        }
        env.storage().persistent().get(&key)
    }

    // Admin-gated: queue an upgrade to take effect after UPGRADE_DELAY_SECS.
    pub fn propose_upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        let unlock_at = env.ledger().timestamp() + UPGRADE_DELAY_SECS;
        env.storage().instance().set(&DataKey::PendingUpgrade, &(new_wasm_hash, unlock_at));
    }

    // Admin-gated: cancel a queued upgrade before it executes.
    pub fn cancel_upgrade(env: Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().remove(&DataKey::PendingUpgrade);
    }

    // Admin-gated contract upgrade. Only executes a hash that was proposed via
    // propose_upgrade() at least UPGRADE_DELAY_SECS ago.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let (pending_hash, unlock_at): (BytesN<32>, u64) = env
            .storage()
            .instance()
            .get(&DataKey::PendingUpgrade)
            .unwrap_or_else(|| panic_with_error!(&env, RegistryError::NoPendingUpgrade));
        if pending_hash != new_wasm_hash {
            panic_with_error!(&env, RegistryError::NoPendingUpgrade);
        }
        if env.ledger().timestamp() < unlock_at {
            panic_with_error!(&env, RegistryError::TimelockNotElapsed);
        }

        env.storage().instance().remove(&DataKey::PendingUpgrade);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}
mod test;
