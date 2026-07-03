# Delegation Wallet — End-to-End Workflow

This document describes how a user creates and manages a Kairos delegation wallet, and how
agents (and any other client) communicate with it. It reflects the code as it exists in
`packages/sdk`, `apps/web/app/api/delegate-sdk`, `apps/web/app/dashboard/delegations`,
`backend/`, and `packages/mcp-agent` — see `docs/security/DELEGATION_AUDIT.md` for known gaps.

## Actors and components

| Actor | Role |
|---|---|
| **Owner** | Human with a Freighter wallet (EOA). Owns a `CustomAccount` smart wallet contract. |
| **Smart wallet** (`CustomAccount`) | The `delegator` in every delegation. Holds funds. Executes calls on behalf of a valid delegation via `execute_from_executor`. |
| **DelegationManager** | Verifies signatures/nonces/caveats and redeems delegations. Source of truth for disabled/registered state. |
| **Policies** contract | Caveat enforcer: target-whitelist, spend-limit, time-restriction. |
| **Delegate** | The keypair authorized to redeem — an agent's session key (backend `agentService` or `mcp-agent`), or any other holder the owner signs a delegation for. |
| **Funder** | A server-held Stellar account (`FUNDER_SECRET_KEY`) that pays fees for every "sponsored" on-chain call, so the owner never needs XLM in their EOA. |

## Part 1 — User workflow: creating a delegation wallet

All steps below are driven by `apps/web/app/dashboard/delegations/hooks/useDelegations.ts` and
`useWallet.ts` calling the single API route `apps/web/app/api/delegate-sdk/route.ts`, which wraps
`@wolf1276/kairos-sdk`'s `KairosClient`.

```
Owner (Freighter)          Web app (API route)              Chain (DelegationManager / CustomAccount)
      |                            |                                      |
      |--- connect wallet -------->|                                      |
      |                            |                                      |
      | 1. Deploy smart wallet (once per owner, useWallet.ts)             |
      |<-- PREPARE_WALLET_DEPLOY --|--- unsigned auth entry -------------->|
      |--- sign auth entry ------->|                                      |
      |--- SUBMIT_WALLET_DEPLOY -->|--- funder submits tx --------------->| CustomAccount deployed
      |                            |                                      |
      | 2. Create delegation (CreateDelegationWizard -> useDelegations.createDelegation)
      |<-- GET_WALLET_DELEGATION --|  (guard: refuse if one is active) -->|
      |<-- PREPARE_DELEGATION -----|  builds unsigned Delegation,          |
      |                            |  caveats = 0xFE markers, hash returned|
      |--- sign hash (SEP-53) ---->|                                      |
      |--- SUBMIT_DELEGATION ----->|  attaches signature                  |
      |<-- PREPARE_REGISTER_DELEGATION -- unsigned auth entry ----------->|
      |--- sign auth entry ------->|                                      |
      |--- SUBMIT_REGISTER_DELEGATION -->|--- funder submits ----------->| register_delegation()
      |                            |                                      | WalletDelegation[owner] = hash
      |<-- PREPARE_SEED_POLICIES --|  unsigned auth entry (bulk)           |
      |--- sign auth entry ------->|                                      |
      |--- SUBMIT_SEED_POLICIES -->|--- funder submits ----------------->| set_policies() seeds real terms
```

Key points:
- **The delegator is always the smart wallet**, never the owner's raw EOA — `redeem_delegations`
  calls `execute_from_executor` on the root delegator, which only `CustomAccount` implements.
- **The owner signs twice with two different mechanisms**: once via SEP-53 `signMessage` over
  the delegation hash (what `CustomAccount.is_valid_signature` checks at redemption), and one or
  more times via `signAuthEntry` for each sponsored on-chain call that needs
  `delegator.require_auth()` (register, seed policies, revoke, enable, set_policy).
- **Caveats are indirection markers, not inline terms.** `PolicyModule.createIndexed` encodes
  each policy as `0xFE ++ policy_id:u64_be` inside the `Delegation.caveats` the owner signs. The
  real terms are seeded separately via `set_policies`, and can be changed later via
  `set_policy`/`set_policies` **without re-signing or re-hashing the delegation** — this is what
  lets the dashboard's "edit policy" flow work without minting a new delegation.
- **One delegation per wallet.** `register_delegation` on-chain rejects a second registration
  while the current one is active (`WalletAlreadyDelegated`); the wizard also checks
  `GET_WALLET_DELEGATION` client-side before starting the flow.

### Managing an existing delegation

- **Revoke / enable a specific delegation**: `useDelegations.revoke`/`enable` →
  `PREPARE_REVOKE_DELEGATION`/`PREPARE_ENABLE_DELEGATION` → owner signs auth entry →
  `SUBMIT_REVOKE_DELEGATION`/`SUBMIT_ENABLE_DELEGATION` → `disable_delegation`/`enable_delegation`.
