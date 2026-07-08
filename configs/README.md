# configs

Runtime configuration that is neither source code nor secret — currently the deployed Stellar contract IDs.

## `contracts.testnet.json`

The **source of truth for deployed testnet contract addresses**. Shape:

| Key | Meaning |
| :--- | :--- |
| `delegationManager` | [delegation-manager](../contracts/soroban/contracts/delegation-manager/README.md) contract ID. |
| `policyEngine` | [policies](../contracts/soroban/contracts/policies/README.md) contract ID. |
| `customAccount` | [custom-account](../contracts/soroban/contracts/custom-account/README.md) Smart Wallet contract ID. |
| `customAccountWasmHash` | WASM hash used to deploy new Smart Wallets deterministically. |
| `registry` | [registry](../contracts/soroban/contracts/registry/README.md) contract ID. |

## How it's produced and consumed

- **Written by** [`scripts/deploy-testnet.ts`](../scripts/README.md) after building and deploying the contracts.
- **Read directly by** repo-level scripts and the mcp-agent smoke test: `scripts/deploy-testnet.ts`, `scripts/test-integration.ts`, `scripts/demo-e2e.ts`, `packages/mcp-agent/scripts/smoke-test.ts`.
- **Consumed indirectly by** the [backend](../backend/README.md) and [apps/web](../apps/web/README.md), which read the same IDs from environment variables (`DELEGATION_MANAGER_CONTRACT_ID`, `POLICY_CONTRACT_ID`, `CUSTOM_ACCOUNT_CONTRACT_ID`, `CUSTOM_ACCOUNT_WASM_HASH`, `REGISTRY_CONTRACT_ID`). When deploying, copy the values here into those env vars.

> [!NOTE]
> There is no `contracts.mainnet.json` today — only testnet is deployed. Mainnet deployment is a roadmap item (see the root [README](../README.md#roadmap)).

## Related

- [`scripts/`](../scripts/README.md) — regenerates this file.
- [`contracts/soroban`](../contracts/soroban/README.md) — the contracts these IDs point to.
