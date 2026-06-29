# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-06-29

### Added
- Initial release of the official Kairos SDK (`@kairos/sdk`).
- `KairosClient` for RPC connection management, transaction assembly, simulation, and polling.
- `WalletModule` for Smart Custom Account (SCA) instantiation, load, owner queries, balance checks, and direct executions.
- `DelegationModule` for off-chain delegation signing, hashing, renewal, and on-chain revocation/disabling.
- `PolicyModule` for composable caveats: target whitelisting, time limits, and period spend limits.
- `ExecutionModule` for executing delegator target invocations via DelegationManager, estimations, and history.
- `EventsModule` for real-time subscription, historical querying, and decoding of protocol events.
