# @wolf1276/kairos-agent-backend

The Kairos agent backend: a strategy-trading terminal and the AI **Reasoning Engine**, exposed over a REST API and persisted to SQLite (agents, trades, audit, …) plus Postgres (smart-wallet ownership). It runs `dca` / `quant` / `limit` / `role` strategies against live market data, scoped to a wallet authenticated by a Freighter signature session.

> [!IMPORTANT]
> **Paper mode is the functional path today.** A paper agent runs the full pipeline — market data
> → decision → validation → position/PnL → audit — with a synthetic fill instead of a signed
> transaction. **Live mode requires a working key-custody signer**, and the current Turnkey MPC
> integration (`@wolf1276/kairos-turnkey-signer`) is not functional end to end, so live on-chain
> execution is effectively disabled. Everything else in this service works against Stellar testnet.

The frontend at `/dashboard/agents` and `/dashboard/context` talks to this service over HTTP, authenticated with a Freighter wallet-signature session token.

## Setup

```bash
cp .env.example .env
# Fill in the deployed contract IDs from ../configs/contracts.testnet.json:
#   DELEGATION_MANAGER_CONTRACT_ID / POLICY_CONTRACT_ID / CUSTOM_ACCOUNT_CONTRACT_ID
#
# AUTH_JWT_SECRET signs the session tokens issued after wallet-signature login:
openssl rand -hex 32
#
# HUGGINGFACE_API_KEY (optional) enables LLM decisions/intent parsing; a deterministic
# fallback is used when it's unset or the API is unavailable.

pnpm --filter @wolf1276/kairos-agent-backend dev
```

## Reasoning Engine

`src/reasoning/` is a mostly-deterministic decision pipeline that sits on top of the [Context Layer](../docs/architecture/CONTEXT_LAYER.md) (`src/agentContext/`) and the [Memory Engine](../docs/architecture/MEMORY_ENGINE.md) (`src/memoryLayer/`). Only the Decision Intelligence step calls an LLM; every step after it is rule-based and reproducible.

```
AgentContext + MemoryPackage + UserPolicy
        │
        ▼
  Decision Intelligence   (src/reasoning/decisionIntelligence) — LLM proposes an action,
        │                  never sizes or authorizes it
        ▼
  Verification            (src/reasoning/verification) — deterministic rules: schema, policy,
        │                  capital, risk, evidence, consistency
        ▼
  Execution Planner       (src/reasoning/executionPlanner) — deterministic plan +
                           prerequisite checks, no chain call
```

The public surface is `src/reasoning/index.ts`; nothing outside the engine reaches into its
internals. Full design: [`docs/architecture/REASONING_ENGINE.md`](../docs/architecture/REASONING_ENGINE.md).
The engine is exercised by the [reasoning benchmark harness](./benchmarks/reasoning/README.md) and
an extensive unit-test suite (`src/__tests__/`).

Per-subsystem READMEs:
[`src/reasoning`](./src/reasoning/README.md) (pipeline + LLM providers),
[`src/agentContext`](./src/agentContext/README.md) (Context Layer),
[`src/memoryLayer`](./src/memoryLayer/README.md) (Memory Engine),
[`src/strategyEngine`](./src/strategyEngine/README.md) (strategy layers),
[`src/protocolAdapters`](./src/protocolAdapters/README.md) (Protocol Layer),
[`src/runtime`](./src/runtime/README.md) (Autonomous Runtime),
and the [e2e benchmark harness](./benchmarks/e2e/README.md).

## Auth

Every route under `/api/agents`, `/api/positions`, `/api/audit`, `/api/smart-wallets` requires a bearer session token, obtained via a Freighter wallet-signature challenge/response — no password or email, the connected Stellar address *is* the identity:

- `POST /api/auth/challenge { publicKey }` → `{ nonce, message }` — a short-lived (5 min) nonce bound to that address.
- Client signs `message` with Freighter's `signMessage`.
- `POST /api/auth/verify { publicKey, signature }` → `{ token }` — verifies the Ed25519 signature over the exact challenge, upserts a `users` row, issues a 7-day JWT.
- Every subsequent request sends `Authorization: Bearer <token>`. Identity is derived from the token — a client-supplied `owner` is never trusted, and every `:id`-scoped route additionally checks the agent's `owner` matches the token's `publicKey` (403 otherwise).

