#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{vec, IntoVal};

fn encode_addr_entry(env: &Env, buf: &mut std::vec::Vec<u8>, addr: &Address) {
    let xdr = addr.to_xdr(env);
    let bytes: std::vec::Vec<u8> = xdr.iter().collect();
    buf.push(bytes.len() as u8);
    buf.extend_from_slice(&bytes);
}

fn encode_fn_entry(env: &Env, buf: &mut std::vec::Vec<u8>, function: &Symbol) {
    let xdr = function.to_xdr(env);
    let bytes: std::vec::Vec<u8> = xdr.iter().collect();
    buf.push(bytes.len() as u8);
    buf.extend_from_slice(&bytes);
}

fn make_target_function_set_terms(env: &Env, entries: &[(Address, std::vec::Vec<Symbol>)]) -> Bytes {
    let mut buf: std::vec::Vec<u8> = std::vec::Vec::new();
    buf.push(4u8);
    buf.push(entries.len() as u8);
    for (addr, fns) in entries {
        encode_addr_entry(env, &mut buf, addr);
        buf.push(fns.len() as u8);
        for f in fns {
            encode_fn_entry(env, &mut buf, f);
        }
    }
    Bytes::from_slice(env, &buf)
}

fn make_pooled_spend_limit_terms(
    env: &Env,
    entries: &[(Address, Symbol, u8, u8)],
    limit: i128,
    period: u64,
) -> Bytes {
    let mut buf: std::vec::Vec<u8> = std::vec::Vec::new();
    buf.push(5u8);
    buf.push(entries.len() as u8);
    for (addr, function, arg_index, value_mode) in entries {
        encode_addr_entry(env, &mut buf, addr);
        encode_fn_entry(env, &mut buf, function);
        buf.push(*arg_index);
        buf.push(*value_mode);
    }
    buf.extend_from_slice(&limit.to_be_bytes());
    buf.extend_from_slice(&period.to_be_bytes());
    Bytes::from_slice(env, &buf)
}

/// Builds a `Vec<Map<Symbol, Val>>` shaped like Blend's `Vec<Request>`, with each map
/// carrying only the "amount" field the pooled spend-limit (value_mode = 1) reads.
fn make_request_vec(env: &Env, amounts: &[i128]) -> Val {
    let mut vec: soroban_sdk::Vec<Val> = soroban_sdk::vec![env];
    for amount in amounts {
        let mut map: Map<Symbol, Val> = Map::new(env);
        map.set(Symbol::new(env, "amount"), amount.into_val(env));
        vec.push_back(map.into_val(env));
    }
    vec.into_val(env)
}

// Stands in for DelegationManager: forwards calls into Policies via `env.invoke_contract`,
// the same mechanism DelegationManager itself uses (see delegation-manager/src/lib.rs
// `redeem_delegations`). Soroban authorizes a contract address's `require_auth()` only when
// that contract is the actual direct invoker of the call, so routing through this stub (as
// opposed to calling `PoliciesClient` directly from the test) is what exercises the real
// authorization path rather than bypassing it with `mock_all_auths`.
#[contract]
struct ManagerStub;

#[contractimpl]
impl ManagerStub {
    pub fn forward(env: Env, policies: Address, hook: Symbol, terms: Bytes, hash: BytesN<32>, context: ExecutionContext) {
        env.invoke_contract::<Val>(&policies, &hook, (terms, hash, context).into_val(&env));
    }
}

fn make_context(env: &Env, target: Address, function: Symbol, args: soroban_sdk::Vec<Val>) -> ExecutionContext {
    ExecutionContext {
        target,
        function,
        args,
        redeemer: Address::generate(env),
        delegate: Address::generate(env),
        delegator: Address::generate(env),
        ledger_sequence: env.ledger().sequence(),
        timestamp: env.ledger().timestamp(),
    }
}

