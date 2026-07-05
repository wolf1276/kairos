# @wolf1276/kairos-sdk

The official TypeScript SDK for interacting with the **Kairos Delegation Framework** on Stellar's Soroban smart contract platform.

## Features

- **Wallet Management**: Easily create, load, and interact with Custom Account smart wallets.
- **Off-chain Delegation**: Formulate, sign, and renew parent-child delegation chains off-chain.
- **Composable Policies**: Whitelist targets, restrict execution timeframes, and set period spend limits.
- **On-chain Management**: Enable, disable, or revoke delegations directly on-chain.
- **Zero-Boilerplate Execution**: Batch execute delegation context target calls with resource estimation.
- **Real-time Events**: Decode, subscribe, and query historical protocol events.
- **On-chain Wallet Registry**: Look up or funder-attest an owner's deployed smart wallet address on-chain, independent of any off-chain database.

## Requirements

- **Node.js**: `>=18.0.0`
- **Bun**: Supported (`>=1.0.0`)
- **Stellar SDK**: Requires `@stellar/stellar-sdk` version `^14.6.1` as a peer dependency.

## Installation

This SDK requires `@stellar/stellar-sdk` to be installed in your project as a peer dependency.

### Using npm

```bash
npm install @wolf1276/kairos-sdk @stellar/stellar-sdk
```

### Using Bun

```bash
bun add @wolf1276/kairos-sdk @stellar/stellar-sdk
```

## Peer Dependency Explanation

The `@stellar/stellar-sdk` package is defined as a `peerDependency` because any application using the Kairos Delegation Framework will naturally interact with Stellar accounts, transactions, and keys. Specifying it as a peer dependency avoids duplicate bundling of the heavy Stellar SDK, resolving potential version conflicts and keeping your production bundles optimized.

## Quick Start

Below is a minimal working example to initialize the `KairosClient` and query the nonce of an account. Contract IDs shown are the current Kairos testnet deployment (see `configs/contracts.testnet.json` in the monorepo for the source of truth):

```typescript
import { KairosClient } from '@wolf1276/kairos-sdk';

const client = new KairosClient({
  network: 'testnet',
  contracts: {
    delegationManager: 'CDZ3P5DWT3ZCOYWROHAA7PQPF53MBIZTFFYKCRQJIAD74TAECMFNCYEN',
    policyEngine: 'CBD3N3R6GFZAFCBAALQCX32BUTUIWVJRKZCQS7HVXHMQZL32VTXD5NHS',
    smartWallet: 'CALOHOUNJEUFMF5R7GIMVWQIN32I7OCNFRVYKFVFAV3F35GRZEXCGI57',
  }
});

console.log('Kairos Client Initialized:', client);
```

## Architecture

The SDK is a thin, typed client over three on-chain Soroban contracts (`DelegationManager`, `PolicyEngine`/`Policies`, `CustomAccount`) plus a set of off-chain helpers for building and signing the structures those contracts expect. Everything hangs off a single `KairosClient` instance, which owns the RPC connection and exposes one module per concern:

```
KairosClient
├── wallet     (WalletModule)     — Custom Account (smart wallet) create/load/balance/direct-execute
├── delegation (DelegationModule) — off-chain sign/hash + on-chain register/disable/enable/revoke/renew
├── policy     (PolicyModule)     — encode/decode caveats (spend-limit, time-restriction, target-whitelist)
├── execution  (ExecutionModule)  — redeem_delegations: execute / simulate / estimateResources / history
├── events     (EventsModule)     — decode + subscribe/query on-chain protocol events
└── registry   (RegistryModule)   — on-chain owner -> smart wallet lookups and funder-attested registration
```

Supporting building blocks (not modules, just plain exports):

