# Kairos

Intent-Based Autonomous Capital Management on Stellar.

Kairos is a next-generation decentralized finance protocol designed to enable secure, non-custodial capital delegation on Stellar's Soroban smart contract platform. By shifting the paradigm from manual transaction execution to intent-based policy enforcement, Kairos allows users to delegate investment execution to automated algorithms and AI agents while maintaining absolute control over their assets.

---

## Why Kairos?

Traditional decentralized finance (DeFi) is highly manual and requires constant user interaction to rebalance portfolios, harvest yields, or execute trading strategies. Existing solutions like traditional trading bots suffer from major pain points:

* **High Trust Requirements:** Users must deposit funds into custodial contract accounts or share private keys with external bots.
* **Complex Automation:** Setting up complex condition-based strategies is highly technical and error-prone.
* **Lack of Guardrails:** Bots often lack sophisticated risk mitigation rules, risking entire user balances.

**Kairos resolves this by enabling intent-based execution.** Users delegate capital to dedicated smart contracts (Smart Wallets) governed by highly customizable, on-chain execution policies. Automated providers or AI agents can make trade decisions on behalf of users, but those decisions must strictly conform to policies validated on-chain.

---

## Features

| Feature | Description |
| :--- | :--- |
| **Intent-Based Investing** | Declare natural language investment goals, automatically parsed into structured on-chain parameters. |
| **Smart Wallets** | Dedicated custom smart accounts that house delegated capital and isolate execution risks. |
| **Role Agents (AI Managed)** | Backend-resident Strategic / Yield / Balancer agents (`backend/src/decisionEngine.ts`) that call a Hugging Face LLM (`meta-llama/Llama-3.1-8B-Instruct`) each tick to pick a quant strategy, a yield venue, or a rebalance action. Falls back to a deterministic regime/indicator heuristic when the API is unavailable. |
| **Quant Strategy Agents** | `quant`-mode Strategy Mode agents run one of ~25 deterministic technical-indicator strategies (EMA/SMA/MACD cross, RSI, Bollinger Bands, ADX, Ichimoku, and more — see `backend/src/strategies/index.ts`) evaluated on every tick. |
| **DCA / Limit Agents** | `dca` agents redeem a fixed spend on an interval; `limit` agents fire a one-shot conditional order once a trigger price is hit. Both run server-side in the Strategy Mode backend. |
| **Live Market Data** | Trading decisions are driven by Stellar Horizon trade-aggregation candles and Horizon's SSE trade stream (`backend/src/priceHistory.ts`, `priceFeed.ts`). A separate Binance-fed oracle (`apps/web/oracle/`) powers the app's GraphQL price API but does not feed agent decisions. |
| **Paper Trading** | Every Strategy Mode agent is created in `paper` or `live` mode. Paper agents get a synthetic fill (`paper-<uuid>`) instead of signing/submitting a real transaction, but flow through the exact same PnL/position/audit pipeline as live trades. |
| **Policy Engine** | Composable on-chain checks verifying period spend limits (spend-limit), asset whitelists (target-whitelist), time restrictions, target-function-set whitelists, and a pooled protocol spend limit that shares one cap/period across multiple protocol actions (`contracts/soroban/contracts/policies/`). |
| **Protocol Execution (Blend / Soroswap)** | Agent actions can be routed through real DeFi protocols via typed, ABI-aware SDK adapters (`packages/sdk/src/protocols/`) instead of the classic-pair spot trading loop — Blend lending deposits/withdrawals and Soroswap swaps, both still redeemed through the same delegation/caveat-checked path. Gated behind `ENABLE_PROTOCOL_EXECUTION`; see `backend/src/protocolExecutionService.ts`. |
| **Non-Custodial Architecture** | Absolute safety of funds — assets never leave your delegated control. Every proposal passes a deterministic validation pipeline (`backend/src/validation.ts`: policy → delegation → risk) before execution, and every live trade is still checked on-chain against your delegation's caveats regardless of what the backend decided. The LLM **never** determines position size or authorizes fund-moving actions. |
| **Strategy Mode (Agent Backend)** | Persistent, backend-driven algorithmic trading terminal (`/backend`) — Turnkey MPC-backed agent wallets execute `dca`/`quant`/`limit` strategies in paper or real (testnet) mode, every trade/position/lifecycle event persisted to SQLite and gated behind Freighter wallet-signature auth. See [`backend/README.md`](./backend/README.md). |
| **Soroban Native** | Purpose-built for Stellar's Soroban smart contract system, utilizing WASM execution and gas-efficient architectures. |