#[test]
fn test_target_function_set_whitelist_allows_matching_entry() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(Policies, PoliciesArgs::__constructor(&Address::generate(&env)));
    let client = PoliciesClient::new(&env, &contract_id);

    let blend = Address::generate(&env);
    let soroswap = Address::generate(&env);
    let deposit_fn = Symbol::new(&env, "deposit");
    let swap_fn = Symbol::new(&env, "swap_exact_tokens_for_tokens");

    let terms = make_target_function_set_terms(
        &env,
        &[
            (blend.clone(), std::vec![deposit_fn.clone()]),
            (soroswap.clone(), std::vec![swap_fn.clone()]),
        ],
    );

    let context = make_context(&env, blend.clone(), deposit_fn.clone(), vec![&env]);
    let hash = BytesN::from_array(&env, &[0u8; 32]);
    client.before_all(&terms, &hash, &context);
}

#[test]
#[should_panic]
fn test_target_function_set_whitelist_rejects_wrong_function_on_allowed_target() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(Policies, PoliciesArgs::__constructor(&Address::generate(&env)));
    let client = PoliciesClient::new(&env, &contract_id);

    let blend = Address::generate(&env);
    let deposit_fn = Symbol::new(&env, "deposit");
    let borrow_fn = Symbol::new(&env, "borrow");

    let terms = make_target_function_set_terms(&env, &[(blend.clone(), std::vec![deposit_fn.clone()])]);

    let context = make_context(&env, blend.clone(), borrow_fn.clone(), vec![&env]);
    let hash = BytesN::from_array(&env, &[0u8; 32]);
    client.before_all(&terms, &hash, &context);
}

#[test]
#[should_panic]
fn test_target_function_set_whitelist_rejects_unlisted_target() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(Policies, PoliciesArgs::__constructor(&Address::generate(&env)));
    let client = PoliciesClient::new(&env, &contract_id);

    let blend = Address::generate(&env);
    let unknown = Address::generate(&env);
    let deposit_fn = Symbol::new(&env, "deposit");

    let terms = make_target_function_set_terms(&env, &[(blend.clone(), std::vec![deposit_fn.clone()])]);

    let context = make_context(&env, unknown.clone(), deposit_fn.clone(), vec![&env]);
    let hash = BytesN::from_array(&env, &[0u8; 32]);
    client.before_all(&terms, &hash, &context);
}

#[test]
fn test_pooled_spend_limit_accumulates_across_distinct_protocol_actions() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(Policies, PoliciesArgs::__constructor(&Address::generate(&env)));
    let client = PoliciesClient::new(&env, &contract_id);

    let blend = Address::generate(&env);
    let soroswap = Address::generate(&env);
    let deposit_fn = Symbol::new(&env, "deposit");
    let swap_fn = Symbol::new(&env, "swap_exact_tokens_for_tokens");

    let terms = make_pooled_spend_limit_terms(
        &env,
        &[(blend.clone(), deposit_fn.clone(), 2, 0), (soroswap.clone(), swap_fn.clone(), 0, 0)],
        1000i128,
        1000u64,
    );
    let hash = BytesN::from_array(&env, &[7u8; 32]);

    // Spend 600 via Blend deposit (amount at arg index 2).
    let deposit_args = vec![&env, 0i128.into_val(&env), 0i128.into_val(&env), 600i128.into_val(&env)];
    let ctx1 = make_context(&env, blend.clone(), deposit_fn.clone(), deposit_args);
    client.before_hook(&terms, &hash, &ctx1);

    // Spend 300 more via Soroswap swap (amount at arg index 0) — pooled total now 900, under 1000.
    let swap_args = vec![&env, 300i128.into_val(&env)];
    let ctx2 = make_context(&env, soroswap.clone(), swap_fn.clone(), swap_args);
    client.before_hook(&terms, &hash, &ctx2);
}

