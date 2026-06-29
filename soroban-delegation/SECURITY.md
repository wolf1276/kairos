# Soroban-Native Delegation Framework Security Considerations

## 1. Replay Attacks
- **Replay Protection**: The Delegation Manager maintains a monotonic nonce per delegator (`Address`). Each delegation requires the exact expected nonce, which is verified before execution and incremented on success.
- **Delegation Hashes**: Each delegation is hashed using a domain separator that binds the delegation to the specific contract address of the `DelegationManager` and the specific network `chainId` (using Soroban host functions).

## 2. Authorization Boundaries
- **Checks on Redeeming**: Only delegates specified in the delegation structure (or the open delegation wildcard `Address(0xa11)`) can redeem.
- **Custom Account Integration**: The Custom Account contract only allows execution commands coming from the trusted `DelegationManager`. Any direct invocation of execution functions from outside the manager is rejected.

## 3. Storage Security
- **State Pollution**: Policy states must be keyed by the hash of the delegation. This guarantees that policies from different delegations cannot interfere with or overwrite each other's storage.
- **Rent Expiration**: Storage entries use `extend_ttl` to prevent key expiration and state loss under Soroban's storage model.

## 4. Hook Safety & Rollback
- If any policy enforcer reverts during the validation hooks (`before_all`, `before_hook`, `after_hook`, `after_all`), or if the execution itself fails, the entire transaction is atomically aborted, rolling back all state changes including state updates in the policy contracts.