---

## How It Works

```
         ┌───────────────┐
         │     User      │
         └───────┬───────┘
                 │
                 ▼
         ┌───────────────┐
         │Connect Wallet │  (Freighter Wallet)
         └───────┬───────┘
                 │
                 ▼
      ┌─────────────────────┐
      │ Create Smart Wallet │  (CustomAccount smart contract, auto on first connect)
      └──────────┬──────────┘
                 │
                 ▼
        ┌─────────────────┐
        │ Configure Agent │  (Strategy Mode: dca / quant / limit, paper or live)
        └────────┬────────┘
                 │
                 ▼
       ┌───────────────────┐
       │ Attach Delegation │  (spend-limit / target-whitelist / time-restriction caveats)
       └─────────┬─────────┘
                 │
                 ▼
         ┌───────────────┐
         │Agent Executes │  (Backend scheduler + price feed; on-chain caveats enforced at redemption)
         └───────┬───────┘
                 │
                 ▼
         ┌───────────────┐
         │   Portfolio   │  (Trades, positions, audit trail persisted server-side)
         └───────────────┘
```

See [Strategy Mode (Agent Backend)](#strategy-mode-agent-backend) below for how the last two
steps actually work — trades are executed by the persistent backend, not the browser.

---

## Authentication & Onboarding

Kairos has no passwords, emails, or accounts — **the connected Stellar address is the identity**,
and every session is established by proving control of that address's private key via Freighter.
There are two independent, wallet-signature-gated layers, both driven off the same Freighter
connection but serving different purposes:

| Layer | Proves | Yields | Used for |
| :--- | :--- | :--- | :--- |
| **Onboarding** | Owner has a Smart Wallet (or provisions one) | A deployed Smart Wallet (`C…`) address, persisted server-side | Dashboard, trading, delegation — the account funds actually live in |
| **Agent-backend login (SEP-53)** | Owner controls the `G…` address, right now | A short-lived bearer JWT | Every Strategy Mode call (`/api/agents`, `/api/positions`, `/api/audit`, `/api/smart-wallets`) |

Neither layer ever asks for or transmits a private key — only Freighter-signed challenges/entries.

### Identity model

* **Owner wallet (`G…`)** — the Freighter/wallet-kit account the user connects with. This is the
  identity the backend authenticates and the address every JWT/session is scoped to.
* **Smart Wallet (`C…`)** — a `CustomAccount` Soroban contract deployed *for* that owner. This is
  the actual managed wallet: funds, delegations, and agent spend authority all live here. There is
  no separate "Capital Wallet" concept — the Smart Wallet *is* the account being managed.

### Onboarding flow (first Smart Wallet deploy)

```
         ┌───────────────┐
         │     User      │
         └───────┬───────┘
                 ▼
         ┌───────────────┐
         │Connect Freighter│  → owner public key (G…)
         └───────┬───────┘
                 ▼
   ┌─────────────────────────────┐
   │  POST /api/connect/check    │  Does this owner already have
   │                             │  a Smart Wallet on file?
   └─────────────┬───────────────┘
                 │
        ┌────────┴────────┐
        │ existing         │ new
        ▼                  ▼
   (skip straight   ┌─────────────────────────────┐
    to Dashboard)   │ POST /api/connect/prepare   │  sponsored deploy prepared,
                    │  (owner)                    │  unsigned Soroban auth entry
                    └─────────────┬───────────────┘
                                  ▼
                    ┌─────────────────────────────┐
                    │  Freighter signAuthEntry     │  user signs the entry
                    └─────────────┬───────────────┘
                                  ▼
                    ┌─────────────────────────────┐
                    │  POST /api/connect/submit    │  deploy + init on-chain —
                    │  (saltHex, signedEntryXdr)   │  Smart Wallet is now live
                    └─────────────┬───────────────┘
                                  ▼
                    ┌─────────────────────────────┐
                    │  registerSmartWallet()       │  persists {owner, smartWallet}
                    │  (via POST /api/smart-wallets)│  mapping server-side
                    └─────────────┬───────────────┘
                                  │
                 ┌────────────────┘
                 ▼
         ┌───────────────┐
         │  Dashboard    │  (owner + Smart Wallet + balances)
         └───────────────┘
```

* If persistence fails *after* the on-chain deploy already succeeded, the server returns the
  deployed address in the error payload — the client retries with `POST /api/connect/register`
  (`registerSmartWallet`), which only re-persists, never re-deploys. This is the one invariant that
  must never regress: a retry can never leave an owner with two Smart Wallets.
* This whole sequence runs automatically, once, the first time a new owner connects — see
  `OnboardingService` (`apps/web/app/services/onboarding/OnboardingService.ts`), which owns every
  step (check / prepare / submit / register) so no UI component talks to these routes directly.
* `prepare`/`submit` take `owner` from the request body to build the deploy transaction — safe
  because only that exact owner's Freighter can produce a valid `signAuthEntry` for it. The final
  persistence step (`registerSmartWallet`) is different: it never trusts a client-supplied owner
  at all — the backend derives it from the bearer token forwarded alongside it, so a caller can
  only ever register a mapping for the address it has itself authenticated as (see the SEP-53
  session below).

### Agent-backend login (SEP-53 signature session)

Separate from onboarding — this is what authorizes calls to the Strategy Mode agent backend
(`/backend`, see [`backend/README.md`](./backend/README.md)):

```
 Connect Freighter (already done above)
     │
     ▼
 POST /api/auth/challenge { publicKey } ──▶ { nonce, message }  (5-min TTL)
     │
     ▼
 Freighter signMessage(message) ──────────▶ SEP-53-wrapped signature
     │
     ▼
 POST /api/auth/verify { publicKey, signature }
     │              (server re-derives the SEP-53 digest and verifies
     │               against the Ed25519 public key — never trusts the
     │               client's claimed address on its own)
     ▼
 { token }  ── 7-day JWT, cached in sessionStorage as kairos:session:<publicKey>
     │
     ▼
 Authorization: Bearer <token>  on every /api/agents, /api/positions,
                                /api/audit, /api/smart-wallets call
```

* Only prompts Freighter's signature popup on an **interactive** connect, or the first
  agent-backend call a page actually needs (Trade/Agents pages) — a silent background
  auto-reconnect on page load never surprises the user with a signature request.
* A 401 clears every cached session token in `sessionStorage` so a rejected/expired token can't
  keep being resent — the next call re-runs the challenge/verify handshake.
* The backend never trusts a client-supplied `owner` string — every session-scoped route derives
  identity from the verified JWT (`req.auth.publicKey`), and per-agent routes additionally check
  the agent's `owner` matches it (403 otherwise).

### Frontend composition

The two layers above, plus Freighter connection mechanics, are composed into one hook so every
page reads a single, already-sequenced wallet state:

| Hook | Owns |
| :--- | :--- |
| `useWallet` | Freighter/wallet-kit connection mechanics only (connect, disconnect, account-switch polling) |
| `useAuthentication` | The SEP-53 login handshake + bearer token (agent-backend session) |
| `useSmartWallets` | The Smart Wallet list/selection/balance, plus local↔remote reconciliation |
| `useOnboarding` | UI state (stage/error) for the automatic first-time deploy, delegating every step to `OnboardingService` |
| `useSmartWallet` | Composes all of the above — the *only* hook pages actually call (via `useWalletContext`) |

`useSmartWallet`'s one job is **sequencing**: auth must settle before the wallet is exposed to
pages, the Smart Wallet list must be checked before deciding whether to onboard, and a retry must
never re-deploy if a prior attempt already got the wallet live on-chain.

---

## Automation Modes

Every automated trade is executed by a Strategy Mode agent (`backend/`, see
[`backend/README.md`](./backend/README.md)) created with one of four strategy types:

### `role` — Role Agents (Strategic / Yield / Balancer)
Three LLM-advised agents (`backend/src/decisionEngine.ts`), each ticking through the same
validation pipeline (`backend/src/roleTick.ts`): Live Oracle → Analysis → LLM Decision → Policy
→ Delegation → Risk Checks → Execute → Positions → Audit.

* **Strategic Agent:** Picks the best-fitting quant strategy for the current market regime
  (trending/ranging/volatile) from the full strategy catalogue, then proposes buy/sell/hold —
  grounded against that strategy's own deterministic signal.
* **Yield Agent:** Decides whether to reallocate idle capital into a simulated yield venue based
  on live-adjusted APYs. For live agents with `ENABLE_PROTOCOL_EXECUTION` set, a reallocation
  deploys idle capital into a real Blend lending deposit (`backend/src/protocolExecutionService.ts`)
  instead of a spot buy; paper agents and the Strategic/Balancer roles are unaffected.
* **Portfolio Balancer Agent:** Proposes a rebalance when the current allocation drifts too far
  from target.
* **Model:** Hugging Face `meta-llama/Llama-3.1-8B-Instruct`, JSON-only responses, 2 retries with
  backoff. Falls back to a deterministic regime/indicator heuristic when the API is unavailable
  or fails to return valid JSON — the LLM proposes, it never sizes or authorizes a trade.
* **Validation pipeline (`backend/src/validation.ts`):** policy (confidence floor, non-zero trade
  size) → delegation (must be active for live agents) → risk (hard-blocks above 12% regime
  volatility, and circuit-breaks the agent once cumulative loss exceeds 20% of allocated capital).

### `quant` — Quant Strategy Agents
Evaluates one deterministic technical-indicator strategy, chosen at agent creation, from the
catalogue in `backend/src/strategies/index.ts` (EMA/SMA/DEMA/TEMA/HMA crossovers, RSI, MACD,
Bollinger Bands, Stochastic, ADX, Williams %R, CCI, ROC, ATR, Donchian, Parabolic SAR, VWAP,
Ichimoku, Keltner, TRIX, Awesome Oscillator, MFI, OBV, SuperTrend, Chaikin Money Flow, Aroon — ~25
in total). Re-evaluated on every scheduler tick and on every Horizon trade-stream update.

### `dca` — Dollar-Cost Averaging Agents
Redeems a fixed spend against the agent's delegation on a fixed interval — no market analysis,
just scheduled delegated spend.

### `limit` — One-Shot Conditional Orders
Fires a single conditional order once its trigger price is hit, then completes.

**Shared guarantees across all four types:** delegation caveats (spend-limit, target-whitelist,
time-restriction) are enforced on-chain at redemption regardless of what the backend decided;
`paper`-mode agents never sign or submit a real transaction; every decision, validation result,
and execution is written to the audit log.

---

## Architecture

This is the pipeline for a `role` agent (`backend/src/roleTick.ts`) — the richest of the four
strategy types; `quant` runs the same shape with a chosen indicator strategy instead of an LLM
call, and `dca`/`limit` skip straight to Execute on their own trigger (interval / limit price):

```
                 ┌─────────────────────────────────┐
                 │  Horizon trade aggregations /    │
                 │  SSE trade stream (priceHistory, │
                 │  priceFeed.ts)                   │
                 └────────────────┬────────────────┘
                                  │ Candles
                                  ▼
                 ┌─────────────────────────────────┐
                 │  computeIndicators/computeRegime │
                 │  (RSI, MACD, EMA, ATR, SMA, ADX)  │
                 └────────────────┬────────────────┘
                                  │ MarketContext
                                  ▼
                 ┌─────────────────────────────────┐
                 │  decisionEngine.ts                │
                 │  ┌─────────────────────────┐     │
                 │  │ decideStrategic          │     │
                 │  │ decideYield              │     │
                 │  │ decideBalancer           │     │
                 │  └─────────────────────────┘     │
                 │  HF Llama-3.1-8B-Instruct, JSON;  │
                 │  deterministic fallback if HF     │
                 │  is unavailable                   │
                 └────────────────┬────────────────┘
                                  │ AgentDecision (advisory, no size)
                                  ▼
                 ┌─────────────────────────────────┐
                 │  validation.ts                    │
                 │  validatePolicy → validateDelegation │
                 │  → riskChecks (12% vol ceiling,   │
                 │    20% drawdown circuit breaker)  │
                 └────────────────┬────────────────┘
                                  │ Validated (blocks here on failure)
                                  ▼
                 ┌─────────────────────────────────┐
                 │  executeQuantTrade (live, Turnkey │
                 │  signer) / executePaperQuantTrade │
                 │  (paper, synthetic fill)          │
                 └────────────────┬────────────────┘
                                  │ Live only
                                  ▼
                 ┌─────────────────────────────────┐
                 │  Kairos SDK → redeem_delegations  │
                 │  → DelegationManager Contract     │
                 └────────────────┬────────────────┘
                                  │ Enforces Caveats & Validates Nonce
                                  ▼
                 ┌─────────────────────────────────┐
                 │     CustomAccount (Smart Wallet) │
                 └─────────────────────────────────┘
```

### Architectural Layers
* **Market Data:** `backend/src/priceHistory.ts` pulls OHLC candles from Stellar Horizon's `trade_aggregations`; `priceFeed.ts` subscribes to Horizon's SSE trade stream for near-instant `quant`/`limit` trigger checks. (A separate Binance-fed oracle, `apps/web/oracle/`, powers the app's GraphQL price API only — it does not feed agent decisions.)
* **Decision Engine (`backend/src/decisionEngine.ts`):** Computes indicators/regime, then either calls the HF LLM (role agents) or a chosen deterministic strategy (`quant` agents) for a proposed action. Never sizes the trade.
* **Validation Pipeline (`backend/src/validation.ts`):** The only component that decides whether a proposed action is allowed to proceed this tick — checks policy (confidence floor, non-zero size), delegation (must be active for live agents), and risk (volatility/drawdown circuit breakers). Cannot be bypassed by any strategy type.
* **Paper Trading:** `paperExecutor.ts` returns a synthetic `paper-<uuid>` fill instead of signing/submitting — everything downstream (PnL, positions, audit) is identical to a live trade.
* **Kairos SDK:** TypeScript client for interacting with deployed Soroban contracts.
* **CustomAccount:** On-chain smart wallet that validates all executions against delegation policies before authorizing transfers.

---

## Security Model

```
  ┌─────────────┐     ┌──────────────────┐     ┌────────────────────┐
  │  User Intent │────▶│   Policy Gate    │◀────│  LLM / Strategy   │
  │  → Profile   │     │  (hard boundary) │     │  (advisory only)  │
  └─────────────┘     └────────┬─────────┘     └────────────────────┘
                               │
                               ▼
                    ┌────────────────────┐
                    │ On-Chain Caveats   │
                    │ (spend-limit,      │
                    │  target-whitelist, │
                    │  time-restriction) │
                    └────────┬───────────┘
                             │
                             ▼
                    ┌────────────────────┐
                    │ DelegationManager  │
                    │ (nonce, replay     │
                    │  protection)       │
                    └────────┬───────────┘
                             │
                             ▼
                    ┌────────────────────┐
                    │ CustomAccount      │
                    │ (smart wallet,     │
                    │  no custody)       │
                    └────────────────────┘
```

**Key security properties:**
1. **LLM is advisory only** — It proposes actions but never sets amounts. The backend's `validatePolicy`/`riskChecks` (`backend/src/validation.ts`) decide whether a proposal is allowed to execute, not the model.
2. **Validation pipeline cannot be bypassed** — Every proposal from every strategy type passes through policy → delegation → risk checks before execution.
3. **On-chain caveats are final** — Even if backend validation were compromised, on-chain spend limits and asset whitelists (enforced at `redeem_delegations`) would block unauthorized transfers.
4. **Replay protection** — Monotonic nonces per delegator prevent replay attacks.
5. **Non-custodial** — The AI/strategy provider never has access to the user's private keys (agent keys are Turnkey MPC-backed). All live execution is via delegated redemption.

---

## Technology Stack

* **Next.js 16:** App Router-based frontend architecture.
* **TypeScript:** End-to-end type safety across the monorepo.
* **Stellar & Soroban:** High-performance, low-cost decentralized ledger and smart contract platform.
* **Freighter:** The official Stellar browser wallet extension for secure signature management.
* **Hugging Face Inference API:** Intent parsing and role-agent advisory decisions via `meta-llama/Llama-3.1-8B-Instruct`.
* **Technical Indicators:** Mathematical indicator computation library backing the ~25-strategy quant catalogue and regime/indicator computations.
* **Turnkey:** MPC-backed Ed25519 key custody for Strategy Mode agent wallets.
* **SQLite (`better-sqlite3`):** Server-side persistence for agents, trades, positions, delegations, and the audit log.
* **Binance Oracle:** Data feed powering the app's GraphQL price API (separate from the agent decision pipeline, which uses Stellar Horizon).

---

## Strategy Mode (Agent Backend)

Separate from the frontend's `apps/web`-local Paper Trading Engine (fees/slippage sim, per-
wallet `localStorage`), Strategy Mode is a persistent, server-authoritative trading terminal:

```
   Freighter sig-challenge ──▶ JWT session (all /api/agents,
                                /positions, /audit calls)
                                        │
                                        ▼
   Scheduler (poll, dca)   ──┐   ┌─────────────────┐
                             ├──▶│  tick.ts /       │──▶ paperExecutor.ts (paper: no signing/submit)
   PriceFeedService         ─┘   │  runAgentTick    │──▶ real Turnkey signer + Horizon (live)
   (Horizon SSE trade       │    └────────┬────────┘
    stream, quant/limit)    │             │
                            │             ▼
                            │    trades + positions + audit_log (SQLite)
                            │             │
                            │             ▼
                            └──▶  /api/agents/:id/dashboard, /audit, /positions
                                        │
                                        ▼
                              Frontend (poll/SSE, no local trading state)
```

Backend is the single source of truth — the frontend only renders what it fetches. Every
agent, trade, position, and lifecycle/execution event is scoped to the authenticated wallet and
survives refresh/login. Full design in [`backend/README.md`](./backend/README.md).

## Repository Structure

```
.
├── apps/
│   └── web/                  # Next.js web application (Dashboard & API)
│       ├── app/              # Next.js App Router pages and globals
│       ├── components/       # Reusable UI component library (Shadcn-based)
│       ├── lib/              # Core logic (Decision, Strategy, Paper Trading)
│       └── oracle/           # Price oracle and indicator calculator engines
├── backend/                  # Strategy Mode agent backend (see backend/README.md)
├── packages/
│   ├── sdk/                  # TypeScript SDK for interacting with Kairos contracts
│   ├── mcp-agent/            # MCP agent package
│   ├── turnkey-signer/       # Turnkey MPC signer integration
│   └── types/                # Shared TypeScript types
├── contracts/
│   └── soroban/              # Soroban Rust contracts (Delegation Manager, Policies, CustomAccount)
├── scripts/
│   ├── deploy-testnet.ts     # Deploy all contracts to Stellar testnet
│   ├── test-integration.ts   # SDK integration test against testnet
│   └── demo-e2e.ts           # Full end-to-end demo (intent → decision → on-chain)
├── configs/
│   └── contracts.testnet.json # Deployed contract IDs
├── docs/
│   ├── architecture/         # Architecture documentation and reports
│   ├── api/                  # SDK API reference
│   └── security/             # Security audit and contract-level security
├── .env.example              # Environment variable documentation
├── README.md                 # This file
└── SECURITY.md               # Security guarantees and architecture
```

---

## Getting Started

### Prerequisites

* Node.js `>=18.0.0`
* pnpm

### Installation

```bash
# Install monorepo dependencies
pnpm install

# Build the SDK package
pnpm run build
```

### Environment Variables

Copy `.env.example` to `app/.env.local` and configure:

```bash
cp .env.example apps/web/.env.local
```

Required variables:

| Variable | Description |
| :--- | :--- |
| `STELLAR_NETWORK` | `testnet` or `mainnet` |
| `STELLAR_RPC_URL` | Soroban RPC endpoint |
| `STELLAR_NETWORK_PASSPHRASE` | Network passphrase |
| `DELEGATION_MANAGER_CONTRACT_ID` | Deployed DelegationManager contract ID |
| `POLICY_CONTRACT_ID` | Deployed PolicyEngine contract ID |
| `CUSTOM_ACCOUNT_CONTRACT_ID` | Deployed CustomAccount contract ID |
| `CUSTOM_ACCOUNT_WASM_HASH` | WASM hash of the CustomAccount contract |
| `FUNDER_SECRET_KEY` | Funded testnet keypair secret for on-chain operations |
| `HUGGINGFACE_API_KEY` | Hugging Face Inference API token (optional — falls back to regex + deterministic logic) |
| `DATABASE_URL` | Persistence layer URL for Strategy Mode (Turso / libSQL / Postgres / SQLite) |
| `TURNKEY_ORGANIZATION_ID` | Turnkey org ID — MPC key custody for agent wallets (see `backend/README.md`) |
| `TURNKEY_CREDENTIALS_FILE` | Path to Turnkey API credentials JSON (default `./secrets/kairos-api-turnkey.json`) |

### Running the Dashboard

```bash
cd apps/web
pnpm run dev
```

The dashboard will be available at `http://localhost:3000`.

### Deploying to Vercel

This is a pnpm monorepo — the Next.js app lives in `apps/web/`. To deploy on Vercel:

1. **Import the repo** into Vercel.
2. **Set Root Directory** to `apps/web/` in project settings (Settings → General → Root Directory).
3. **Add environment variables** listed in `.env.example` to your Vercel project.
4. **Deploy** — Vercel will install from root (resolving workspace deps) and build both the SDK and app.

The `vercel.json` at the repo root handles the build pipeline automatically.

### Running the Demo

```bash
# Deploy contracts (one-time)
npx tsx scripts/deploy-testnet.ts

# Run full e2e demo
export FUNDER_SECRET_KEY=SC…
npx tsx scripts/demo-e2e.ts
```

### Running Tests

```bash
# SDK unit tests
pnpm test

# Integration test (requires deployed contracts + funded key)
export FUNDER_SECRET_KEY=SC…
npx tsx scripts/test-integration.ts

# E2E Playwright tests
cd apps/web
pnpm exec playwright test
```

---

## Deployed Contracts (Testnet)

| Contract | Address |
| :--- | :--- |
| DelegationManager | `CBR4HWJF4ZLDF4C6GF25PQWWZE5M7AOWGZHLJQH6DTEUXJ756KMOHYLF` |
| PolicyEngine | `CA6BPEFDZIC737VS26DQU77UYX5K4NB7VAKWNZAUO36WG7T24Z7N4BYD` |
| CustomAccount | `CAN25TOZQ6UXNVQO35RJLVND4VKTL52QOIQ7B4CWZRSZC5BDC5EQFNXF` |
| Registry | `CBDFFK2F4NZGXR7SRQAND3UZEIS32EHHVYNX4S475A7YYZDGN2E67SJV` |

PolicyEngine was redeployed to reflect the pooled-protocol-spend-limit / typed-error hardening in
`contracts/soroban/contracts/policies/src/lib.rs` — DelegationManager, CustomAccount, and Registry
are unchanged from the prior deployment, so existing wallets/delegations remain valid.

---

## Roadmap

```
  ┌────────────────────────────────────────────────────────┐
  │                        Roadmap                         │
  └────────────────────────────────────────────────────────┘
     │
     ├─► MVP (Current)
     │    ├── Soroban Delegation Framework
     │    ├── Paper Trading Simulator
     │    ├── Hugging Face AI Intent Parsing & Advisory
     │    ├── Policy-Gated Decision Engine
     │    ├── Technical Indicator Calculations
     │    └── Strategy Mode: persistent agent backend, paper/live execution,
     │        audit trail, Freighter wallet-signature auth, near-real-time
     │        (Horizon SSE) trigger detection
     │
     └─► Future Phases
          ├── Live Trading on Stellar mainnet (Strategy Mode currently testnet-only)
          ├── Multi-Agent AI orchestration
          ├── Advanced ML risk assessment models
          ├── Historical backtesting suite
          └── Real-time analytics dashboard
```

---

## Security

Kairos is architected with security as its primary primitive. See [SECURITY.md](./SECURITY.md) for the full security model.

* **Assets Isolation:** User funds remain inside the user's personal Smart Wallet contract.
* **Zero Ownership:** Automated agents never take custody of keys or assets.
* **AI is Advisory:** The LLM (Hugging Face) proposes actions but never determines position size. The policy gate is the sole authority for amounts.
* **Immutable Policies:** Every trade execution is checked on-chain against policies (time, asset whitelist, daily volume cap) before a transfer is authorized.
* **Non-Custodial Design:** Users can withdraw capital or revoke delegation permissions at any moment directly on-chain.

---

## Contributing

We welcome community contributions. To contribute:

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/your-feature-name`.
3. Ensure all tests pass: `pnpm test`.
4. Commit your changes with professional and descriptive commit messages.
5. Push to your fork and submit a Pull Request.

---

## License

This project is licensed under the [MIT License](./LICENSE).