- `client/` — `KairosClient` itself: RPC provider, network config, account fetch/wait/fund helpers (incl. Friendbot for testnet), `simulateTx`/`submitTransaction`/`pollTransaction`, and low-level XDR helpers (`delegationToScVal`, `hexToBytesN32ScVal`, instance storage reads).
- `delegation/` — `DelegationModule`. Builds and signs the off-chain `Delegation` struct (`delegate`, `delegator`, `authority`, `caveats`, `salt`, `nonce`, `signature`), computes its deterministic hash, and drives the on-chain lifecycle (`register_delegation`, `disable_delegation`, `enable_delegation`, `revoke_by_wallet`, `set_policy(ies)`). Every on-chain state-changing call has a `prepareSponsored*`/`submitSponsored*` pair so a relayer/funder can pay fees while the delegator (an EOA or a smart-wallet contract) supplies the required Soroban authorization entry.
- `policy/` — `PolicyModule`. Encodes/decodes `Caveat.terms` byte layouts for the three built-in policy types (`spend-limit`, `time-restriction`, `target-whitelist`), plus "indexed" caveats (`0xFE ++ policy_id`) that point at on-chain Policy storage so a policy's limits can be updated later without invalidating the delegation's signature.
- `execution/` — `ExecutionModule`. Assembles `redeem_delegations` calls from one or more delegation chains and executions, and offers `execute` (submit), `simulate` (dry-run against the `PolicyEngine`'s `before_all`/`before_hook`/`after_hook`/`after_all`), and `estimateResources` (fee/footprint sizing from a simulation).
- `wallet/` — `WalletModule`. Deploys/loads a `CustomAccount` smart wallet contract instance and reads its owner/balance, or executes a call directly as the owner (bypassing the delegation path).
- `events/` — `EventsModule`. Decodes raw contract events into typed protocol events and supports both live subscription and historical `getEvents` querying with topic filters.
- `registry/` — `RegistryModule`. Reads the on-chain Registry contract's `owner -> smart wallet` mapping (`getSmartWallet`), and writes new mappings via a funder-attested `register` call — the funder is both the transaction source and the contract's `admin` argument, so (unlike wallet deploy) no separate owner authorization entry is needed.
- `types/` — Shared types: `Delegation`, `Caveat`, `Execution`, `ExecutionContext`, `ContractConfig`, `Signer`/`RemoteSigner` (for MPC/HSM-backed signing where the private key never enters this process).
- `utils/` — Pure helpers: delegation hashing (`computeDelegationHash`, domain-separated per `delegationManager` + `networkPassphrase`), XDR encoding (`getAddressXdrBytes`, `i128ToBuffer`, `encodeTargetWhitelistTerms`, `encodeTimeRestrictionTerms`), and `signTransaction` (works transparently with a local `Keypair` or an async `RemoteSigner`).
- `config/` — Per-network defaults (`NETWORKS.testnet` / `NETWORKS.mainnet`: RPC URL + network passphrase).
- `constants/` — Shared constants (`ROOT_AUTHORITY`, `DEFAULT_TESTNET_RPC`).
- `errors/` — Typed error classes (`RpcError`, `TransactionSimulationError`, `PolicyViolationError`, `ExecutionFailedError`) so callers can branch on failure mode instead of parsing message strings.

### Request flow (typical execution)

1. `client.delegation.create({ delegate, delegator, caveats, signer })` — builds and Ed25519-signs the `Delegation` off-chain. No network call needed unless `nonce` is omitted (then it's fetched via simulation of `get_nonce`).
2. *(optional, on-chain)* `client.delegation.prepareSponsoredRegister` / `submitSponsoredRegister` — records the delegation as the active one for this `(delegator, delegate)` pair, needed for later `disable`/`enable`/`getWalletDelegation` lookups. Not required just to redeem.
3. `client.execution.simulate({ redeemerAddress, delegationChains, executions })` — dry-runs `redeem_delegations`. The `PolicyEngine` contract's `before_all`/`before_hook` runs first; a caveat violation (e.g. a non-whitelisted target, an exceeded spend limit) traps the simulation with a `Contract` error *before* the target is ever invoked. A passing simulation means every caveat in the chain was satisfied.
4. `client.execution.execute({ redeemer, delegationChains, executions })` — signs and submits the same call for real, polling until `SUCCESS`/`FAILED`.

## API Documentation

The full public API is the set of methods documented above on each module (`KairosClient.wallet`, `.delegation`, `.policy`, `.execution`, `.events`, `.registry`) — see the TypeScript types shipped in `dist/index.d.ts` for exact signatures, and `tests/sdk.test.ts` / `examples/` in this package for runnable usage.
