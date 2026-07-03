#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short, Address, Bytes, BytesN, Env, Symbol, Val, Vec,
    panic_with_error, log, IntoVal, xdr::ToXdr,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Caveat {
    pub enforcer: Address,
    pub terms: Bytes,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Delegation {
    pub delegate: Address,
    pub delegator: Address,
    pub authority: BytesN<32>, // Parent delegation hash or ROOT_AUTHORITY
    pub caveats: Vec<Caveat>,
    pub salt: u64,
    pub nonce: u64, // u64::MAX = reusable-until-revoked, otherwise single-use
    pub signature: BytesN<64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Execution {
    pub target: Address,
    pub function: Symbol,
    pub args: Vec<Val>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecutionContext {
    pub target: Address,
    pub function: Symbol,
    pub args: Vec<Val>,
    pub redeemer: Address,
    pub delegate: Address,
    pub delegator: Address,
    pub ledger_sequence: u32,
    pub timestamp: u64,
}

#[contracttype]
pub enum DataKey {
    Disabled(BytesN<32>),
    Nonce(Address),
    Owner,
    Paused,
    Locked,
    WalletDelegation(Address, Address), // (delegator, delegate) -> active delegation hash; one per pair, so a wallet can delegate to multiple agents concurrently
    Policy(Address, u64),      // (delegator, policy_id) -> terms bytes, updatable in place
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ManagerError {
    NotAuthorized = 1,
    AlreadyDisabled = 2,
    AlreadyEnabled = 3,
    BatchLengthMismatch = 4,
    InvalidDelegate = 5,
    InvalidSignature = 6,
    CannotUseDisabled = 7,
    InvalidAuthority = 8,
    ExecutionFailed = 9,
    Paused = 10,
    InvalidNonce = 11,
    Locked = 12,
    WalletAlreadyDelegated = 13,
    NoActiveDelegation = 14,
}

const ROOT_AUTHORITY: [u8; 32] = [0xff; 32];
const BUMP_THRESHOLD: u32 = 10000;
const BUMP_LIMIT: u32 = 100000;

#[contract]
pub struct DelegationManager;

#[contractimpl]
impl DelegationManager {
    // Initialize the contract setting the owner
    pub fn init(env: Env, owner: Address) {
        if env.storage().instance().has(&DataKey::Owner) {
            panic_with_error!(&env, ManagerError::NotAuthorized);
        }
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().extend_ttl(BUMP_THRESHOLD, BUMP_LIMIT);

        // Emit Init Event
        env.events().publish(
            (symbol_short!("init"), owner),
            (),
        );
    }

    pub fn pause(env: Env) {
        let owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();
        owner.require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
        env.storage().instance().extend_ttl(BUMP_THRESHOLD, BUMP_LIMIT);

        // Emit Paused Event
        env.events().publish(
            (symbol_short!("paused"),),
            (),
        );
    }

    pub fn unpause(env: Env) {
        let owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();
        owner.require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().extend_ttl(BUMP_THRESHOLD, BUMP_LIMIT);

        // Emit Unpaused Event
        env.events().publish(
            (symbol_short!("unpaused"),),
            (),
        );
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().extend_ttl(BUMP_THRESHOLD, BUMP_LIMIT);
        env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
    }

    // Owner-gated contract upgrade
    pub fn update_current_contract_wasm(env: Env, new_wasm_hash: BytesN<32>) {
        let owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();
        owner.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    // Owner-gated transfer of ownership
    pub fn transfer_ownership(env: Env, new_owner: Address) {
        let owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();
        owner.require_auth();
        env.storage().instance().set(&DataKey::Owner, &new_owner);

        // Emit ownership transferred event with richer data
        env.events().publish(
            (symbol_short!("own_xfer"), owner),
            new_owner,
        );
    }

    // Disable a delegation on-chain
    pub fn disable_delegation(env: Env, delegator: Address, delegation: Delegation) {
        delegator.require_auth();
        if delegation.delegator != delegator {
            panic_with_error!(&env, ManagerError::NotAuthorized);
        }
        let hash = Self::get_delegation_hash(env.clone(), delegation);
        let key = DataKey::Disabled(hash.clone());
        
        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, ManagerError::AlreadyDisabled);
        }
        env.storage().persistent().set(&key, &true);
        env.storage().persistent().extend_ttl(&key, BUMP_THRESHOLD, BUMP_LIMIT);

        // Emit Event for disable
        env.events().publish(
            (symbol_short!("del_dis"), delegator),
            hash,
        );
    }

    // Re-enable a delegation
    pub fn enable_delegation(env: Env, delegator: Address, delegation: Delegation) {
        delegator.require_auth();
        if delegation.delegator != delegator {
            panic_with_error!(&env, ManagerError::NotAuthorized);
        }
        let hash = Self::get_delegation_hash(env.clone(), delegation);
        let key = DataKey::Disabled(hash.clone());
        
        if !env.storage().persistent().has(&key) {
            panic_with_error!(&env, ManagerError::AlreadyEnabled);
        }
        env.storage().persistent().remove(&key);

        // Emit Event for enable
        env.events().publish(
            (symbol_short!("del_en"), delegator),
            hash,
        );
    }

    // Register the single active delegation for a (delegator, delegate) pair. Enforces one
    // delegation per pair; reject if an active (non-disabled) delegation already exists for
    // this delegate. A wallet may hold one active delegation per distinct delegate, so it can
    // fund multiple agents concurrently.
    pub fn register_delegation(env: Env, delegator: Address, delegation: Delegation) {
        delegator.require_auth();
        if delegation.delegator != delegator {
            panic_with_error!(&env, ManagerError::NotAuthorized);
        }
        let key = DataKey::WalletDelegation(delegator.clone(), delegation.delegate.clone());
        if let Some(existing_hash) = env.storage().persistent().get::<_, BytesN<32>>(&key) {
            if !Self::is_delegation_disabled(env.clone(), existing_hash) {
                panic_with_error!(&env, ManagerError::WalletAlreadyDelegated);
            }
        }
        let hash = Self::get_delegation_hash(env.clone(), delegation);
        env.storage().persistent().set(&key, &hash);
        env.storage().persistent().extend_ttl(&key, BUMP_THRESHOLD, BUMP_LIMIT);

        env.events().publish((symbol_short!("del_reg"), delegator), hash);
    }

    // Get the active delegation hash for a (delegator, delegate) pair, if any.
    pub fn get_wallet_delegation(env: Env, delegator: Address, delegate: Address) -> Option<BytesN<32>> {
        let key = DataKey::WalletDelegation(delegator, delegate);
        env.storage().persistent().get(&key)
    }

    // Revoke a (delegator, delegate) pair's active delegation, without needing to reconstruct
    // the Delegation struct. Only disables this delegate's delegation, leaving other delegates
    // funded by the same wallet untouched.
    pub fn revoke_by_wallet(env: Env, delegator: Address, delegate: Address) {
        delegator.require_auth();
        let key = DataKey::WalletDelegation(delegator.clone(), delegate);
        let hash: BytesN<32> = match env.storage().persistent().get(&key) {
            Some(h) => h,
            None => panic_with_error!(&env, ManagerError::NoActiveDelegation),
        };
        let disabled_key = DataKey::Disabled(hash.clone());
        if env.storage().persistent().has(&disabled_key) {
            panic_with_error!(&env, ManagerError::AlreadyDisabled);
        }
        env.storage().persistent().set(&disabled_key, &true);
        env.storage().persistent().extend_ttl(&disabled_key, BUMP_THRESHOLD, BUMP_LIMIT);

        env.events().publish((symbol_short!("del_dis"), delegator), hash);
    }

    // Update policy terms in place for (delegator, policy_id). Does not touch the
    // Delegation struct, its hash, or its signature — caveats reference policy_id
    // via a marker-prefixed terms blob (see resolve_terms), so this lets Policy
    // be edited (limits/assets/expiry/schedule/allowed actions) without minting
    // a new delegation.
    pub fn set_policy(env: Env, delegator: Address, policy_id: u64, terms: Bytes) {
        delegator.require_auth();
        let key = DataKey::Policy(delegator, policy_id);
        env.storage().persistent().set(&key, &terms);
        env.storage().persistent().extend_ttl(&key, BUMP_THRESHOLD, BUMP_LIMIT);

        env.events().publish((symbol_short!("pol_set"),), policy_id);
    }

    pub fn get_policy(env: Env, delegator: Address, policy_id: u64) -> Bytes {
        let key = DataKey::Policy(delegator, policy_id);
        env.storage().persistent().extend_ttl(&key, BUMP_THRESHOLD, BUMP_LIMIT);
        env.storage().persistent().get(&key).unwrap_or(Bytes::new(&env))
    }

    // Seeds/updates several policies for a wallet in one signed call — used right after a
    // new delegation is registered (its caveats reference these policy_ids via the marker),
    // and for the wizard's "update policy" path when several caveats change together.
    pub fn set_policies(env: Env, delegator: Address, policy_ids: Vec<u64>, terms_list: Vec<Bytes>) {
        delegator.require_auth();
        if policy_ids.len() != terms_list.len() {
            panic_with_error!(&env, ManagerError::BatchLengthMismatch);
        }
        for i in 0..policy_ids.len() {
            let policy_id = policy_ids.get(i).unwrap();
            let terms = terms_list.get(i).unwrap();
            let key = DataKey::Policy(delegator.clone(), policy_id);
            env.storage().persistent().set(&key, &terms);
            env.storage().persistent().extend_ttl(&key, BUMP_THRESHOLD, BUMP_LIMIT);
        }
        env.events().publish((symbol_short!("pol_set"),), policy_ids.len());
    }

    // Resolve a caveat's terms: if terms is `0xFE ++ policy_id:u64_be`, look up the
    // live policy blob for (delegator, policy_id); otherwise use terms literally
    // (backward compatible with existing inline-terms delegations).
    fn resolve_terms(env: &Env, delegator: &Address, terms: &Bytes) -> Bytes {
        if terms.len() == 9 && terms.get(0).unwrap() == 0xFE {
            let mut arr = [0u8; 8];
            for i in 0..8 {
                arr[i] = terms.get(1 + i as u32).unwrap();
            }
            let policy_id = u64::from_be_bytes(arr);
            Self::get_policy(env.clone(), delegator.clone(), policy_id)
        } else {
            terms.clone()
        }
    }

    // Check if delegation is disabled
    pub fn is_delegation_disabled(env: Env, delegation_hash: BytesN<32>) -> bool {
        let key = DataKey::Disabled(delegation_hash);
        if env.storage().persistent().has(&key) {
            env.storage().persistent().extend_ttl(&key, BUMP_THRESHOLD, BUMP_LIMIT);
            env.storage().persistent().get(&key).unwrap_or(false)
        } else {
            false
        }
    }

    // Get current nonce for a delegator
    pub fn get_nonce(env: Env, delegator: Address) -> u64 {
        let key = DataKey::Nonce(delegator);
        if env.storage().persistent().has(&key) {
            env.storage().persistent().extend_ttl(&key, BUMP_THRESHOLD, BUMP_LIMIT);
            env.storage().persistent().get(&key).unwrap_or(0)
        } else {
            0
        }
    }

    // Helper to calculate Delegation hash using SHA-256 with Domain Separator
    pub fn get_delegation_hash(env: Env, delegation: Delegation) -> BytesN<32> {
        let mut bin = Bytes::new(&env);
        
        // Domain Separator: Fixed domain string + contract address & network ID
        bin.append(&Bytes::from_array(&env, b"soroban-delegation"));
        bin.append(&env.current_contract_address().to_xdr(&env));
        bin.append(&Bytes::from_array(&env, &env.ledger().network_id().to_array()));
        
        bin.append(&delegation.delegate.to_xdr(&env));
        bin.append(&delegation.delegator.to_xdr(&env));
        bin.append(&Bytes::from_array(&env, &delegation.authority.to_array()));
        bin.append(&delegation.salt.to_xdr(&env));
        bin.append(&delegation.nonce.to_xdr(&env));
        
        for caveat in delegation.caveats.iter() {
            bin.append(&caveat.enforcer.to_xdr(&env));
            bin.append(&caveat.terms);
        }
        
        env.crypto().sha256(&bin).into()
    }

    // Redeem delegation chains and execute actions
    pub fn redeem_delegations(
        env: Env,
        redeemer: Address,
        permission_contexts: Vec<Vec<Delegation>>,
        executions: Vec<Execution>,
    ) {
        redeemer.require_auth();

        if Self::is_paused(env.clone()) {
            panic_with_error!(&env, ManagerError::Paused);
        }

        // Reentrancy Guard Check-Effect
        let lock_key = DataKey::Locked;
        if env.storage().instance().has(&lock_key) {
            panic_with_error!(&env, ManagerError::Locked);
        }
        env.storage().instance().set(&lock_key, &true);

        let batch_size = permission_contexts.len();
        if batch_size != executions.len() {
            env.storage().instance().remove(&lock_key);
            panic_with_error!(&env, ManagerError::BatchLengthMismatch);
        }

        // Ensure each delegation hash is used only once per batch to prevent double-spend
        let mut used_hashes: Vec<BytesN<32>> = Vec::new(&env);

        let mut delegation_hashes_batch: Vec<Vec<BytesN<32>>> = Vec::new(&env);

        // 1. Signature, Nonce, & Chain Validation + Immediate Nonce consumption (CEI)
        for i in 0..batch_size {
            let chain = permission_contexts.get(i).unwrap();
            let mut hashes = Vec::new(&env);

            if chain.len() == 0 {
                delegation_hashes_batch.push_back(hashes);
                continue;
            }

            // Verify delegation leaf specifies the redeemer
            let leaf = chain.get(0).unwrap();
            if leaf.delegate != redeemer {
                env.storage().instance().remove(&lock_key);
                panic_with_error!(&env, ManagerError::InvalidDelegate);
            }

            // Verify signatures and disabled status from leaf to root
            for j in 0..chain.len() {
                let delegation = chain.get(j).unwrap();
                let hash = Self::get_delegation_hash(env.clone(), delegation.clone());
                // Detect duplicate delegation hash within the batch
                if used_hashes.iter().any(|h| h == hash) {
                    env.storage().instance().remove(&lock_key);
                    panic_with_error!(&env, ManagerError::InvalidNonce); // reuse same error for simplicity
                }
                used_hashes.push_back(hash.clone());
                hashes.push_back(hash.clone());

                if Self::is_delegation_disabled(env.clone(), hash.clone()) {
                    env.storage().instance().remove(&lock_key);
                    panic_with_error!(&env, ManagerError::CannotUseDisabled);
                }

                // Nonce Validation (Replay Protection)
                // If delegation.nonce == u64::MAX (18446744073709551615), it is reusable-until-revoked
                // Consume nonce using helper (replay protection)
                Self::consume_nonce(&env, &delegation.delegator, delegation.nonce, &lock_key);

                // Verify Signature (Standard EOA Account vs Smart Custom Contract)
                let bytes = delegation.delegator.clone().to_xdr(&env);
                let is_contract = bytes.get(7).unwrap_or(0) == 1;

                if is_contract {
                    let is_valid: bool = env.invoke_contract(
                        &delegation.delegator,
                        &Symbol::new(&env, "is_valid_signature"),
                        (hash.clone(), delegation.signature.clone()).into_val(&env),
                    );
                    if !is_valid {
                        env.storage().instance().remove(&lock_key);
                        panic_with_error!(&env, ManagerError::InvalidSignature);
                    }
                } else {
                    let pubkey = Self::address_to_public_key(&env, &delegation.delegator);
                    let message = Bytes::from_array(&env, &hash.to_array());
                    env.crypto().ed25519_verify(
                        &pubkey,
                        &message,
                        &delegation.signature
                    );
                }
            }

            // Verify authority linking: chain[j].authority == hash(chain[j+1])
            for j in 0..chain.len() {
                let delegation = chain.get(j).unwrap();
                if j != chain.len() - 1 {
                    let parent_hash = hashes.get(j + 1).unwrap();
                    if delegation.authority != parent_hash {
                        env.storage().instance().remove(&lock_key);
                        panic_with_error!(&env, ManagerError::InvalidAuthority);
                    }
                    
                    let parent_delegation = chain.get(j + 1).unwrap();
                    if delegation.delegator != parent_delegation.delegate {
                        env.storage().instance().remove(&lock_key);
                        panic_with_error!(&env, ManagerError::InvalidDelegate);
                    }
                } else {
                    if delegation.authority != BytesN::from_array(&env, &ROOT_AUTHORITY) {
                        env.storage().instance().remove(&lock_key);
                        panic_with_error!(&env, ManagerError::InvalidAuthority);
                    }
                }
            }

            delegation_hashes_batch.push_back(hashes);
        }

        // 2. Hook Execution & Execution Pipeline (External Calls)
        for i in 0..batch_size {
            let chain = permission_contexts.get(i).unwrap();
            let execution = executions.get(i).unwrap();
            let hashes = delegation_hashes_batch.get(i).unwrap();

            if chain.len() == 0 {
                // Self authorized execution directly from redeemer
                env.invoke_contract::<Val>(
                    &execution.target,
                    &execution.function,
                    execution.args.clone(),
                );
                continue;
            }

            let leaf_delegation = chain.get(0).unwrap();
            let context = ExecutionContext {
                target: execution.target.clone(),
                function: execution.function.clone(),
                args: execution.args.clone(),
                redeemer: redeemer.clone(),
                delegate: leaf_delegation.delegate.clone(),
                delegator: leaf_delegation.delegator.clone(),
                ledger_sequence: env.ledger().sequence(),
                timestamp: env.ledger().timestamp(),
            };

            // execute before_all Hooks
            for j in 0..chain.len() {
                let delegation = chain.get(j).unwrap();
                let hash = hashes.get(j).unwrap();
                
                for caveat in delegation.caveats.iter() {
                    let terms = Self::resolve_terms(&env, &delegation.delegator, &caveat.terms);
                    env.invoke_contract::<Val>(
                        &caveat.enforcer,
                        &Symbol::new(&env, "before_all"),
                        (terms, hash.clone(), context.clone()).into_val(&env),
                    );
                }
            }

            // execute before_hooks
            for j in 0..chain.len() {
                let delegation = chain.get(j).unwrap();
                let hash = hashes.get(j).unwrap();

                for caveat in delegation.caveats.iter() {
                    let terms = Self::resolve_terms(&env, &delegation.delegator, &caveat.terms);
                    env.invoke_contract::<Val>(
                        &caveat.enforcer,
                        &Symbol::new(&env, "before_hook"),
                        (terms, hash.clone(), context.clone()).into_val(&env),
                    );
                }
            }

            // Perform execution
            let root_delegator = chain.get(chain.len() - 1).unwrap().delegator.clone();
            env.invoke_contract::<Val>(
                &root_delegator,
                &Symbol::new(&env, "execute_from_executor"),
                (
                    execution.target.clone(),
                    execution.function.clone(),
                    execution.args.clone(),
                ).into_val(&env),
            );

            // execute after_hooks (root to leaf)
            for j in (0..chain.len()).rev() {
                let delegation = chain.get(j).unwrap();
                let hash = hashes.get(j).unwrap();
                
                for caveat in delegation.caveats.iter() {
                    let terms = Self::resolve_terms(&env, &delegation.delegator, &caveat.terms);
                    env.invoke_contract::<Val>(
                        &caveat.enforcer,
                        &Symbol::new(&env, "after_hook"),
                        (terms, hash.clone(), context.clone()).into_val(&env),
                    );
                }
            }

            // execute after_all hooks (root to leaf)
            for j in (0..chain.len()).rev() {
                let delegation = chain.get(j).unwrap();
                let hash = hashes.get(j).unwrap();

                for caveat in delegation.caveats.iter() {
                    let terms = Self::resolve_terms(&env, &delegation.delegator, &caveat.terms);
                    env.invoke_contract::<Val>(
                        &caveat.enforcer,
                        &Symbol::new(&env, "after_all"),
                        (terms, hash.clone(), context.clone()).into_val(&env),
                    );
                }
            }
        }

        // 3. Emit Rich Redeemed Events (Post-execution success)
        for i in 0..batch_size {
            let chain = permission_contexts.get(i).unwrap();
            let execution = executions.get(i).unwrap();
            let hashes = delegation_hashes_batch.get(i).unwrap();

            if chain.len() > 0 {
                let root_delegator = chain.get(chain.len() - 1).unwrap().delegator.clone();
                let root_delegation_hash = hashes.get(chain.len() - 1).unwrap();

                // Publish rich redeemed event containing delegator, delegation hash, and execution info
                env.events().publish(
                    (symbol_short!("redeemed"), redeemer.clone()),
                    (root_delegator, root_delegation_hash.clone(), execution.clone()),
                );
            }
        }

        // Release Reentrancy Guard
        env.storage().instance().remove(&lock_key);
    }

    fn address_to_public_key(env: &Env, address: &Address) -> BytesN<32> {
        let xdr = address.to_xdr(env);
        let mut key_bytes = [0u8; 32];
        for i in 0..32 {
            key_bytes[i] = xdr.get(xdr.len() - 32 + i as u32).unwrap();
        }
        BytesN::from_array(env, &key_bytes)
    }

    // Consume a nonce with replay protection and optional reusable-until-revoked model
    fn consume_nonce(env: &Env, delegator: &Address, nonce: u64, lock_key: &DataKey) {
        // If nonce == u64::MAX, treat as reusable-until-revoked: do not increment storage
        if nonce == u64::MAX {
            // No state change needed; ensure delegator exists if desired (optional)
            return;
        }
        // Load current stored nonce (default 0)
        let current = Self::get_nonce(env.clone(), delegator.clone());
        // Must match expected nonce
        if nonce != current {
            // Invalidate reentrancy guard before panic
            env.storage().instance().remove(lock_key);
            panic_with_error!(&env, ManagerError::InvalidNonce);
        }
        // Increment stored nonce to prevent replay, and bump TTL so it cannot silently expire
        let nonce_key = DataKey::Nonce(delegator.clone());
        env.storage().persistent().set(&nonce_key, &(nonce + 1));
        env.storage().persistent().extend_ttl(&nonce_key, BUMP_THRESHOLD, BUMP_LIMIT);
    }


}
mod test;
