#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, Address, Bytes, BytesN, Env, Map, Symbol, Val, Vec,
    panic_with_error, TryFromVal, xdr::FromXdr,
};

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
pub enum PolicyStateKey {
    Spent(BytesN<32>), // Tracks accumulated spend amount for a delegation hash
    LastSpentTime(BytesN<32>),
    // Separate keys for the pooled protocol spend limit (tag 5) so it never shares an
    // accumulator with the single-token spend limit (tag 2) if both caveats are on one delegation.
    PooledSpent(BytesN<32>),
    PooledLastSpentTime(BytesN<32>),
    DelegationManager,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotAuthorized = 1,
    TargetNotAllowed = 2,
    SpendLimitExceeded = 3,
    TimeRestrictionActive = 4,
    InvalidTerms = 5,
    // Raised whenever a tracked spend argument can't be decoded to the expected type/shape,
    // or decodes to a value the accounting can't safely bound (negative, overflowing). This
    // MUST fail closed (reject the execution) rather than silently treat the spend as zero —
    // a decode failure here previously meant an unbounded spend was accounted as 0 (see
    // the Blend `submit(Vec<Request>)` bypass this error was introduced to close).
    AmountDecodeFailed = 6,
    // Raised when a spend-limit-whitelisted token is called with a function other than
    // transfer/xfer (e.g. approve, transfer_from, burn, clawback, mint). Previously such
    // calls fell through the tag-2 branch unaccounted and unchecked (see H1).
    FunctionNotAllowed = 7,
}

#[contract]
pub struct Policies;

#[contractimpl]
impl Policies {
    // Binds this Policies instance to a single DelegationManager, exactly like
    // custom-account's `delegation_manager` binding (see CustomAccount::__constructor).
    // Runs atomically at deploy time, so there's no window where the hooks exist without
    // a caller check.
    pub fn __constructor(env: Env, delegation_manager: Address) {
        env.storage().instance().set(&PolicyStateKey::DelegationManager, &delegation_manager);
        env.storage().instance().extend_ttl(10000, 100000);
    }

    // Every hook mutates or reads policy state on behalf of a specific delegation, so an
    // unauthorized caller could forge `hash`/`context` to drain, reset, or bypass any
    // caveat's accounting. Soroban gives contract addresses no signature-based
    // `require_auth()` bypass: it only succeeds when `delegation_manager` is the actual
    // direct invoker of this call, so this rejects every external caller before any state
    // is touched, without changing hook signatures, storage layout, or policy semantics.
    fn require_manager(env: &Env) {
        let manager: Address = env.storage().instance().get(&PolicyStateKey::DelegationManager).unwrap();
        manager.require_auth();
    }

    // before_all hook
    pub fn before_all(
        env: Env,
        terms: Bytes,
        hash: BytesN<32>,
        context: ExecutionContext,
    ) {
        Self::require_manager(&env);
        if terms.len() == 0 {
            panic_with_error!(&env, Error::InvalidTerms);
        }
        let policy_type = terms.get(0).unwrap();

        match policy_type {
            // Target Whitelist
            1 => {
                let parsed = Address::from_xdr(&env, &terms.slice(1..terms.len()));
                let allowed_target = match parsed {
                    Ok(addr) => addr,
                    Err(_) => panic_with_error!(&env, Error::InvalidTerms),
                };
                if context.target != allowed_target {
                    panic_with_error!(&env, Error::TargetNotAllowed);
                }
            }
            // Spend Limit
            2 => {
                if terms.len() < 57 {
                    panic_with_error!(&env, Error::InvalidTerms);
                }
                // Validation can be run in before_hook or here as well
            }
            // Time Limit
            3 => {
                if terms.len() < 17 {
                    panic_with_error!(&env, Error::InvalidTerms);
                }
                let start: u64 = Self::decode_u64(&env, &terms, 1);
                let end: u64 = Self::decode_u64(&env, &terms, 9);
                let now = env.ledger().timestamp();
                if now < start || now > end {
                    panic_with_error!(&env, Error::TimeRestrictionActive);
                }
            }
            // Target-Function-Set Whitelist:
            // [4][count:u8]{[addr_len:u8][addr ScVal-XDR][fn_count:u8]{[fn_len:u8][fn ScVal-XDR]}*fn_count}*count
            4 => {
                if terms.len() < 2 {
                    panic_with_error!(&env, Error::InvalidTerms);
                }
                if !Self::check_target_function_whitelist(&env, &terms, &context.target, &context.function) {
                    panic_with_error!(&env, Error::TargetNotAllowed);
                }
            }
            // Pooled Protocol Spend Limit: validated fully in before_hook (needs storage access).
            5 => {
                if terms.len() < 1 {
                    panic_with_error!(&env, Error::InvalidTerms);
                }
            }
            _ => panic_with_error!(&env, Error::InvalidTerms),
        }
    }

