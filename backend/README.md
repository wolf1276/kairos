# @wolf1276/kairos-agent-backend

A custodial agent-wallet runtime. Unlike `packages/mcp-agent` (where each user runs their own
local MCP server holding its own MPC-backed key), this is a centralized service that:

1. Creates a Turnkey-backed Ed25519 key per agent — the private key is generated and held as
   secret shares across Turnkey's MPC signing cluster, never assembled in this process (see
   `src/turnkey.ts`, `@wolf1276/kairos-turnkey-signer`). Agents created before this
   integration keep working via their legacy AES-256-GCM-encrypted secret (`AGENT_MASTER_KEY`).
2. Lets a user attach a signed Kairos delegation to an agent (delegate = that agent's public key).
3. Runs a scheduler that ticks every `SCHEDULER_INTERVAL_MS` and, for every `running` agent,
   executes its configured strategy against its attached delegation — currently only `dca`
   (spend a fixed amount to a fixed destination on a fixed interval) is implemented.

The frontend at `/dashboard/agents` talks to this service directly over HTTP.

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
# AGENT_MASTER_KEY is only needed if this DB has agents created before Turnkey integration:
openssl rand -hex 32

pnpm --filter @wolf1276/kairos-agent-backend dev
```

## API

- `POST /api/agents { owner }` → `{ agent: { id, publicKey, ... } }`
- `GET /api/agents?owner=G...` → list an owner's agents
- `GET /api/agents/:id` → agent detail
- `POST /api/agents/:id/delegation { delegation }` → attach a signed `JsonSafeDelegation`
  (delegate must equal this agent's public key)
- `POST /api/agents/:id/strategy { type: 'dca', token, amountPerTick, intervalSeconds, destination }`
- `POST /api/agents/:id/start` — requires a delegation and strategy already attached
- `POST /api/agents/:id/stop`
- `DELETE /api/agents/:id` — must be stopped first. This only removes the local record; it
  does **not** revoke the on-chain delegation (that needs the smart wallet owner's Freighter
  signature) — revoke it from `/dashboard/delegations-v2` if you want to fully cut off access.

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
- This service should sit behind your own auth/network boundary before going anywhere near
  production — as built, any caller who can reach `/api/agents` can create agents and start
  strategies against whatever delegation gets attached. There's no per-request authentication
  yet; `owner` is a client-supplied filter, not a verified identity.
