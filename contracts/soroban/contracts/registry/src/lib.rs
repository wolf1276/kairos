#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short, panic_with_error, Address, BytesN, Env,
};

const BUMP_THRESHOLD: u32 = 10000;
const BUMP_LIMIT: u32 = 100000;

#[contracttype]
pub enum DataKey {
    Admin,
    SmartWallet(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RegistryError {
    NotAuthorized = 1,
    AlreadyInitialized = 2,
    AlreadyRegistered = 3,
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

    // Admin-gated contract upgrade
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}
mod test;