    // before_hook hook
    pub fn before_hook(
        env: Env,
        terms: Bytes,
        hash: BytesN<32>,
        context: ExecutionContext,
    ) {
        Self::require_manager(&env);
        if terms.len() == 0 {
            panic_with_error!(&env, Error::InvalidTerms);
        }
        let policy_type = terms.get(0).unwrap();

        match policy_type {
            1 => {}
            // Spend Limit
            2 => {
                if terms.len() < 57 {
                    panic_with_error!(&env, Error::InvalidTerms);
                }
                let token = match Self::parse_contract_address(&env, &terms, 1) {
                    Ok(addr) => addr,
                    Err(e) => panic_with_error!(&env, e),
                };
                let limit = Self::decode_i128(&env, &terms, 33);
                let period = Self::decode_u64(&env, &terms, 49);

                // Decode spend/transfer amount from args. SEP-41 `transfer(from, to, amount)`
                // and `xfer` both carry the amount as the third argument (index 2), not the
                // `to` address at index 1.
                if context.target == token {
                    // H1: any other function on the whitelisted token (approve, transfer_from,
                    // burn, clawback, mint, ...) must be rejected outright, not silently waved
                    // through unaccounted — an approve() here would hand an attacker-controlled
                    // spender an allowance the spend limit never sees.
                    if context.function != Symbol::new(&env, "transfer") && context.function != Symbol::new(&env, "xfer") {
                        panic_with_error!(&env, Error::FunctionNotAllowed);
                    }
                    // A whitelisted spend-limited token call whose args don't carry an amount
                    // at the expected index is not a spend we can safely ignore — reject it
                    // rather than silently skipping accounting (fail closed).
                    if context.args.len() <= 2 {
                        panic_with_error!(&env, Error::AmountDecodeFailed);
                    }
                    let amount = Self::decode_tracked_i128(&env, &context.args.get(2).unwrap());
                    Self::accumulate_spend(&env, &hash, false, amount, limit, period);
                }
            }
            3 => {}
            // Pooled Protocol Spend Limit:
            // [5][count:u8]{[addr_len:u8][addr][fn_len:u8][fn][arg_index:u8][value_mode:u8]}*count[limit:i128][period:u64]
            //
            // value_mode selects how the tracked spend amount is read out of `context.args[arg_index]`:
            //   0 = flat i128 arg (e.g. SEP-41 `transfer`/`xfer`-style calls, Soroswap's swap amount).
            //   1 = Vec<Map<Symbol, Val>> of Blend-style `Request { amount, ... }` structs — the
            //       tracked amount is the SUM of each entry's "amount" field. This is what lets a
            //       Blend `submit(from, spender, to, requests: Vec<Request>)` call be pool-limited
            //       even though its spend isn't a flat positional arg (see packages/sdk/src/protocols/blend.ts).
            5 => {
                if terms.len() < 27 {
                    panic_with_error!(&env, Error::InvalidTerms);
                }
                let count = terms.get(1).unwrap();
                let mut offset: u32 = 2;
                let mut matched: Option<(u32, u8)> = None;

                for _ in 0..count {
                    let addr_len = Self::get_byte(&env, &terms, offset) as u32;
                    offset += 1;
                    if terms.len() < offset + addr_len {
                        panic_with_error!(&env, Error::InvalidTerms);
                    }
                    let addr_bytes = terms.slice(offset..(offset + addr_len));
                    offset += addr_len;
                    let entry_target = match Address::from_xdr(&env, &addr_bytes) {
                        Ok(a) => a,
                        Err(_) => panic_with_error!(&env, Error::InvalidTerms),
                    };

                    let fn_len = Self::get_byte(&env, &terms, offset) as u32;
                    offset += 1;
                    if terms.len() < offset + fn_len {
                        panic_with_error!(&env, Error::InvalidTerms);
                    }
                    let fn_bytes = terms.slice(offset..(offset + fn_len));
                    offset += fn_len;
                    let entry_fn = match Symbol::from_xdr(&env, &fn_bytes) {
                        Ok(s) => s,
                        Err(_) => panic_with_error!(&env, Error::InvalidTerms),
                    };

                    let arg_index = Self::get_byte(&env, &terms, offset) as u32;
                    offset += 1;
                    let value_mode = Self::get_byte(&env, &terms, offset);
                    offset += 1;

                    if entry_target == context.target && entry_fn == context.function {
                        matched = Some((arg_index, value_mode));
                    }
                }

                if terms.len() < offset + 24 {
                    panic_with_error!(&env, Error::InvalidTerms);
                }
                let limit = Self::decode_i128(&env, &terms, offset);
                let period = Self::decode_u64(&env, &terms, offset + 16);

                if let Some((arg_index, value_mode)) = matched {
                    // A whitelisted protocol action whose args don't reach the configured
                    // tracking index is not safe to wave through unaccounted — reject.
                    if (context.args.len() as u32) <= arg_index {
                        panic_with_error!(&env, Error::AmountDecodeFailed);
                    }
                    let raw = context.args.get(arg_index).unwrap();
                    let amount = match value_mode {
                        0 => Self::decode_tracked_i128(&env, &raw),
                        1 => Self::decode_request_vec_amount_sum(&env, &raw),
                        _ => panic_with_error!(&env, Error::InvalidTerms),
                    };
                    Self::accumulate_spend(&env, &hash, true, amount, limit, period);
                }
            }
            _ => {}
        }
    }