#[test]
#[should_panic]
fn test_pooled_spend_limit_rejects_when_combined_actions_exceed_limit() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(Policies, PoliciesArgs::__constructor(&Address::generate(&env)));
    let client = PoliciesClient::new(&env, &contract_id);

    let blend = Address::generate(&env);
    let soroswap = Address::generate(&env);
    let deposit_fn = Symbol::new(&env, "deposit");
    let swap_fn = Symbol::new(&env, "swap_exact_tokens_for_tokens");

    let terms = make_pooled_spend_limit_terms(
        &env,
        &[(blend.clone(), deposit_fn.clone(), 2, 0), (soroswap.clone(), swap_fn.clone(), 0, 0)],
        1000i128,
        1000u64,
    );
    let hash = BytesN::from_array(&env, &[8u8; 32]);

    let deposit_args = vec![&env, 0i128.into_val(&env), 0i128.into_val(&env), 600i128.into_val(&env)];
    let ctx1 = make_context(&env, blend.clone(), deposit_fn.clone(), deposit_args);
    client.before_hook(&terms, &hash, &ctx1);

    // 600 (Blend) + 500 (Soroswap) = 1100 > 1000 limit — should panic.
    let swap_args = vec![&env, 500i128.into_val(&env)];
    let ctx2 = make_context(&env, soroswap.clone(), swap_fn.clone(), swap_args);
    client.before_hook(&terms, &hash, &ctx2);
}

#[test]
fn test_pooled_spend_limit_resets_after_period_rollover() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(Policies, PoliciesArgs::__constructor(&Address::generate(&env)));
    let client = PoliciesClient::new(&env, &contract_id);

    let blend = Address::generate(&env);
    let deposit_fn = Symbol::new(&env, "deposit");

    let terms = make_pooled_spend_limit_terms(&env, &[(blend.clone(), deposit_fn.clone(), 2, 0)], 1000i128, 100u64);
    let hash = BytesN::from_array(&env, &[9u8; 32]);

    let args = vec![&env, 0i128.into_val(&env), 0i128.into_val(&env), 900i128.into_val(&env)];
    let ctx1 = make_context(&env, blend.clone(), deposit_fn.clone(), args);
    client.before_hook(&terms, &hash, &ctx1);

    env.ledger().set_timestamp(env.ledger().timestamp() + 200);

    // Period has rolled over, so this 900 spend should succeed on a fresh accumulator.
    let args2 = vec![&env, 0i128.into_val(&env), 0i128.into_val(&env), 900i128.into_val(&env)];
    let ctx2 = make_context(&env, blend.clone(), deposit_fn.clone(), args2);
    client.before_hook(&terms, &hash, &ctx2);
}

// Regression test for the Blend pooled-spend-limit bypass: a `submit(from, spender, to,
// requests: Vec<Request>)` call carries its amount nested inside `Request` maps, not as a
// flat arg. value_mode = 1 sums each request's "amount" field so the pooled limit actually
// bounds Blend spend instead of silently treating it as zero.
#[test]
fn test_pooled_spend_limit_sums_blend_request_vec_amounts() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(Policies, PoliciesArgs::__constructor(&Address::generate(&env)));
    let client = PoliciesClient::new(&env, &contract_id);

    let blend = Address::generate(&env);
    let submit_fn = Symbol::new(&env, "submit");

    // arg_index = 3 (the `requests` vec), value_mode = 1 (sum "amount" fields).
    let terms = make_pooled_spend_limit_terms(&env, &[(blend.clone(), submit_fn.clone(), 3, 1)], 1000i128, 1000u64);
    let hash = BytesN::from_array(&env, &[10u8; 32]);

    let owner = Address::generate(&env);
    let requests = make_request_vec(&env, &[300i128, 300i128]);
    let args = vec![
        &env,
        owner.clone().into_val(&env),
        owner.clone().into_val(&env),
        owner.clone().into_val(&env),
        requests,
    ];
    let ctx = make_context(&env, blend.clone(), submit_fn.clone(), args);
    // 300 + 300 = 600, under the 1000 limit — should succeed.
    client.before_hook(&terms, &hash, &ctx);
}