- **Revoke by wallet** (doesn't need the full `Delegation` struct in hand):
  `useDelegations.revokeByWallet` → `PREPARE_REVOKE_BY_WALLET` → owner signs → `SUBMIT_REVOKE_BY_WALLET`
  → `revoke_by_wallet()`, which disables whatever hash is currently registered for that wallet.
  **Caveat (see audit finding #3):** this only disables the registered hash — any other validly
  signed, unregistered delegation for the same wallet is unaffected.
- **Edit a policy in place**: `useDelegations.updatePolicy` → `PREPARE_SET_POLICY` → owner signs
  → `SUBMIT_SET_POLICY` → `set_policy()` rewrites the terms for that `(delegator, policy_id)`.
  The delegation's hash/signature never change.

## Part 2 — How agents and other clients communicate with the delegation wallet

There are two agent runtimes in this repo today, plus a general SDK path for any other client.

### 2a. Backend Express agents (`backend/`)

```
Owner/UI                Backend (Express)                    Chain
   |                          |                                 |
   |-- POST /agents -------->| createAgent(): creates a new     |
   |                          | Turnkey Ed25519 key (MPC-held,   |
   |                          | never assembled here), funds the |
   |                          | resulting address (testnet)      |
   |<- agent { publicKey } --|                                 |
   |                          |                                 |
   |  (owner creates a delegation via the dashboard wizard,     |
   |   with delegate = agent's publicKey)                       |
   |                          |                                 |
   |-- POST /agents/:id/delegation { delegation } ------------->|
   |                          | attachDelegation(): verifies      |
   |                          | delegate matches agent pubkey,    |
   |                          | checks on-chain not-disabled,     |
   |                          | stores full signed JSON in SQLite |
   |                          | (one shared row per wallet)       |
   |-- POST /agents/:id/strategy { dca | quant } -------------->|
   |                          | destination forced to the         |
   |                          | delegation's own delegator         |
   |-- POST /agents/:id/start ---------------------------------->|
   |                          |                                 |
   |                          | runner.ts tick loop (per agent):  |
   |                          |   re-reads delegation each tick   |
   |                          |   (mid-flight revoke takes effect)|
   |                          |   dca: client.execution.execute() |
   |                          |     redeemer = agent's Turnkey    |
   |                          |     signer (async sign, MPC call) |
   |                          |     delegationChains = [[deleg]]  |
   |                          |     -> redeem_delegations() ----->| moves funds via CustomAccount
   |                          |   quant: submits a real classic   |
   |                          |     Stellar path payment, signed  |
   |                          |     via the same Turnkey signer   |
   |                          |     (does not use the delegation) |
```

Notes:
- Every new agent's private key is created inside Turnkey's MPC cluster
  (`backend/src/turnkey.ts`, `@wolf1276/kairos-turnkey-signer`'s `TurnkeySigner`) and is never
  assembled in this process — `getAgentSigner` fetches a `RemoteSigner` handle keyed by
  Turnkey's `privateKeyId`, and every signature is a network round-trip to Turnkey. Agents
  created before this integration keep signing via their legacy AES-256-GCM-encrypted local
  secret (`backend/src/crypto.ts`) as a fallback; either way, the agent never sees the owner's key.
- `dca` strategy trades move the wallet's funds via the delegation (`redeem_delegations`).
  `quant` strategy trades are executed from the agent's own funded Stellar account and never
  touch the delegation — see `tick.ts`'s `executeQuantTrade`. This is a real behavioral split:
  don't assume all agent trades are delegation-gated.
- Revocation: `POST /agents/:id/delegation/revoke` only flips the backend's local
  `disabled` flag for that wallet — it does not call `revoke_by_wallet` on-chain. To fully
  cut off an agent, revoke on-chain (dashboard) **and** hit this endpoint (or rely on the
  per-tick re-check picking up the on-chain disabled state on its own, since `client.execution.execute`
  will fail once `disable_delegation`/`revoke_by_wallet` has run).

### 2b. MCP agent (`packages/mcp-agent`)

**Each agent identity has its own MPC-backed (Turnkey) private key.** The MCP server is keyed
by `KAIROS_AGENT_ID` (default `"default"`); every id maps to its own Turnkey Ed25519
`privateKeyId` (`keystore.ts`'s `loadOrCreateAgentSigner`), created once and reused
thereafter. The local registry file at `~/.kairos/agents/<agentId>.json` stores only that
`privateKeyId` pointer — never a secret; the key material lives entirely inside Turnkey's MPC
signing cluster and is never assembled in this process. Running N agents means N separate
`KAIROS_AGENT_ID`s (N MCP server entries, e.g. N stdio processes) under one Turnkey
organization, and N separate delegations — one per agent's public key. No two agents ever
share a signing key, so one agent's compromised session cannot be used to redeem another
agent's delegation, and each Turnkey key can be revoked independently of the others.

```
Dashboard export           MCP agent process (KAIROS_AGENT_ID=X)   Turnkey (MPC)   Chain
      |                          |                                   |              |
      | keygen (once, per id) -->| loadOrCreateAgentSigner(X):        |              |
      |                          |   creates a new Ed25519 key ------>| key shares   |
      |                          |   generated across the cluster;    |              |
      |                          |   only privateKeyId + pubkey       |              |
      |                          |   ever come back to this process   |              |
      |<--------- pubkey --------|                                   |              |
      |                          |                                   |              |
      | (owner creates a delegation with delegate = X's pubkey,      |              |
      |  exports the full signed delegation JSON to a local dir)     |              |
      |------------------------->|                                   |              |
      |                          | loadEligibleDelegations():         |              |
      |                          |   reads every *.json in the dir,   |              |
      |                          |   keeps ones where delegate ==     |              |
      |                          |   THIS agent's own pubkey and      |              |
      |                          |   not disabled on-chain            |              |
      |                          |                                   |              |
      |  tool call: execute_action / spend_funds                     |              |
      |                          | resolves each caveat (0xFE marker  |              |
      |                          | -> live on-chain policy terms via  |              |
      |                          | delegation.resolveCaveat()), then  |              |
      |                          | matches target-whitelist / spend-  |              |
      |                          | limit against the request           |              |
      |                          | client.execution.execute():        |              |
      |                          |   builds tx, calls signer.sign() ->| signs with   |
      |                          |   <- raw signature returned -------| key shares   |
      |                          |   submits signed tx --------------------------->| redeem_delegations()
```

The MCP agent has **no** connection to the backend's SQLite store — it is a fully separate,
file-based consumer of the same on-chain delegation primitives. The exported JSON file is the
only channel carrying the full signed `Delegation` struct (chain events only carry hashes, not
enough to redeem); the delegations directory is shared across agents on one machine, and each
agent filters it down to only the files where it is the `delegate`.

### 2c. Any other client (general SDK recipe)

```ts
import { KairosClient, ROOT_AUTHORITY } from '@wolf1276/kairos-sdk';

const client = new KairosClient({ network: 'testnet', contracts: { ... } });

// 1. Owner creates + signs a delegation for some delegate keypair.
const delegation = await client.delegation.create({
  delegate: delegateKeypair.publicKey(),
  delegator: smartWalletAddress,
  caveats: [await client.policy.create({ type: 'spend-limit', token, spendLimit, period })],
  signer: ownerKeypair, // or a callback for hardware/remote signers
});

// 2. Register it as the wallet's active delegation (sponsored, or owner pays fees directly).
await client.delegation.disable /* enable / register via prepareSponsored* + submitSponsored* */;

// 3. Delegate redeems.
await client.execution.execute({
  redeemer: delegateKeypair,
  delegationChains: [[delegation]],
  executions: [{ target, function: 'transfer', args }],
});

// 4. Owner revokes when done.
await client.delegation.revoke(delegation, ownerKeypair);
```

Any client — a CLI, a different backend, a browser extension — can use this same
`create → register → execute → revoke` sequence; the dashboard and both agent runtimes are just
three different front-ends over it.

## Security model summary

- **What policies enforce today**: target-whitelist (checked before every hook), time-restriction
  (checked before every hook), spend-limit (checked only on direct token `transfer`/`xfer` calls —
  see audit finding #5 for what it does *not* catch).
- **What "revoke" actually blocks**: `disable_delegation`/`revoke_by_wallet` set an on-chain flag
  checked at the top of every `redeem_delegations` call — once set, no further redemption of that
  hash succeeds, on any client. But (audit finding #3) it only blocks the *registered* hash, not
  every delegation that was ever signed for that wallet.
- **What backend/local "revoke" does NOT do**: flipping a local DB flag doesn't touch the chain;
  always pair it with the on-chain call if you need a hard stop.
- **Trust boundaries**: the owner's EOA key never leaves Freighter. New agent keys (both
  `backend/` and `packages/mcp-agent`) are MPC-backed via Turnkey — the private key material
  is generated and held as secret shares across Turnkey's cluster and is never assembled in
  the backend/agent process; only a `privateKeyId` handle and the public key ever reach this
  codebase. The one local secret in that design is the Turnkey API key
  (`TURNKEY_API_PRIVATE_KEY`/`TURNKEY_CREDENTIALS_FILE`) — it authenticates requests to
  Turnkey but cannot by itself reconstruct any agent's Ed25519 key; treat it like a root
  credential regardless, since holding it lets you request a signature from every agent key
  in the org. Agents created before Turnkey integration still hold a local
  AES-256-GCM-encrypted secret as a fallback. The funder key pays gas but never gains
  spending power over the wallet — every state-changing call it submits still requires a
  separately signed authorization entry from the delegator when the delegator is a smart wallet.
