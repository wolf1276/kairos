# Changelog

All notable architectural and security improvements to the Soroban-native Delegation Framework are documented here.

## [1.0.0] - 2026-06-29

### Added
- **Replay Protection**: Added a `nonce` field to the `Delegation` struct. `DelegationManager` now asserts that the delegation nonce matches the expected sequence and increments it only upon successful execution.
- **Contract-Based Delegators**: Added native XDR tag checking to determine if the delegator is a contract or account. Fallback signature checking via contract interface method `is_valid_signature` was implemented.
- **Storage Rent Safety**: Integrated `extend_ttl` bumps on instance and persistent storage keys to prevent unexpected data expiration.
- **Execution Context Isolation**: Introduced a complete `ExecutionContext` struct passed to all Caveat enforcers, enabling comprehensive validation of target, function symbol, arguments, and ledger details.
- **Unit Testing**: Added verification test cases checking initialization, pause mechanics, and disabled/enabled delegation transitions.
