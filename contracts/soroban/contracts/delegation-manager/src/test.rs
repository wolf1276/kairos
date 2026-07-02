#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, BytesN as _, Events as _},
    Env, IntoVal,
};

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