#[test]
#[should_panic]
fn test_pooled_spend_limit_rejects_blend_request_vec_sum_exceeding_limit() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(Policies, PoliciesArgs::__constructor(&Address::generate(&env)));
    let client = PoliciesClient::new(&env, &contract_id);

    let blend = Address::generate(&env);
    let submit_fn = Symbol::new(&env, "submit");

    let terms = make_pooled_spend_limit_terms(&env, &[(blend.clone(), submit_fn.clone(), 3, 1)], 1000i128, 1000u64);
    let hash = BytesN::from_array(&env, &[11u8; 32]);

    let owner = Address::generate(&env);
    // 700 + 700 = 1400 > 1000 limit — should panic instead of silently accounting 0.
    let requests = make_request_vec(&env, &[700i128, 700i128]);
    let args = vec![
        &env,
        owner.clone().into_val(&env),
        owner.clone().into_val(&env),
        owner.clone().into_val(&env),
        requests,
    ];
    let ctx = make_context(&env, blend.clone(), submit_fn.clone(), args);
    client.before_hook(&terms, &hash, &ctx);
}

// Regression test for the fail-open decode bug: before the fix, an arg at the tracked index
// that fails to decode as i128 (or as a request vec) fell back to `unwrap_or(0)`, silently
// treating an unparsable spend as zero instead of rejecting the call.
#[test]
#[should_panic]
fn test_pooled_spend_limit_fails_closed_on_undecodable_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(Policies, PoliciesArgs::__constructor(&Address::generate(&env)));
    let client = PoliciesClient::new(&env, &contract_id);

    let blend = Address::generate(&env);
    let submit_fn = Symbol::new(&env, "submit");

    let terms = make_pooled_spend_limit_terms(&env, &[(blend.clone(), submit_fn.clone(), 3, 0)], 1000i128, 1000u64);
    let hash = BytesN::from_array(&env, &[12u8; 32]);

    let owner = Address::generate(&env);
    // value_mode 0 expects a flat i128 at arg index 3, but this call carries an Address
    // there instead — must reject, not silently account as 0 spent.
    let args = vec![
        &env,
        owner.clone().into_val(&env),
        owner.clone().into_val(&env),
        owner.clone().into_val(&env),
        owner.clone().into_val(&env),
    ];
    let ctx = make_context(&env, blend.clone(), submit_fn.clone(), args);
    client.before_hook(&terms, &hash, &ctx);
}

#[test]
#[should_panic]
fn test_pooled_spend_limit_rejects_when_matched_action_missing_tracked_arg() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(Policies, PoliciesArgs::__constructor(&Address::generate(&env)));
    let client = PoliciesClient::new(&env, &contract_id);

    let blend = Address::generate(&env);
    let submit_fn = Symbol::new(&env, "submit");

    // Configured to track arg index 3, but the call only carries 2 args — previously this
    // silently skipped accounting; now it must reject the call outright.
    let terms = make_pooled_spend_limit_terms(&env, &[(blend.clone(), submit_fn.clone(), 3, 0)], 1000i128, 1000u64);
    let hash = BytesN::from_array(&env, &[13u8; 32]);

    let owner = Address::generate(&env);
    let args = vec![&env, owner.clone().into_val(&env), owner.clone().into_val(&env)];
    let ctx = make_context(&env, blend.clone(), submit_fn.clone(), args);
    client.before_hook(&terms, &hash, &ctx);
}

