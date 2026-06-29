# Kairos SDK Migration Guide

## Upgrading from Direct Soroban Contract Invocations

Before the Kairos SDK, developers manually constructed transactions and XDR mappings to interact with the Delegation Manager. This guide shows how to migrate to the SDK.

### 1. Generating Delegations

#### Before (Manual XDR construct):
```ts
const footprint = ...;
const tx = new TransactionBuilder(...)
  // Manually hashing fields and building signature structure...
```

#### After (SDK):
```ts
import { KairosClient } from '@kairos/sdk';

const client = new KairosClient(config);
const delegation = await client.delegation.create({
  delegate,
  delegator,
  signer,
});
```

### 2. Creating Caveat Policies

#### Before:
```ts
const terms = Buffer.concat([
  Buffer.from([3]), // policy_type 3
  Buffer.from(now.toString(16), 'hex'), // start
  Buffer.from(expiry.toString(16), 'hex') // expiry
]);
```

#### After (SDK):
```ts
const policy = await client.policy.create({
  type: 'time-restriction',
  start: now,
  expiry,
});
```
