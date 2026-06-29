#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short, Address, Bytes, BytesN, Env, Symbol, Val, Vec,
    panic_with_error, log, IntoVal, TryFromVal, xdr::FromXdr,
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
}

#[contract]
pub struct Policies;

#[contractimpl]
impl Policies {
    // before_all hook
    pub fn before_all(
        env: Env,
        terms: Bytes,
        hash: BytesN<32>,
        context: ExecutionContext,
    ) {
        if terms.len() == 0 {
            panic_with_error!(&env, Error::InvalidTerms);
        }
        let policy_type = terms.get(0).unwrap();

        match policy_type {
            // Target Whitelist
            1 => {
                let allowed_target = Address::from_xdr(&env, &terms.slice(1..terms.len())).unwrap();
                if context.target != allowed_target {
                    panic_with_error!(&env, Error::TargetNotAllowed);
                }
            }
            // Spend Limit
            2 => {
                // Done in before_hook
            }
            // Time Limit
            3 => {
                let start: u64 = Self::decode_u64(&terms, 1);
                let end: u64 = Self::decode_u64(&terms, 9);
                let now = env.ledger().timestamp();
                if now < start || now > end {
                    panic_with_error!(&env, Error::TimeRestrictionActive);
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
        let policy_type = terms.get(0).unwrap();

        match policy_type {
            1 => {}
            // Spend Limit
            2 => {
                let token = Address::from_xdr(&env, &terms.slice(1..33)).unwrap();
                let limit = Self::decode_i128(&terms, 33);
                let period = Self::decode_u64(&terms, 49);

                let now = env.ledger().timestamp();
                let spent_key = PolicyStateKey::Spent(hash.clone());
                let last_time_key = PolicyStateKey::LastSpentTime(hash.clone());

                env.storage().temporary().extend_ttl(&spent_key, 10000, 100000);
                env.storage().temporary().extend_ttl(&last_time_key, 10000, 100000);

                let last_time: u64 = env.storage().temporary().get(&last_time_key).unwrap_or(0);
                let mut current_spent: i128 = env.storage().temporary().get(&spent_key).unwrap_or(0);

                if now - last_time > period {
                    current_spent = 0;
                    env.storage().temporary().set(&last_time_key, &now);
                }

                // Decode spend/transfer amount from args
                if context.target == token && (context.function == Symbol::new(&env, "transfer") || context.function == Symbol::new(&env, "xfer")) {
                    if context.args.len() > 1 {
                        let amount = i128::try_from_val(&env, &context.args.get(1).unwrap()).unwrap_or(0);
                        if current_spent + amount > limit {
                            panic_with_error!(&env, Error::SpendLimitExceeded);
                        }
                        env.storage().temporary().set(&spent_key, &(current_spent + amount));
                    }
                }
            }
            3 => {}
            _ => {}
        }
    }

    pub fn after_hook(
        _env: Env,
        _terms: Bytes,
        _hash: BytesN<32>,
        _context: ExecutionContext,
    ) {}

    pub fn after_all(
        _env: Env,
        _terms: Bytes,
        _hash: BytesN<32>,
        _context: ExecutionContext,
    ) {}

    // Decoders for terms
    fn decode_u64(bytes: &Bytes, offset: u32) -> u64 {
        let mut arr = [0u8; 8];
        for i in 0..8 {
            arr[i] = bytes.get(offset + i as u32).unwrap();
        }
        u64::from_be_bytes(arr)
    }

    fn decode_i128(bytes: &Bytes, offset: u32) -> i128 {
        let mut arr = [0u8; 16];
        for i in 0..16 {
            arr[i] = bytes.get(offset + i as u32).unwrap();
        }
        i128::from_be_bytes(arr)
    }
}
