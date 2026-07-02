#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, BytesN as _},
    Env, IntoVal,
};

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
    
    let account = CustomAccountClient::new(&env, &env.register(CustomAccount, ()));
    account.init(&owner, &manager);
}

#[test]
fn test_custom_account_execution_from_executor() {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let manager = Address::generate(&env);
    
    let account_id = env.register(CustomAccount, ());
    let account = CustomAccountClient::new(&env, &account_id);
    account.init(&owner, &manager);

    // Call execution from the manager
    let target = env.register(DummyContract, ());
    let function = Symbol::new(&env, "test");
    let args: Vec<Val> = Vec::new(&env);

    // This should succeed as we mocked all auths and target contract is registered
    account.execute_from_executor(&target, &function, &args);
}