    pub fn after_hook(
        env: Env,
        _terms: Bytes,
        _hash: BytesN<32>,
        _context: ExecutionContext,
    ) {
        Self::require_manager(&env);
    }

    pub fn after_all(
        env: Env,
        _terms: Bytes,
        _hash: BytesN<32>,
        _context: ExecutionContext,
    ) {
        Self::require_manager(&env);
    }

    // Parse contract address from 32-byte raw contract ID/public key payload
    fn parse_contract_address(env: &Env, terms: &Bytes, offset: u32) -> Result<Address, Error> {
        if terms.len() < offset + 32 {
            return Err(Error::InvalidTerms);
        }
        let mut xdr_bytes = Bytes::new(env);
        // `Address::from_xdr` deserializes a full `ScVal` (via `env.deserialize_from_bytes`),
        // not a bare `ScAddress` — it needs the SCV_ADDRESS discriminant (18) in front of the
        // ScAddress's own SC_ADDRESS_TYPE_CONTRACT discriminant (1), each a 4-byte big-endian i32.
        xdr_bytes.append(&Bytes::from_array(env, &[0, 0, 0, 18, 0, 0, 0, 1]));
        xdr_bytes.append(&terms.slice(offset..(offset + 32)));
        Address::from_xdr(env, &xdr_bytes).map_err(|_| Error::InvalidTerms)
    }

    /// Scans a tag-4 target-function-set whitelist's terms for an entry whose address
    /// matches `target` and whose function set contains `function`. Walks the buffer
    /// directly (no intermediate collection) since `soroban_sdk::Vec<T>` isn't a fit for
    /// holding ad-hoc `(Address, [Symbol])` tuples built mid-decode.
    fn check_target_function_whitelist(env: &Env, terms: &Bytes, target: &Address, function: &Symbol) -> bool {
        let count = terms.get(1).unwrap_or(0);
        let mut offset: u32 = 2;
        let mut found = false;

        for _ in 0..count {
            if offset >= terms.len() {
                return false;
            }
            let addr_len = terms.get(offset).unwrap() as u32;
            offset += 1;
            if terms.len() < offset + addr_len {
                return false;
            }
            let addr_bytes = terms.slice(offset..(offset + addr_len));
            offset += addr_len;
            let entry_target = match Address::from_xdr(env, &addr_bytes) {
                Ok(a) => a,
                Err(_) => return false,
            };
            let target_matches = entry_target == *target;

            if offset >= terms.len() {
                return false;
            }
            let fn_count = terms.get(offset).unwrap();
            offset += 1;
            for _ in 0..fn_count {
                if offset >= terms.len() {
                    return false;
                }
                let fn_len = terms.get(offset).unwrap() as u32;
                offset += 1;
                if terms.len() < offset + fn_len {
                    return false;
                }
                let fn_bytes = terms.slice(offset..(offset + fn_len));
                offset += fn_len;
                if target_matches && !found {
                    if let Ok(sym) = Symbol::from_xdr(env, &fn_bytes) {
                        if sym == *function {
                            found = true;
                        }
                    }
                }
            }
        }
        found
    }

    // Reads a single byte from `terms`, failing closed with a typed error instead of an
    // untyped trap if `offset` is out of bounds (malformed/truncated terms).
    fn get_byte(env: &Env, bytes: &Bytes, offset: u32) -> u8 {
        match bytes.get(offset) {
            Some(b) => b,
            None => panic_with_error!(env, Error::InvalidTerms),
        }
    }

    // Decoders for terms. Bounds are checked (rather than trusting the caller's length
    // precondition) so malformed terms fail with a typed `InvalidTerms` error instead of
    // an opaque VM trap.
    fn decode_u64(env: &Env, bytes: &Bytes, offset: u32) -> u64 {
        if bytes.len() < offset + 8 {
            panic_with_error!(env, Error::InvalidTerms);
        }
        let mut arr = [0u8; 8];
        for i in 0..8 {
            arr[i] = bytes.get(offset + i as u32).unwrap();
        }
        u64::from_be_bytes(arr)
    }

