<div align="center">
  <img src="apps/web/public/logo.png" alt="Kairos" width="84" height="84" />

  <h1>Kairos</h1>

  <p><strong>Intent-based, non-custodial capital delegation on Stellar Soroban.</strong></p>

  <p>
    Delegate <em>what</em> an agent may do — not your keys. On-chain caveats decide what actually executes.
  </p>
</div>

---

Kairos is a delegation framework for Stellar's [Soroban](https://developers.stellar.org/docs/build/smart-contracts) smart-contract platform, plus an AI reasoning engine and a paper-trading terminal built on top of it. Instead of depositing funds into a bot or handing over a private key, you deploy a personal **Smart Wallet** contract and grant scoped, revocable **delegations** to automated strategies. Every delegation carries on-chain **caveats** — spend limits, asset whitelists, time windows — that the `policies` contract enforces at redemption, regardless of what any off-chain agent decides.

> [!NOTE]
> **Project status — testnet.** The delegation framework, SDK, reasoning engine, and paper-trading
> terminal are functional against Stellar testnet. **Live on-chain agent execution is not yet
> wired up:** it depends on a production signing backend that is still experimental (see
> [What works today](#what-works-today)). Paper mode runs the full decision → validation → audit
> pipeline without signing or submitting any real transaction.

## What works today

| Component | Status | What it is |
| :--- | :--- | :--- |
| **Kairos SDK** (`packages/sdk`) | ✅ Working | Typed TypeScript client over the deployed Soroban contracts — wallet deploy, delegation sign/register, policy encoding, redemption, events, registry. |
| **Soroban contracts** (`contracts/soroban`) | ✅ Deployed (testnet) | `DelegationManager`, `PolicyEngine`, `CustomAccount`, `Registry` — the on-chain trust boundary. |
| **Onboarding & Smart Wallets** | ✅ Working | Freighter-signed, sponsored deploy of a per-owner `CustomAccount`; SEP-53 signature sessions. No passwords or custody. |
| **Reasoning Engine** (`backend/src/reasoning`) | ✅ Working | Deterministic decision pipeline: Context → Memory → Decision Intelligence (LLM) → **Verification** (rule-based) → **Execution Planner**. Extensively unit-tested. |
| **Reasoning Benchmark** (`backend/benchmarks`) | ✅ Working | Reproducible, versioned harness that scores providers/models across 13 scenarios with automatic regression tracking. |
| **Paper trading** (`backend`) | ✅ Working | Agents run `dca` / `quant` / `limit` / `role` strategies against live market data with synthetic fills — full PnL, positions, and audit trail, no signing. |
| **Web dashboard** (`apps/web`) | ✅ Working | Next.js app: landing, portfolio dashboard, agents console, and a Context Layer inspector. |
| **Live on-chain execution** | 🚧 Experimental | Live-mode agents require a working key-custody signer. The current Turnkey MPC signer (`packages/turnkey-signer`) is **not functional** end-to-end; live trading is disabled in practice. |
| **MCP agent** (`packages/mcp-agent`) | 🚧 Experimental | Depends on the same non-functional signer — not usable end-to-end today. |

---

## Why Kairos

Traditional DeFi automation forces a bad trade-off: either you keep clicking every rebalance and yield harvest yourself, or you deposit into a custodial bot and hope its risk controls hold. Kairos removes the trade-off by making the **policy the boundary, not the trust**:

- **You keep custody.** Funds live in *your* `CustomAccount` Smart Wallet. Agents never hold your keys.
- **Delegations are scoped and revocable.** A delegation names a specific delegate and a set of caveats. Revoke it on-chain at any time.
- **The chain is the final authority.** Even if every off-chain component were compromised, `redeem_delegations` still checks spend limits, asset whitelists, and time restrictions on-chain before a single token moves.
- **AI is advisory only.** The reasoning engine proposes actions; a deterministic validation layer and on-chain caveats decide what — if anything — executes. The model never sizes or authorizes a transfer.

---

## Architecture

Kairos is a pnpm monorepo. The pieces that are live today:

```
                     ┌───────────────────────────────────────────────┐
                     │                  apps/web                      │
                     │   Next.js dashboard · Freighter onboarding ·   │
                     │   oracle GraphQL price API · agents console    │
                     └───────────────────────┬───────────────────────┘
                                             │ HTTP (SEP-53 JWT session)
                     ┌───────────────────────▼───────────────────────┐
                     │                   backend                      │
                     │  ┌──────────────┐   ┌───────────────────────┐  │
                     │  │ Strategy     │   │ Reasoning Engine       │  │
                     │  │ terminal     │   │ Context → Memory →     │  │
                     │  │ dca/quant/   │──▶│ Decision Intelligence →│  │
                     │  │ limit/role   │   │ Verification → Planner  │  │
                     │  │ (paper)      │   └───────────────────────┘  │
                     │  └──────┬───────┘        SQLite persistence     │
                     └─────────┼──────────────────────────────────────┘
                               │ @wolf1276/kairos-sdk
                     ┌─────────▼──────────────────────────────────────┐
                     │           contracts/soroban (testnet)          │
                     │  DelegationManager · PolicyEngine · Registry ·  │
                     │  CustomAccount (your Smart Wallet)             │
                     └────────────────────────────────────────────────┘
```

### The reasoning pipeline

Every decision an agent considers flows through a single, mostly-deterministic pipeline. Only the Decision Intelligence step calls an LLM; everything downstream is rule-based and reproducible:

```
AgentContext + MemoryPackage + UserPolicy
        │
        ▼
  Decision Intelligence   ← LLM proposes an action (never sizes or authorizes it)
        │
        ▼
  Verification            ← deterministic rules: schema, policy, capital, risk, evidence
        │
        ▼
  Execution Planner       ← deterministic plan + prerequisite checks (no chain call)
        │
        ▼
  Execution (paper today; live gated on a working signer)
```

The reasoning engine's public surface is `backend/src/reasoning/index.ts`; the full design lives in
[`docs/architecture/REASONING_ENGINE.md`](./docs/architecture/REASONING_ENGINE.md).

### Security model

```
  User intent ──▶ Reasoning Engine ──▶ Verification ──▶ On-chain caveats ──▶ CustomAccount
                  (advisory only)      (deterministic)   (spend-limit,        (your funds,
                                                          whitelist,          no custody)
                                                          time-restriction)
```

1. **AI is advisory only** — it proposes; it never sets amounts.
2. **Verification cannot be bypassed** — every proposal passes deterministic policy/risk checks.
3. **On-chain caveats are final** — enforced by the `policies` contract at `redeem_delegations`.
4. **Replay protection** — monotonic per-delegator nonces.
5. **Non-custodial** — assets never leave your `CustomAccount`; delegations are revocable on-chain.

See [SECURITY.md](./SECURITY.md) for the full model.

---

## Repository layout

```
.
├── apps/
│   └── web/                  # Next.js dashboard, onboarding, oracle price API  (README)
├── backend/                  # Strategy terminal + Reasoning Engine + REST API  (README)
│   ├── src/reasoning/        #   AI decision → verification → planning pipeline
│   ├── src/agentContext/     #   Context Layer (market/capital/policy/system/history)
│   ├── src/memoryLayer/      #   Memory Engine
│   └── benchmarks/           #   Reasoning + e2e benchmark harnesses            (README)
├── packages/
│   ├── sdk/                  # @wolf1276/kairos-sdk — the typed contract client (README)
│   ├── mcp-agent/            # MCP server (experimental — see status above)     (README)
│   ├── turnkey-signer/       # MPC signer (experimental — not functional)
│   └── types/                # Shared TypeScript types
├── contracts/
│   └── soroban/              # Rust contracts: delegation-manager, policies,
│                             #   custom-account, registry
├── scripts/                  # deploy-testnet · test-integration · demo-e2e
├── configs/                  # contracts.testnet.json (deployed IDs)
└── docs/                     # architecture, api, security
```

---

## Getting started

### Prerequisites

- Node.js `>=18`
- [pnpm](https://pnpm.io/)

### Install & build

```bash
pnpm install
pnpm run build   # builds the SDK
```

### Run the dashboard

```bash
cd apps/web
cp ../../.env.example .env.local   # then fill in the values below
pnpm run dev                       # http://localhost:3000
```

Core environment variables (see `.env.example` for the complete list):

| Variable | Description |
| :--- | :--- |
| `STELLAR_NETWORK` | `testnet` or `mainnet` |
| `STELLAR_RPC_URL` | Soroban RPC endpoint |
| `STELLAR_NETWORK_PASSPHRASE` | Network passphrase |
| `DELEGATION_MANAGER_CONTRACT_ID` | Deployed `DelegationManager` ID |
| `POLICY_CONTRACT_ID` | Deployed `PolicyEngine` ID |
| `CUSTOM_ACCOUNT_CONTRACT_ID` | Deployed `CustomAccount` ID |
| `CUSTOM_ACCOUNT_WASM_HASH` | `CustomAccount` WASM hash |
| `FUNDER_SECRET_KEY` | Funded testnet keypair for sponsored/on-chain operations |
| `HUGGINGFACE_API_KEY` | LLM token for reasoning/intent parsing (optional — deterministic fallback otherwise) |
| `DATABASE_URL` | Backend persistence (SQLite by default) |
| `NEXT_PUBLIC_AGENTS_BACKEND_URL` | Public URL of the deployed agents backend (see `backend/`). **Read at Next.js *build* time, not runtime** — the browser calls this directly for wallet-signature login and Smart Wallet lookup/registration, so an unset value at build time silently bakes in a `localhost:4001` fallback that no visiting browser can reach. |
| `ALLOWED_ORIGIN` | Backend-side CORS allowlist (`backend/.env.example`) — set to the deployed frontend's exact origin, or requests from it get CORS-blocked. |

### Run the backend (paper mode)

```bash
cd backend
cp .env.example .env               # AUTH_JWT_SECRET is required; see backend/README.md
pnpm --filter @wolf1276/kairos-agent-backend dev
```

### Tests, benchmarks, and the demo

```bash
pnpm test                                    # SDK unit tests
pnpm --filter @wolf1276/kairos-agent-backend test   # backend + reasoning engine tests
pnpm --filter @wolf1276/kairos-agent-backend benchmark   # reasoning benchmark harness

npx tsx scripts/deploy-testnet.ts            # deploy contracts (one-time)
FUNDER_SECRET_KEY=SC… npx tsx scripts/demo-e2e.ts        # end-to-end delegation demo
```

### Deploy the backend to Render

`render.yaml` at repo root is a Render Blueprint for `backend/` (Docker-built, health-checked at `/health`, with a persistent Disk mounted at `AGENTS_DB_PATH` so the SQLite DB — including `smart_wallets` rows — survives redeploys instead of silently resetting). In the Render dashboard: **New +** → **Blueprint** → point at this repo. Fields marked `sync: false` in `render.yaml` must be filled in manually in the dashboard (they're secrets/deploy-specific values, not committed to git) — notably `ALLOWED_ORIGIN` (the deployed frontend's exact origin) and the contract IDs from `configs/contracts.testnet.json`.

Requires at least Render's Starter (paid) plan — the free tier has no persistent Disk, so the SQLite DB is wiped on every redeploy/restart regardless of what `render.yaml` declares.

### Deploy to Vercel

This is a pnpm monorepo with the Next.js app in `apps/web/`. Import the repo, set **Root Directory** to `apps/web/`, add the environment variables above, and deploy — the root `vercel.json` wires up the SDK build.

> [!IMPORTANT]
> Set `NEXT_PUBLIC_AGENTS_BACKEND_URL` to the Render backend's public URL (from the step above) in **Project Settings → Environment Variables**, scoped to every environment you deploy (Production, and Preview if preview deployments should also reach a live backend). It's a `NEXT_PUBLIC_` var, which Next.js inlines into the client bundle at *build* time — Vercel does expose Project env vars to the build step automatically, but only if they're added before the build runs and the deployment target (Production/Preview) matches. Leaving it unset doesn't fail the build; it silently ships a bundle where every browser tries to reach `localhost:4001` for wallet login and Smart Wallet lookup/creation — which fails in every visitor's browser with no useful error, while working fine in local dev (where that fallback happens to be correct).

---

## Deployed contracts (testnet)

| Contract | Address |
| :--- | :--- |
| DelegationManager | `CBR4HWJF4ZLDF4C6GF25PQWWZE5M7AOWGZHLJQH6DTEUXJ756KMOHYLF` |
| PolicyEngine | `CA6BPEFDZIC737VS26DQU77UYX5K4NB7VAKWNZAUO36WG7T24Z7N4BYD` |
| CustomAccount | `CAN25TOZQ6UXNVQO35RJLVND4VKTL52QOIQ7B4CWZRSZC5BDC5EQFNXF` |
| Registry | `CBDFFK2F4NZGXR7SRQAND3UZEIS32EHHVYNX4S475A7YYZDGN2E67SJV` |

Source of truth: [`configs/contracts.testnet.json`](./configs/contracts.testnet.json).

---

## Documentation

| Doc | Contents |
| :--- | :--- |
| [`packages/sdk/README.md`](./packages/sdk/README.md) | SDK usage, modules, request flow |
| [`backend/README.md`](./backend/README.md) | Strategy terminal, reasoning engine, REST API, auth |
| [`apps/web/README.md`](./apps/web/README.md) | Dashboard app, onboarding, oracle price API |
| [`backend/benchmarks/reasoning/README.md`](./backend/benchmarks/reasoning/README.md) | Benchmark harness, scenarios, reports |
| [`docs/architecture/REASONING_ENGINE.md`](./docs/architecture/REASONING_ENGINE.md) | Reasoning engine design |
| [`SECURITY.md`](./SECURITY.md) | Security guarantees and architecture |

---

## Roadmap

- **Now (testnet):** delegation framework · reasoning engine · verification · execution planner · paper trading · reasoning benchmark.
- **Next:** a functional key-custody signer to unlock live on-chain agent execution; wiring the Autonomous Runtime into the backend process; mainnet.
- **Later:** multi-agent orchestration, backtesting suite, richer analytics.

## License

[MIT](./LICENSE).
