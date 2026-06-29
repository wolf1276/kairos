#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short, Address, Bytes, BytesN, Env, Symbol, Val, Vec,
    panic_with_error, log, auth::Context, IntoVal, TryFromVal, xdr::ToXdr,
};

#[contracttype]
pub enum DataKey {
    Owner,
    DelegationManager,
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

    // Helper for contract signature validation fallback (e.g. ERC-1271 counterpart)
    pub fn is_valid_signature(env: Env, hash: BytesN<32>, signature: BytesN<64>) -> bool {
        let owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();
        
        let xdr = owner.to_xdr(&env);
        let mut key_bytes = [0u8; 32];
        for i in 0..32 {
            key_bytes[i] = xdr.get(xdr.len() - 32 + i as u32).unwrap();
        }
        let public_key = BytesN::from_array(&env, &key_bytes);

        let message = Bytes::from_array(&env, &hash.to_array());
        env.crypto().ed25519_verify(
            &public_key,
            &message,
            &signature,
        );
        true
    }

    // Soroban custom verification hook
    pub fn __check_auth(
        env: Env,
        signature: Val,
        auth_context: Vec<Context>,
        args: Vec<Val>,
    ) {
        let delegation_manager: Address = env.storage().instance().get(&DataKey::DelegationManager).unwrap();
        let owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();

        if let Ok(sig_bytes) = Bytes::try_from_val(&env, &signature) {
            let mut message = Bytes::new(&env);
            for context in auth_context.iter() {
                message.append(&context.to_xdr(&env));
            }
            
            let xdr = owner.to_xdr(&env);
            let mut key_bytes = [0u8; 32];
            for i in 0..32 {
                key_bytes[i] = xdr.get(xdr.len() - 32 + i as u32).unwrap();
            }
            let public_key = BytesN::from_array(&env, &key_bytes);

            env.crypto().ed25519_verify(
                &public_key,
                &env.crypto().sha256(&message).into(),
                &sig_bytes.try_into().unwrap(),
            );
        } else {
            delegation_manager.require_auth();
        }
    }
}
mod test;
