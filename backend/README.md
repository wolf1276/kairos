# @wolf1276/kairos-agent-backend

A custodial agent-wallet runtime. Unlike `packages/mcp-agent` (where each user runs their own
local MCP server holding its own ephemeral key), this is a centralized service that:

1. Generates and encrypts agent keypairs server-side (AES-256-GCM, key from `AGENT_MASTER_KEY`).
2. Lets a user attach a signed Kairos delegation to an agent (delegate = that agent's public key).
3. Runs a scheduler that ticks every `SCHEDULER_INTERVAL_MS` and, for every `running` agent,
   executes its configured strategy against its attached delegation — currently only `dca`
   (spend a fixed amount to a fixed destination on a fixed interval) is implemented.

The frontend at `/dashboard/agents` talks to this service directly over HTTP.

## Setup

```bash
cp .env.example .env
# fill in DELEGATION_MANAGER_CONTRACT_ID / POLICY_CONTRACT_ID / CUSTOM_ACCOUNT_CONTRACT_ID
# from configs/contracts.testnet.json, and generate AGENT_MASTER_KEY:
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

- `AGENT_MASTER_KEY` decrypts every stored agent secret — treat it like a root credential.
  Losing it makes all stored agent wallets permanently unusable (the secrets are unrecoverable
  without it, by design).
- This service should sit behind your own auth/network boundary before going anywhere near
  production — as built, any caller who can reach `/api/agents` can create agents and start
  strategies against whatever delegation gets attached. There's no per-request authentication
  yet; `owner` is a client-supplied filter, not a verified identity.