This is separate from the *onboarding* flow (deploying/checking a Smart Wallet, via `apps/web/app/api/connect/*`) — see the root [Getting Started](../README.md#getting-started) for how the two fit together.

## Strategy execution

- **Scheduler** (`src/runner.ts`): in-process `setInterval` poll; ticks every `running` agent, throttled by each agent's own `intervalSeconds`. Drives `dca` and acts as the slow-poll fallback for `quant` / `limit`.
- **PriceFeedService** (`src/priceFeed.ts`): subscribes to Horizon's SSE trade stream per active pair and evaluates `quant` / `limit` triggers in-memory on every trade tick — so a limit order or quant re-check fires near-instantly. (Horizon pushes on actual DEX trades, not a fixed clock, so thin pairs can still see gaps.)
- **Paper vs. live** (`src/paperExecutor.ts` vs. the live path in `src/tick.ts`): `mode` is fixed at agent creation and immutable. A paper agent gets a synthetic `tx_hash = paper-<uuid>` but flows through the exact same PnL / position / audit pipeline as a live trade. Live execution is gated on a working signer (see the note above).
- **Role agents** (`src/roleTick.ts`, `src/decisionEngine.ts`): Strategic, Yield, and Balancer agents, each running Context → Analysis → LLM decision (deterministic fallback if unavailable) → validation (policy → delegation → risk) → execute → positions → audit. Validation hard-blocks trades above a 12% volatility ceiling and circuit-breaks an agent once cumulative loss exceeds 20% of its allocated capital.

## Persistence

Two stores:

**SQLite** (`better-sqlite3`), with hand-written `CREATE TABLE IF NOT EXISTS` + guarded `ALTER TABLE` migrations in `src/db.ts` — no ORM. Tables include `agents`, `wallet_delegations`, `trades`, `positions`, `audit_log`, `decisions`, `performance_snapshots`, `portfolio_state`, `execution_journal`, `protocol_execution_journal`, `protocol_positions`, `users`, `auth_challenges`. Path from `AGENTS_DB_PATH` (default `./data/agents.db`), WAL mode, `foreign_keys=ON`.

**Postgres** (`pg`, `src/smartWalletsDb.ts`) — the production store of record for **smart-wallet ownership only** (`smart_wallets`). It is **required** and there is **no SQLite fallback**: `config.getDatabaseUrl` throws if `DATABASE_URL` is unset. Writes are read-back-verified before resolving. Tests use `pg-mem`.

- `positions` (`src/positionService.ts`) — one row per agent+pair, upserted after every fill with the same weighted-average-cost math as PnL, so open positions survive a refresh.
- `audit_log` (`src/auditService.ts`) — append-only lifecycle + execution trail (strategy started/stopped/error, signal generated with market snapshot, validation, trade executed, position updated). Broader than `trades` (fills only) — the full "why did this happen" record. Also feeds the audit SSE stream.
- `smart_wallets` (`src/smartWalletsDb.ts`, exposed via `src/routes/smartWallets.ts`) — one row per `(owner, address)` in **Postgres**; the record of which Smart Wallet(s) an owner has deployed, so a returning owner on a new device recovers their wallet instead of being onboarded again. Because it lives in Postgres, it survives backend redeploys/restarts regardless of the web service's disk plan.

## API

- `POST /api/agents { mode?, capital?, riskLevel? }` → create an agent owned by the authenticated wallet (`mode` defaults `'live'`; pass `'paper'` for simulated trading).
- `GET /api/agents` · `GET /api/agents/:id` → list / detail.
- `POST /api/agents/:id/delegation { delegation }` → attach a signed delegation (delegate must equal the agent's public key); `POST /api/agents/:id/delegation/revoke`.
- `POST /api/agents/:id/strategy { type: 'dca' | 'quant' | 'limit' | 'role', ... }`.
- `POST /api/agents/:id/start` · `POST /api/agents/:id/stop` · `DELETE /api/agents/:id` (must be stopped first; only removes the local record — revoke the on-chain delegation separately).
- `GET /api/agents/:id/trades` → fills + PnL summary; `POST /api/agents/:id/trades/:tradeId/reverse` (quant only).
- `GET /api/agents/:id/positions` · `GET /api/positions` → open positions.
- `GET /api/agents/:id/audit` · `GET /api/audit` → paginated audit trail (`?limit=&before=`); `GET /api/audit/stream` → SSE feed.
- `GET /api/agents/:id/context` → the assembled `AgentContext` (backs the Context inspector page).
- `GET /api/agents/:id/dashboard` · `GET /api/agents/summary` → aggregate stats.
- `GET /api/smart-wallets` · `POST /api/smart-wallets { address, label?, network? }` → this owner's registered Smart Wallet(s) (idempotent upsert).

## Tests & benchmarks

```bash
pnpm --filter @wolf1276/kairos-agent-backend test         # unit tests (reasoning, context, memory, validation, ...)
pnpm --filter @wolf1276/kairos-agent-backend benchmark    # reasoning benchmark harness (see benchmarks/reasoning)
pnpm --filter @wolf1276/kairos-agent-backend benchmark:e2e # end-to-end determinism/concurrency/reliability/performance
```

## Deployment

Render Blueprint at [`../render.yaml`](../render.yaml) (Docker-built from `backend/Dockerfile`, health-checked at `/health`, persistent Disk mounted at `AGENTS_DB_PATH`, plus a managed Postgres instance wired via `DATABASE_URL`). See the root [README's Render section](../README.md#deploy-the-backend-to-render) for setup steps — critically, `ALLOWED_ORIGIN` must be set to the deployed frontend's exact origin. A paid (Disk-capable) plan is required or the **SQLite** DB (agents/trades/etc.) resets on every redeploy; `smart_wallets` lives in Postgres (`DATABASE_URL`) and persists regardless of the disk plan.

## Security notes

- `AUTH_JWT_SECRET` signs every session token — treat it as a root credential. Anyone holding it can mint a valid session for any wallet address without ever signing in Freighter.
- Every `/api/agents`, `/api/positions`, `/api/audit` route requires a valid bearer session and enforces per-agent ownership server-side — a client-supplied `owner` is never trusted.
- Live execution is not functional today (no working signer). When a signer is integrated, on-chain caveats enforced by the `policies` contract at `redeem_delegations` remain the final authority regardless of what this backend decides.
