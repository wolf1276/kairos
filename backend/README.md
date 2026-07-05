# @wolf1276/kairos-agent-backend

Custodial agent-wallet runtime + Strategy Mode trading engine. Unlike `packages/mcp-agent`
(each user runs their own local MCP server holding its own MPC-backed key), this is a
centralized service that:

1. Creates a Turnkey-backed Ed25519 key per agent — the private key is generated and held as
   secret shares across Turnkey's MPC signing cluster, never assembled in this process (see
   `src/turnkey.ts`, `@wolf1276/kairos-turnkey-signer`). Agents created before this
   integration keep working via their legacy AES-256-GCM-encrypted secret (`AGENT_MASTER_KEY`).
2. Lets a user attach a signed Kairos delegation to an agent (delegate = that agent's public key).
3. Runs `dca` (delegated spend), `quant` (technical-indicator signal trading), and `limit`
   (one-shot conditional order) strategies, each in **paper** (simulated fill, no signing/
   submission) or **live** (real Stellar transaction) mode, set per agent at creation.
4. Persists every agent, trade, position, and lifecycle/execution event to SQLite, scoped to
   the authenticated wallet — nothing lives only in frontend state.

The frontend at `/dashboard/agents` and `/dashboard/trade` talks to this service directly over
HTTP, authenticated via a Freighter wallet-signature session token.

## Setup

```bash
cp .env.example .env
# fill in DELEGATION_MANAGER_CONTRACT_ID / POLICY_CONTRACT_ID / CUSTOM_ACCOUNT_CONTRACT_ID
# from configs/contracts.testnet.json.
#
# Turnkey (new agents' keys live here): set TURNKEY_ORGANIZATION_ID and point
# TURNKEY_CREDENTIALS_FILE at your exported Turnkey API key JSON, e.g.
# ../secrets/kairos-api-turnkey.json (keep it out of source control).
#
# AUTH_JWT_SECRET signs session tokens issued after wallet-signature login:
openssl rand -hex 32

# AGENT_MASTER_KEY is only needed if this DB has agents created before Turnkey integration:
openssl rand -hex 32

pnpm --filter @wolf1276/kairos-agent-backend dev
```

## Auth

Every route under `/api/agents`, `/api/positions`, `/api/audit`, `/api/agents/summary`
requires a bearer session token, obtained via a Freighter wallet-signature challenge/response
(no password/email — the connected Stellar address *is* the identity):

- `POST /api/auth/challenge { publicKey }` → `{ nonce, message }` — a short-lived (5min) nonce
  bound to that address.
- Client signs `message` with Freighter's `signMessage`.
- `POST /api/auth/verify { publicKey, signature }` → `{ token }` — verifies the ed25519
  signature over the exact challenge message, upserts a `users` row, issues a 7-day JWT.
- Every subsequent request sends `Authorization: Bearer <token>`. The backend derives the
  caller's identity from this token — a client-supplied `owner` field is never trusted, and
  every `:id`-scoped route additionally checks the agent's `owner` matches the token's
  `publicKey` (403 otherwise).

See `apps/web/app/lib/agentsAuth.ts` for the frontend side of this handshake (run once per
Freighter connection, cached in `sessionStorage`). This is separate from the *onboarding* flow
(deploying/checking a caller's Smart Wallet, via `apps/web/app/api/connect/*` and the
`smart_wallets` table below) — see the root [`README.md`](../README.md#authentication--onboarding)
for how the two fit together.

## Strategy execution

- **Scheduler** (`src/runner.ts`): in-process `setInterval` poll, ticks every `running` agent
  every `SCHEDULER_INTERVAL_MS`; each agent's own `intervalSeconds` further throttles it. Drives
  `dca` fully and acts as the slow-poll fallback for `quant`/`limit` if the price stream drops.
- **PriceFeedService** (`src/priceFeed.ts`): subscribes to Horizon's native SSE trade stream per
  active pair and evaluates `quant`/`limit` triggers in-memory on every trade tick, so a limit
  order or quant re-check fires near-instantly instead of waiting for the next scheduler pass.
  Note: Horizon only pushes on actual DEX trades, not a fixed clock — thin pairs can still see
  multi-second gaps.
- **Paper vs. live** (`src/paperExecutor.ts` vs. the real-execution functions in `src/tick.ts`):
  `mode` is set once at agent creation and is immutable — a paper agent never signs or submits
  a real transaction; its trades get a synthetic `tx_hash = paper-<uuid>` but flow through the
  exact same PnL/position/audit pipeline as a live trade.

## Persistence

SQLite (`better-sqlite3`), manual `CREATE TABLE IF NOT EXISTS` + guarded `ALTER TABLE`
migrations in `src/db.ts` — no ORM. Tables: `agents`, `wallet_delegations`, `trades`,
`positions`, `audit_log`, `users`, `auth_challenges`, `smart_wallets`.

- `smart_wallets` (`src/routes/smartWallets.ts`, `listSmartWallets`/`upsertSmartWallet` in
  `src/db.ts`) — one row per `(owner, address)`, the server-side record of which Smart Wallet
  contract(s) an owner has deployed. This is what `apps/web/app/api/connect/*` (onboarding) reads
  and writes; it's also how a returning owner on a new device/browser recovers their existing
  Smart Wallet instead of being treated as a first-time user. Databases from before this table
  was renamed (`capital_wallets`) are migrated in place on first boot.

- `positions` (`src/positionService.ts`) — one row per agent+pair, upserted after every trade
  fill using the same weighted-avg-cost math as PnL, so open positions survive a refresh
  without replaying full trade history on every read.
- `audit_log` (`src/auditService.ts`) — append-only lifecycle + execution trail: strategy
  started/stopped/error, signal generated (with market snapshot/indicators), delegation/policy
  validation, trade executed, position updated. Broader than `trades` (fills only) — this is
  the full "why did this happen" record. Also emits on an in-process `EventEmitter` for the
  audit SSE stream.

## API

- `POST /api/agents { mode?, capital?, riskLevel? }` → creates an agent owned by the
  authenticated wallet (`mode` defaults `'live'`; pass `'paper'` for simulated trading)
- `GET /api/agents` → list the authenticated wallet's agents
- `GET /api/agents/:id` → agent detail
- `POST /api/agents/:id/delegation { delegation }` → attach a signed `JsonSafeDelegation`
  (delegate must equal this agent's public key)
- `POST /api/agents/:id/delegation/revoke`
- `POST /api/agents/:id/strategy { type: 'dca' | 'quant' | 'limit', ... }`
- `POST /api/agents/:id/start` — requires a delegation (dca only) and strategy already attached
- `POST /api/agents/:id/stop`
- `DELETE /api/agents/:id` — must be stopped first. Only removes the local record; does **not**
  revoke the on-chain delegation (needs the smart wallet owner's Freighter signature) — revoke
  from `/dashboard/delegations-v2` to fully cut off access.
- `GET /api/agents/:id/trades` → fills + PnL summary for that agent
- `POST /api/agents/:id/trades/:tradeId/reverse` — quant only; rejects reversal across a
  paper/live mode boundary
- `GET /api/agents/:id/positions`, `GET /api/positions` → open positions (per-agent / all)
- `GET /api/agents/:id/audit`, `GET /api/audit` → paginated audit trail (per-agent / all,
  `?limit=&before=`)
- `GET /api/audit/stream` → SSE feed of new audit events for the authenticated wallet
- `GET /api/agents/:id/dashboard`, `GET /api/agents/summary` → aggregate stats (win rate, total
  return, running time, delegation/position/PnL snapshot) for one agent or all of them
- `GET /api/smart-wallets` → this owner's registered Smart Wallet(s)
- `POST /api/smart-wallets { address, label?, network? }` → idempotent upsert (re-registering an
  address already on file just updates its label/network); returns the full updated list. Backs
  the onboarding check/register steps in `apps/web/app/api/connect/*` — see the root README's
  [Authentication & Onboarding](../README.md#authentication--onboarding) section.

## Security notes

- New agents' private keys never exist in this process — they're MPC-backed via Turnkey, and
  every signature is a network round-trip to Turnkey's cluster. The `TURNKEY_API_PRIVATE_KEY`
  (or `TURNKEY_CREDENTIALS_FILE`) is the one local secret in this design: it authenticates to
  Turnkey but by itself cannot reconstruct any agent's Ed25519 key. Treat it like a root
  credential regardless — anyone holding it can request signatures from every agent key in
  the Turnkey organization.
- `AGENT_MASTER_KEY` only matters for agents created before Turnkey integration — it decrypts
  their locally stored secret. Losing it makes those specific stored agent wallets permanently
  unusable (the secrets are unrecoverable without it, by design); it has no effect on
  Turnkey-backed agents.
- `AUTH_JWT_SECRET` signs every session token — treat it as a root credential too; anyone
  holding it can mint a valid session for any wallet address without ever signing anything in
  Freighter.
- Every `/api/agents`, `/api/positions`, `/api/audit` route requires a valid bearer session and
  enforces per-agent ownership server-side (see Auth above) — this closes the gap from earlier
  versions of this service where `owner` was a client-supplied, unverified string.