#[test]
#[should_panic]
fn test_spend_limit_fails_closed_on_negative_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(Policies, PoliciesArgs::__constructor(&Address::generate(&env)));
    let client = PoliciesClient::new(&env, &contract_id);

    let token = Address::generate(&env);
    let token_xdr = token.clone().to_xdr(&env);
    let token_bytes: std::vec::Vec<u8> = token_xdr.iter().collect();
    // The token is stored as a raw 32-byte address payload (see `parse_contract_address`),
    // not the full ScVal::Address XDR used elsewhere in these terms — take the last 32 bytes.
    let raw_token = &token_bytes[token_bytes.len() - 32..];

    let mut buf: std::vec::Vec<u8> = std::vec::Vec::new();
    buf.push(2u8);
    buf.extend_from_slice(raw_token);
    buf.extend_from_slice(&1000i128.to_be_bytes());
    buf.extend_from_slice(&1000u64.to_be_bytes());
    let terms = Bytes::from_slice(&env, &buf);
    let hash = BytesN::from_array(&env, &[14u8; 32]);

    // A negative "transfer" amount must be rejected, not used to shrink accumulated spend.
    let args = vec![
        &env,
        token.clone().into_val(&env),
        token.clone().into_val(&env),
        (-500i128).into_val(&env),
    ];
    let ctx = make_context(&env, token.clone(), Symbol::new(&env, "transfer"), args);
    client.before_hook(&terms, &hash, &ctx);
}

// --- P0 fix regression tests: only the configured DelegationManager may invoke hooks ---

fn spend_limit_terms(env: &Env, token: &Address, limit: i128, period: u64) -> Bytes {
    let token_xdr = token.clone().to_xdr(env);
    let token_bytes: std::vec::Vec<u8> = token_xdr.iter().collect();
    let raw_token = &token_bytes[token_bytes.len() - 32..];
    let mut buf: std::vec::Vec<u8> = std::vec::Vec::new();
    buf.push(2u8);
    buf.extend_from_slice(raw_token);
    buf.extend_from_slice(&limit.to_be_bytes());
    buf.extend_from_slice(&period.to_be_bytes());
    Bytes::from_slice(env, &buf)
}

#[test]
fn test_delegation_manager_can_call_every_hook() {
    let env = Env::default();
    let manager = env.register(ManagerStub, ());
    let policies_id = env.register(Policies, PoliciesArgs::__constructor(&manager));
    let manager_client = ManagerStubClient::new(&env, &manager);

    let token = Address::generate(&env);
    let terms = spend_limit_terms(&env, &token, 1000i128, 1000u64);
    let hash = BytesN::from_array(&env, &[1u8; 32]);
    let args = vec![&env, token.clone().into_val(&env), token.clone().into_val(&env), 100i128.into_val(&env)];
    let context = make_context(&env, token.clone(), Symbol::new(&env, "transfer"), args);

    // None of these should panic: ManagerStub is the real, direct invoker, exactly as
    // DelegationManager itself is in production, so `require_auth()` succeeds implicitly.
    manager_client.forward(&policies_id, &Symbol::new(&env, "before_all"), &terms, &hash, &context);
    manager_client.forward(&policies_id, &Symbol::new(&env, "before_hook"), &terms, &hash, &context);
    manager_client.forward(&policies_id, &Symbol::new(&env, "after_hook"), &terms, &hash, &context);
    manager_client.forward(&policies_id, &Symbol::new(&env, "after_all"), &terms, &hash, &context);
}

#[test]
fn test_external_caller_rejected_for_every_hook() {
    let env = Env::default();
    let manager = Address::generate(&env);
    let policies_id = env.register(Policies, PoliciesArgs::__constructor(&manager));
    let client = PoliciesClient::new(&env, &policies_id);

    let token = Address::generate(&env);
    let terms = spend_limit_terms(&env, &token, 1000i128, 1000u64);
    let hash = BytesN::from_array(&env, &[2u8; 32]);
    // Forged context: claims to be a legitimate redeemer/delegate/delegator triple, but the
    // caller is not DelegationManager, so it must never get far enough to matter.
    let args = vec![&env, token.clone().into_val(&env), token.clone().into_val(&env), 100i128.into_val(&env)];
    let context = make_context(&env, token.clone(), Symbol::new(&env, "transfer"), args);

    let calls: [fn(&PoliciesClient, &Bytes, &BytesN<32>, &ExecutionContext); 4] = [
        |c, t, h, ctx| { c.before_all(t, h, ctx); },
        |c, t, h, ctx| { c.before_hook(t, h, ctx); },
        |c, t, h, ctx| { c.after_hook(t, h, ctx); },
        |c, t, h, ctx| { c.after_all(t, h, ctx); },
    ];
    for call in calls {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| call(&client, &terms, &hash, &context)));
        assert!(result.is_err(), "external caller must be rejected");
    }
}

