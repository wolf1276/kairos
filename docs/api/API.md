# Kairos SDK API Reference

## Class: `KairosClient`

### Constructor

```ts
new KairosClient(config: {
  network?: 'testnet' | 'mainnet';
  rpcUrl?: string;
  networkPassphrase?: string;
  contracts: ContractConfig;
})
```

---

## Module: `wallet`

### `create`
Deploys and initializes a custom smart wallet (CustomAccount).
```ts
client.wallet.create(owner: Keypair, wasmHash: string): Promise<Wallet>
```

### `load`
Loads a custom smart wallet config.
```ts
client.wallet.load(address: string): Promise<Wallet>
```

### `balance`
Fetches a token balance for a wallet.
```ts
client.wallet.balance(address: string, tokenAddress: string): Promise<bigint>
```

### `owner`
Queries the owner of the CustomAccount contract.
```ts
client.wallet.owner(address: string): Promise<string>
```

### `execute`
Calls execute on the custom wallet (owner only).
```ts
client.wallet.execute(walletAddress: string, owner: Keypair, target: string, functionName: string, args: xdr.ScVal[]): Promise<any>
```

---

## Module: `delegation`

### `create`
Constructs and signs a delegation structure off-chain.
```ts
client.delegation.create(params: {
  delegate: string;
  delegator: string;
  authority?: string;
  caveats?: Caveat[];
  salt?: bigint;
  nonce?: bigint;
  signer: Keypair | ((hash: Buffer) => Promise<Buffer> | Buffer);
}): Promise<Delegation>
```

### `get`
Queries the disabled status of a delegation by its hash.
```ts
client.delegation.get(hash: string): Promise<{ disabled: boolean }>
```

### `revoke` / `disable`
Disables a delegation on-chain.
```ts
client.delegation.revoke(delegation: Delegation, delegatorSigner: Keypair): Promise<any>
```

### `enable`
Enables a disabled delegation on-chain.
```ts
client.delegation.enable(delegation: Delegation, delegatorSigner: Keypair): Promise<any>
```

---

## Module: `policy`

### `create`
Generates enforcer caveat terms byte array.
```ts
client.policy.create(params: {
  type: 'spend-limit' | 'time-restriction' | 'target-whitelist';
  token?: string;
  spendLimit?: string | bigint;
  period?: bigint | number;
  start?: bigint | number;
  expiry?: bigint | number;
  target?: string;
}): Promise<Caveat>
```

---

## Module: `execution`

### `execute`
Submits a redeem transaction on-chain.
```ts
client.execution.execute(params: {
  redeemer: Keypair;
  delegationChains: Delegation[][] | Delegation[];
  executions: Execution[] | Execution;
}): Promise<TransactionResult>
```

---

## Module: `events`

### `subscribe`
Subscribes to live contract events.
```ts
client.events.subscribe(subscriptionId: string, callback: (event: KairosEvent) => void): void
```
