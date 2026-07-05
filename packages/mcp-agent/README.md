# @wolf1276/kairos-mcp-agent

An MCP server that lets an AI agent (e.g. Claude via MCP) spend from a delegation on a Kairos
Smart Wallet, using its own MPC-backed key — never the user's real wallet key, and never a raw
secret sitting in this process either.

## How it works

1. Every agent identity (`KAIROS_AGENT_ID`) gets its **own** Ed25519 private key, generated
   and held as secret shares across Turnkey's MPC signing cluster — the key material is
   never assembled in, or transmitted to, this process, and is never shared across agents.
2. The user creates a Kairos delegation in the dashboard with `delegate` = that specific
   agent's public key, and caveats (spend-limit / target-whitelist / time-restriction) that
   bound what it's allowed to do.
3. The signed delegation is exported and saved where the agent runs.
4. The agent's MCP tools (`spend_funds`, `execute_action`) redeem that delegation directly
   on-chain; every signature is a network round-trip to Turnkey. The delegation's caveats are
   enforced by the Kairos `policies` contract regardless of what the agent tries to do.

## Setup

Each agent you want to run needs its own `KAIROS_AGENT_ID` and its own delegation. Running
the server (or the keygen CLI) without setting `KAIROS_AGENT_ID` uses the `"default"` identity.

You'll also need a Turnkey organization and an API key for it (Turnkey dashboard → API Keys
→ export as JSON). See "Running the server" below for where that file goes.

```bash
pnpm --filter @wolf1276/kairos-mcp-agent build

# Provisions a new Turnkey Ed25519 key for this agentId on first run (subsequent runs reuse
# it) and prints "<agentId>\t<publicKey>\t(turnkey key: <privateKeyId>)". The local registry
# file at ~/.kairos/agents/<agentId>.json (dir overridable via KAIROS_AGENT_KEYSTORE_DIR)
# only stores that privateKeyId pointer — it holds no secret.
node dist/cli/keygen.js trading-agent
node dist/cli/keygen.js research-agent

# List every agent identity that already has a key registered on this machine.
node dist/cli/keygen.js --list
```

Paste each agent's public key into the Kairos dashboard's delegation form (Delegate → "AI
agent") **separately** — one delegation per agent — attach the policies you want to grant
that specific agent, create the delegation, then use the "Export for agent" panel to copy
its JSON and save it as:

```
~/.kairos/delegations/<hash>.json
```

(or wherever `KAIROS_DELEGATIONS_DIR` points — this directory is shared across agents; each
agent only picks up the delegation files where it is the `delegate`).

## Running the server

Requires these env vars:

- `STELLAR_NETWORK` (`testnet` or `mainnet`, default `testnet`)
- `DELEGATION_MANAGER_CONTRACT_ID`
- `POLICY_CONTRACT_ID`
- `CUSTOM_ACCOUNT_CONTRACT_ID` (optional)
- `KAIROS_DELEGATIONS_DIR` (optional, default `~/.kairos/delegations`)
- `KAIROS_AGENT_ID` (optional, default `"default"` — selects which agent identity/Turnkey
  key this process uses; give each agent a distinct id)
- `KAIROS_AGENT_KEYSTORE_DIR` (optional, default `~/.kairos/agents` — stores only
  agentId→privateKeyId pointers, no secrets)
- `TURNKEY_ORGANIZATION_ID` — your Turnkey organization to create/use agent keys under
- `TURNKEY_CREDENTIALS_FILE` — path to the API key JSON exported from Turnkey's dashboard
  (e.g. `../secrets/kairos-api-turnkey.json` — keep it out of source control), **or** set
  `TURNKEY_API_PUBLIC_KEY` / `TURNKEY_API_PRIVATE_KEY` directly instead of a file

Register one stdio MCP server entry **per agent identity**, e.g. in Claude Code's
`.mcp.json` — note each entry sets a different `KAIROS_AGENT_ID` but shares one Turnkey org,
so each agent gets its own key within it and must be delegated to separately:

```json
{
  "mcpServers": {
    "kairos-trading-agent": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp-agent/dist/index.js"],
      "env": {
        "KAIROS_AGENT_ID": "trading-agent",
        "STELLAR_NETWORK": "testnet",
        "DELEGATION_MANAGER_CONTRACT_ID": "...",
        "POLICY_CONTRACT_ID": "...",
        "CUSTOM_ACCOUNT_CONTRACT_ID": "...",
        "TURNKEY_ORGANIZATION_ID": "...",
        "TURNKEY_CREDENTIALS_FILE": "/absolute/path/to/secrets/kairos-api-turnkey.json"
      }
    },
    "kairos-research-agent": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp-agent/dist/index.js"],
      "env": {
        "KAIROS_AGENT_ID": "research-agent",
        "STELLAR_NETWORK": "testnet",
        "DELEGATION_MANAGER_CONTRACT_ID": "...",
        "POLICY_CONTRACT_ID": "...",
        "CUSTOM_ACCOUNT_CONTRACT_ID": "...",
        "TURNKEY_ORGANIZATION_ID": "...",
        "TURNKEY_CREDENTIALS_FILE": "/absolute/path/to/secrets/kairos-api-turnkey.json"
      }
    }
  }
}
```

## Tools

- `get_agent_pubkey` — returns this agent's id and public key as `{ agentId, publicKey }`
  (same identity the keygen CLI prints for this `KAIROS_AGENT_ID`).
- `list_my_delegations` — lists delegations granted to this agent and their decoded caveats.
- `spend_funds({ token, to, amount })` — SEP-41 transfer from the delegated Smart Wallet, gated
  by a spend-limit caveat for `token`.
- `execute_action({ target, function, args })` — generic contract call, gated by a
  target-whitelist caveat for `target`.

## Verification

```bash
export FUNDER_SECRET_KEY=SC...
pnpm --filter @wolf1276/kairos-mcp-agent smoke-test
```

Deploys a smart wallet, funds it, creates a spend-limit delegation for a fresh ephemeral
agent key, and asserts a within-limit transfer succeeds while an over-limit one is rejected.
