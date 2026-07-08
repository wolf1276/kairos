# @wolf1276/kairos-turnkey-signer

MPC-backed remote signer for Kairos agent keys. Each agent's Ed25519 key is generated and held as secret shares inside [Turnkey](https://www.turnkey.com/)'s signing cluster and **never assembled in this process's memory** — every signature is a network round-trip to Turnkey.

This package implements the SDK's [`RemoteSigner`](../sdk/README.md) interface, so a `TurnkeySigner` is a drop-in wherever `@wolf1276/kairos-sdk` accepts a `Signer` (`Keypair | RemoteSigner`) — for example `client.execution.execute({ redeemer })` or `client.submitTransaction(tx, signer)`. The SDK never learns that Turnkey is involved; the `RemoteSigner` abstraction is the only contract between them.

> [!WARNING]
> Turnkey-backed **live on-chain signing is not yet functional end to end** across Kairos. This signer is the intended production signing path, but today the working path is **paper mode** in the [backend](../../backend/README.md). Treat this package as the live-signing implementation under active development.

## Where it fits

| Consumer | Usage |
| :--- | :--- |
| [`backend/`](../../backend/README.md) | `agentService` creates one Turnkey key per agent (`TurnkeySigner.forNewAgent`) and resolves a remote signer per tick (`TurnkeySigner.forExistingKey`). |
| [`packages/mcp-agent/`](../mcp-agent/README.md) | Loads/creates a Turnkey-backed session key for the agent identity it exposes over MCP. |
| [`packages/sdk/`](../sdk/README.md) | Defines the `RemoteSigner` interface this package implements (peer dependency). |

## Design: the one local secret

The only secret that lives locally is the **Turnkey API key** (`apiPrivateKey`). It authenticates requests to Turnkey but, by itself, **cannot reconstruct any agent's Ed25519 private key**. Agent keys are created inside Turnkey (`createTurnkeyAgentKey`) and referenced only by an opaque `privateKeyId`. Only that handle and the derived Stellar `G...` address ever leave Turnkey.

## Public API

Source of truth: [`src/index.ts`](./src/index.ts).

### Credentials & client

| Symbol | Description |
| :--- | :--- |
| `interface TurnkeyCredentials` | `{ apiPublicKey, apiPrivateKey, organizationId, baseUrl? }`. |
| `loadTurnkeyCredentials(path?)` | Loads credentials from env, or from the exported-key JSON file at `path` / `TURNKEY_CREDENTIALS_FILE`. `TURNKEY_ORGANIZATION_ID` is always required. Throws with an explicit message if a required value is missing. |
| `createTurnkeyClient(creds)` | Builds a `TurnkeyClient` (P-256 `ApiKeyStamper`, default base URL `https://api.turnkey.com`). |

### Key management

| Symbol | Description |
| :--- | :--- |
| `interface TurnkeyAgentKey` | `{ privateKeyId, publicKey }` — the opaque Turnkey handle plus the derived Stellar `G...` address. |
| `createTurnkeyAgentKey(client, organizationId, agentLabel)` | Creates a new `CURVE_ED25519` key inside Turnkey for one agent; returns its handle and Stellar address. Key material never enters this process. |
| `getTurnkeyStellarPublicKey(client, organizationId, privateKeyId)` | Reads a key's raw Ed25519 public key and encodes it as a Stellar `G...` address. |

### `class TurnkeySigner implements RemoteSigner`

Private constructor; instantiate via a static factory.

| Member | Description |
| :--- | :--- |
| `static forExistingKey(client, organizationId, privateKeyId)` | Async factory binding a signer to an already-created Turnkey key. |
| `static forNewAgent(client, organizationId, agentLabel)` | Async factory that creates a fresh Turnkey key, then binds a signer to it. |
| `get id` | The bound `privateKeyId`. |
| `publicKey()` | The signer's Stellar `G...` address. |
| `sign(payload: Buffer): Promise<Buffer>` | Signs the transaction's 32-byte signature base via Turnkey's raw-payload activity (`HASH_FUNCTION_NOT_APPLICABLE`, hex encoding) and returns the 64-byte `R‖S` Ed25519 signature. Throws if Turnkey returns no signature or an unexpected length. |

## Environment variables

| Variable | Required | Purpose |
| :--- | :--- | :--- |
| `TURNKEY_ORGANIZATION_ID` | Yes | The Turnkey (sub-)organization all agent keys live under. |
| `TURNKEY_CREDENTIALS_FILE` | One of these two | Path to the exported API-key JSON (`{ publicKey, privateKey }`). |
| `TURNKEY_API_PUBLIC_KEY` / `TURNKEY_API_PRIVATE_KEY` | One of these two | The API key pair, if not using a credentials file. |
| `TURNKEY_BASE_URL` | No | Overrides the default `https://api.turnkey.com`. |

## Build

```bash
pnpm --filter @wolf1276/kairos-turnkey-signer build      # tsup → dual ESM (.js) + CJS (.cjs) + .d.ts
pnpm --filter @wolf1276/kairos-turnkey-signer typecheck  # tsc --noEmit
```

Build config: [`tsup.config.ts`](./tsup.config.ts) (ESM + CJS, declarations on; `@stellar/stellar-sdk` and `@wolf1276/kairos-sdk` marked external). This is a `private` workspace package (not published).

> [!NOTE]
> [`src/index.ts`](./src/index.ts) wraps `@turnkey/http`'s generated activity client. Turnkey occasionally renames activity result fields (`createPrivateKeysResultV2`, `signRawPayloadResult.{r,s}`) across versions — diff the generated types before bumping `@turnkey/http`.

## Related

- [`packages/sdk`](../sdk/README.md) — defines `RemoteSigner` / `Signer`.
- [`backend`](../../backend/README.md) — per-agent Turnkey key lifecycle and signing.
- [`packages/mcp-agent`](../mcp-agent/README.md) — MCP agent identity backed by this signer.
