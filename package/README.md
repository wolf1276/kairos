# @wolf1276/kairos-sdk

The official TypeScript SDK for interacting with the **Kairos Delegation Framework** on Stellar's Soroban smart contract platform.

## Features

- **Wallet Management**: Easily create, load, and interact with Custom Account smart wallets.
- **Off-chain Delegation**: Formulate, sign, and renew parent-child delegation chains off-chain.
- **Composable Policies**: Whitelist targets, restrict execution timeframes, and set period spend limits.
- **On-chain Management**: Enable, disable, or revoke delegations directly on-chain.
- **Zero-Boilerplate Execution**: Batch execute delegation context target calls with resource estimation.
- **Real-time Events**: Decode, subscribe, and query historical protocol events.

## Requirements

- **Node.js**: `>=18.0.0`
- **Bun**: Supported (`>=1.0.0`)
- **Stellar SDK**: Requires `@stellar/stellar-sdk` version `^13.3.0` as a peer dependency.

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

Below is a minimal working example to initialize the `KairosClient` and query the nonce of an account:

```typescript
import { KairosClient } from '@wolf1276/kairos-sdk';

const client = new KairosClient({
  network: 'testnet',
  contracts: {
    delegationManager: 'CDWMR4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP',
    policyEngine: 'CCPENGINE4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP',
  }
});

console.log('Kairos Client Initialized:', client);
```

## API Documentation

For the complete API reference, please see [API.md](./API.md).
