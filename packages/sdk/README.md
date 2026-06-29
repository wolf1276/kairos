# @kairos/sdk

The official TypeScript SDK for interacting with the **Kairos Delegation Framework** on Stellar's Soroban smart contract platform.

## Features

- **Wallet Management**: Easily create, load, and interact with Custom Account smart wallets.
- **Off-chain Delegation**: Formulate, sign, and renew parent-child delegation chains off-chain.
- **Composable Policies**: Whitelist targets, restrict execution timeframes, and set period spend limits.
- **On-chain Management**: Enable, disable, or revoke delegations directly on-chain.
- **Zero-Boilerplate Execution**: Batch execute delegation context target calls with resource estimation.
- **Real-time Events**: Decode, subscribe, and query historical protocol events.

## Installation

```bash
npm install @kairos/sdk
```

## Quick Start

```ts
import { KairosClient } from '@kairos/sdk';
import { Keypair } from '@stellar/stellar-sdk';

const client = new KairosClient({
  network: 'testnet',
  contracts: {
    delegationManager: 'CDWMR4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP',
    policyEngine: 'CCPENGINE4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP',
  }
});

// Setup wallets and signers
const delegator = Keypair.random();
const delegate = Keypair.random();

// 1. Create a Policy
const spendLimitPolicy = await client.policy.create({
  type: 'spend-limit',
  token: 'CCUSDC4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP',
  spendLimit: 100n * 10000000n, // 100 USDC (7 decimals)
  period: 86400n,               // 24 hours
});

// 2. Sign Delegation off-chain
const delegation = await client.delegation.create({
  delegate: delegate.publicKey(),
  delegator: delegator.publicKey(),
  caveats: [spendLimitPolicy],
  signer: delegator,
});

// 3. Execute Target Contract Invocation using Delegate Keypair
await client.execution.execute({
  redeemer: delegate,
  delegationChains: [delegation],
  executions: {
    target: 'CCUSDC4I37T72D57P63OHEUXWUNEXN276UIP66GXZEXL4R6XUR3JWR4IP',
    function: 'transfer',
    args: [...],
  },
});
```

For detailed API docs, see [API.md](file:///Users/ahir/deployments/kairos/packages/sdk/API.md).