#[test]
fn test_unauthorized_caller_cannot_mutate_spend_state() {
    let env = Env::default();
    let manager = Address::generate(&env);
    let policies_id = env.register(Policies, PoliciesArgs::__constructor(&manager));
    let client = PoliciesClient::new(&env, &policies_id);

    let token = Address::generate(&env);
    let terms = spend_limit_terms(&env, &token, 1000i128, 1000u64);
    let hash = BytesN::from_array(&env, &[3u8; 32]);
    let args = vec![&env, token.clone().into_val(&env), token.clone().into_val(&env), 500i128.into_val(&env)];
    let context = make_context(&env, token.clone(), Symbol::new(&env, "transfer"), args);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| client.before_hook(&terms, &hash, &context)));
    assert!(result.is_err());

    // The rejection must land before any accounting write: no Spent entry for this hash.
    env.as_contract(&policies_id, || {
        assert!(!env.storage().persistent().has(&PolicyStateKey::Spent(hash.clone())));
    });
}

#[test]
fn test_unauthorized_caller_cannot_mutate_pooled_spend_state() {
    let env = Env::default();
    let manager = Address::generate(&env);
    let policies_id = env.register(Policies, PoliciesArgs::__constructor(&manager));
    let client = PoliciesClient::new(&env, &policies_id);

    let blend = Address::generate(&env);
    let deposit_fn = Symbol::new(&env, "deposit");
    let terms = make_pooled_spend_limit_terms(&env, &[(blend.clone(), deposit_fn.clone(), 2, 0)], 1000i128, 1000u64);
    let hash = BytesN::from_array(&env, &[4u8; 32]);
    let args = vec![&env, 0i128.into_val(&env), 0i128.into_val(&env), 500i128.into_val(&env)];
    let context = make_context(&env, blend.clone(), deposit_fn.clone(), args);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| client.before_hook(&terms, &hash, &context)));
    assert!(result.is_err());

    env.as_contract(&policies_id, || {
        assert!(!env.storage().persistent().has(&PolicyStateKey::PooledSpent(hash.clone())));
    });
}

#[test]
fn test_unauthorized_caller_cannot_reset_accounting() {
    let env = Env::default();
    let manager = env.register(ManagerStub, ());
    let policies_id = env.register(Policies, PoliciesArgs::__constructor(&manager));
    let manager_client = ManagerStubClient::new(&env, &manager);
    let external_client = PoliciesClient::new(&env, &policies_id);

    let token = Address::generate(&env);
    let terms = spend_limit_terms(&env, &token, 1000i128, 100u64);
    let hash = BytesN::from_array(&env, &[5u8; 32]);
    let args = vec![&env, token.clone().into_val(&env), token.clone().into_val(&env), 900i128.into_val(&env)];
    let context = make_context(&env, token.clone(), Symbol::new(&env, "transfer"), args);

    // Legitimate spend via the real manager.
    manager_client.forward(&policies_id, &Symbol::new(&env, "before_hook"), &terms, &hash, &context);

    // An external caller trying to re-run the hook to force a period rollover (which would
    // zero `current_spent`) must be rejected before it ever reaches the accounting logic.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        external_client.before_hook(&terms, &hash, &context)
    }));
    assert!(result.is_err());

    env.as_contract(&policies_id, || {
        let spent: i128 = env.storage().persistent().get(&PolicyStateKey::Spent(hash.clone())).unwrap();
        assert_eq!(spent, 900i128, "unauthorized call must not have reset accumulated spend");
    });
}