    fn decode_i128(env: &Env, bytes: &Bytes, offset: u32) -> i128 {
        if bytes.len() < offset + 16 {
            panic_with_error!(env, Error::InvalidTerms);
        }
        let mut arr = [0u8; 16];
        for i in 0..16 {
            arr[i] = bytes.get(offset + i as u32).unwrap();
        }
        i128::from_be_bytes(arr)
    }

    // Decodes a tracked spend argument to i128, failing closed (rejecting the execution)
    // rather than defaulting to 0 on a type mismatch. A decode failure means the caveat
    // cannot verify the call is within limits, which must never be treated as "0 spent".
    fn decode_tracked_i128(env: &Env, raw: &Val) -> i128 {
        match i128::try_from_val(env, raw) {
            Ok(v) => v,
            Err(_) => panic_with_error!(env, Error::AmountDecodeFailed),
        }
    }

    // Decodes a `Vec<Map<Symbol, Val>>` (Blend-style `Vec<Request>`) and sums each entry's
    // "amount" field. Used for pooled-protocol-spend-limit `value_mode = 1`. Any entry that
    // isn't shaped as expected, or is missing/mistyped its "amount" field, fails closed —
    // an unparsable request must never be accounted as spending 0.
    fn decode_request_vec_amount_sum(env: &Env, raw: &Val) -> i128 {
        let items: Vec<Val> = match Vec::try_from_val(env, raw) {
            Ok(v) => v,
            Err(_) => panic_with_error!(env, Error::AmountDecodeFailed),
        };
        let amount_key = Symbol::new(env, "amount");
        let mut sum: i128 = 0;
        for item in items.iter() {
            let map: Map<Symbol, Val> = match Map::try_from_val(env, &item) {
                Ok(m) => m,
                Err(_) => panic_with_error!(env, Error::AmountDecodeFailed),
            };
            let amount_val = match map.get(amount_key.clone()) {
                Some(v) => v,
                None => panic_with_error!(env, Error::AmountDecodeFailed),
            };
            let item_amount = Self::decode_tracked_i128(env, &amount_val);
            sum = match sum.checked_add(item_amount) {
                Some(s) => s,
                None => panic_with_error!(env, Error::AmountDecodeFailed),
            };
        }
        sum
    }

    /// Shared spend-accounting core for both the single-token spend limit (tag 2, `pooled =
    /// false`) and the pooled protocol spend limit (tag 5, `pooled = true`) — the two use
    /// disjoint storage keys (see `PolicyStateKey`) so they never share an accumulator even
    /// if both caveats are attached to the same delegation.
    fn accumulate_spend(env: &Env, hash: &BytesN<32>, pooled: bool, amount: i128, limit: i128, period: u64) {
        // A negative tracked amount would let a delegate shrink `current_spent` and buy back
        // headroom for a later call in the same period — never allow it. Legitimate protocol
        // spend arguments (transfer/xfer amount, Blend request amount, Soroswap swap amount)
        // are always non-negative.
        if amount < 0 {
            panic_with_error!(env, Error::AmountDecodeFailed);
        }

        let (spent_key, last_time_key) = if pooled {
            (PolicyStateKey::PooledSpent(hash.clone()), PolicyStateKey::PooledLastSpentTime(hash.clone()))
        } else {
            (PolicyStateKey::Spent(hash.clone()), PolicyStateKey::LastSpentTime(hash.clone()))
        };

        let now = env.ledger().timestamp();

        // `extend_ttl` panics if the entry doesn't exist yet — guard it, since a
        // delegation's first-ever spend against this policy has no prior entries.
        if env.storage().persistent().has(&spent_key) {
            env.storage().persistent().extend_ttl(&spent_key, 10000, 100000);
        }
        if env.storage().persistent().has(&last_time_key) {
            env.storage().persistent().extend_ttl(&last_time_key, 10000, 100000);
        }

        let last_time: u64 = env.storage().persistent().get(&last_time_key).unwrap_or(0);
        let mut current_spent: i128 = env.storage().persistent().get(&spent_key).unwrap_or(0);

        if now - last_time > period {
            current_spent = 0;
            env.storage().persistent().set(&last_time_key, &now);
            env.storage().persistent().extend_ttl(&last_time_key, 10000, 100000);
        }

        // Use checked_add rather than `+` — an i128 overflow here would otherwise panic with
        // an untyped arithmetic-overflow trap (still fail-closed, but not a typed `Error`),
        // and in principle could be exploited to wrap in a build without overflow checks.
        let new_spent = match current_spent.checked_add(amount) {
            Some(v) => v,
            None => panic_with_error!(env, Error::SpendLimitExceeded),
        };
        if new_spent > limit {
            panic_with_error!(env, Error::SpendLimitExceeded);
        }
        env.storage().persistent().set(&spent_key, &new_spent);
        env.storage().persistent().extend_ttl(&spent_key, 10000, 100000);
    }
}

mod test;
