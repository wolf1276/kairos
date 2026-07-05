# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-07-06

### Added
- `RegistryModule` (`client.registry`), a thin client for the new on-chain Registry contract mapping `owner -> smart wallet`. `getSmartWallet(owner)` does a read-only lookup; `register(funder, owner, smartWallet)` is a funder-attested write (the funder signs as the transaction source and as the contract's `admin` argument, so no separate owner authorization entry is required).
- `ContractConfig.registry` (optional): the deployed Registry contract ID, threaded into `KairosClient` alongside the existing `delegationManager`/`policyEngine`/`smartWallet` IDs.

## [1.0.2] - 2026-07-05

### Fixed
- Verified the full delegation lifecycle end-to-end against a freshly redeployed testnet `DelegationManager`/`PolicyEngine`/`CustomAccount` (create → sign → register → simulate execution), confirming `register_delegation` and policy-enforcement (`before_all`/`before_hook`) behave as documented; see `configs/contracts.testnet.json` for current testnet contract IDs.

## [1.0.0] - 2026-06-29

### Added
- Initial release of the official Kairos SDK (`@kairos/sdk`).
- `KairosClient` for RPC connection management, transaction assembly, simulation, and polling.
- `WalletModule` for Smart Custom Account (SCA) instantiation, load, owner queries, balance checks, and direct executions.
- `DelegationModule` for off-chain delegation signing, hashing, renewal, and on-chain revocation/disabling.
- `PolicyModule` for composable caveats: target whitelisting, time limits, and period spend limits.
- `ExecutionModule` for executing delegator target invocations via DelegationManager, estimations, and history.
- `EventsModule` for real-time subscription, historical querying, and decoding of protocol events.
