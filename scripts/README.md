# scripts

Monorepo-level executable scripts, run from the repo root with `npx tsx` (also wired to root `package.json` scripts).

| Script | Root npm script | What it does |
| :--- | :--- | :--- |
| [`deploy-testnet.ts`](./deploy-testnet.ts) | `pnpm deploy` | Deploys the Soroban contracts to Stellar testnet via the `stellar` CLI: builds the contracts, uploads the `CustomAccount` WASM (capturing its hash), deploys `delegation-manager` and `policies`, and writes all resulting IDs to [`configs/contracts.testnet.json`](../configs/README.md). |
| [`test-integration.ts`](./test-integration.ts) | `pnpm integration` | SDK end-to-end integration test against the deployed testnet contracts: generates and Friendbot-funds owner/delegate/redeemer accounts, waits for them on Soroban RPC, initializes a `KairosClient`, and exercises the delegation/execution flow. |
| [`demo-e2e.ts`](./demo-e2e.ts) | `pnpm demo` | Full end-to-end demo: parse a natural-language intent → `TradingProfile`, pull live market data → `DecisionEngine` → policy-gated proposal, deploy and fund a `CustomAccount` smart wallet, create on-chain policies from the profile, sign a delegation, execute a delegated trade on-chain, and assert the on-chain state changes. |

## Requirements

- `stellar` CLI on `PATH` (for `deploy-testnet.ts`).
- `FUNDER_SECRET_KEY` — a funded Stellar secret key (for `test-integration.ts` and `demo-e2e.ts`).
- Node.js `>=18` and `tsx` (installed via the workspace).

```bash
pnpm deploy        # deploy contracts → writes configs/contracts.testnet.json
pnpm integration   # run SDK integration test on testnet
pnpm demo          # run the full intent→decision→delegate→execute demo
```

## Related

- [`configs/`](../configs/README.md) — output of `deploy-testnet.ts`.
- [`packages/sdk`](../packages/sdk/README.md) — the client these scripts drive.
- [`contracts/soroban`](../contracts/soroban/README.md) — the contracts deployed.
