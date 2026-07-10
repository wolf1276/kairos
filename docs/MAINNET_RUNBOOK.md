# Mainnet Deployment Runbook

Phase 1 (contract audit, testnet deployment, security review — see
`docs/security/MAINNET_AUDIT.md`) is done. This runbook covers the *future*
mainnet cutover: contracts, Render backend, Vercel frontend.

## 1. Prerequisites

- Audited contract source at the commit intended for mainnet (no unaudited changes since the
  last security review).
- `stellar` CLI installed and configured with network `mainnet`.
- A funded mainnet deployer account, and a separate `deployer` CLI key alias
  (`stellar keys generate deployer --network mainnet`, or import an existing key).
- Render account with access to the project's Blueprint (`render.yaml`).
- Vercel account with access to the project.
- Turnkey production organization + API key pair (MPC key custody — must be a **separate**
  Turnkey org from testnet; never reuse testnet Turnkey credentials for mainnet).
- A managed Postgres instance for smart-wallet ownership (Render Blueprint provisions this).

## 2. Fund the deployer account

The deployer account pays for WASM uploads and contract deploys (Soroban resource fees). Fund
it with real XLM before running anything — there is no mainnet friendbot. Confirm balance with:

```
stellar keys address deployer
# then check the balance on https://stellar.expert or via horizon.stellar.org
```

## 3. Build and record WASM hashes

```
cd contracts/soroban
stellar contract build
sha256sum target/wasm32v1-none/release/*.wasm
```

Record these SHA256 hashes somewhere durable (release notes / this repo's release process)
*before* uploading, so the on-chain WASM hash can be cross-checked against a locally computed
one.

## 4. Run the mainnet deploy script

`scripts/deploy-mainnet.ts` mirrors `scripts/deploy-testnet.ts` but targets `mainnet` only,
fails fast (throws) on any error, and refuses to overwrite an existing
`configs/contracts.mainnet.json` unless `--confirm`/`--force` is passed.

```
pnpm ts-node scripts/deploy-mainnet.ts
```

Deployment order (dependency order, matches testnet):

1. Upload `custom_account.wasm` → get WASM hash.
2. Deploy `delegation_manager.wasm` (constructor: `--owner <deployer>`).
3. Deploy `policies.wasm` (constructor: `--delegation_manager <id from step 2>`).
4. Deploy a `custom_account.wasm` instance (constructor: `--owner`, `--delegation_manager`).
5. Deploy `registry.wasm` (constructor: `--admin <deployer>`).

All contracts use `CreateContractV2` — the constructor runs atomically inside the deploy
operation, so there is no on-chain window where a contract exists uninitialized (see
`docs/security/MAINNET_AUDIT.md`, P0-1).

Do **not** run this script as part of CI/CD. It is a manual, operator-run step.

## 5. Verify `configs/contracts.mainnet.json`

The script writes:

```json
{
  "delegationManager": "C...",
  "policyEngine": "C...",
  "customAccount": "C...",
  "customAccountWasmHash": "...",
  "registry": "C..."
}
```

Cross-check each contract ID and the WASM hash against what the deploy script printed and
against `stellar contract info` / a block explorer (e.g. stellar.expert) before proceeding.

## 6. Update Render (backend)

In the Render dashboard for `kairos-agent-backend`, set (see `DEPLOYMENT.md` for the full
variable table):

- `STELLAR_NETWORK=mainnet`
- `DELEGATION_MANAGER_CONTRACT_ID`, `POLICY_CONTRACT_ID`, `CUSTOM_ACCOUNT_CONTRACT_ID` — from
  `configs/contracts.mainnet.json`.
- `ALLOWED_ORIGIN` — the production Vercel origin.
- Turnkey production credentials (`TURNKEY_ORGANIZATION_ID`, `TURNKEY_API_PUBLIC_KEY` /
  `TURNKEY_API_PRIVATE_KEY`).
- `OPENROUTER_API_KEY` (or whichever `REASONING_PROVIDER` is selected).
- `AUTH_JWT_SECRET` — Render can auto-generate this (`generateValue: true` in `render.yaml`);
  it must be copied to Vercel's `AUTH_JWT_SECRET` verbatim (sessions are verified against it).

Trigger a redeploy after saving env vars.

## 7. Update Vercel (frontend)

In Vercel Project Settings → Environment Variables (scoped to Production), set:

- `STELLAR_NETWORK=mainnet`
- `DELEGATION_MANAGER_CONTRACT_ID`, `POLICY_CONTRACT_ID`, `CUSTOM_ACCOUNT_CONTRACT_ID`,
  `CUSTOM_ACCOUNT_WASM_HASH` — from `configs/contracts.mainnet.json`.
- `REGISTRY_CONTRACT_ID` (optional, but recommended).
- `NEXT_PUBLIC_MAINNET_USDC_ISSUER` — required for mainnet; `usdcIssuerForNetwork()`
  (`apps/web/app/lib/stellar.ts`) throws at request time if unset.
- `NEXT_PUBLIC_AGENTS_BACKEND_URL` — the Render backend's public URL.
- `AUTH_JWT_SECRET` — must match Render's value exactly.

`NEXT_PUBLIC_*` vars are inlined at build time — set them before triggering the production
build/redeploy, not after.

## 8. Verification steps

Work through `docs/MAINNET_CHECKLIST.md` end to end. At minimum, before announcing mainnet is
live:

- Confirm each contract ID on a mainnet block explorer.
- Deploy one real smart wallet through the live frontend and confirm it appears in the backend's
  smart-wallets DB.
- Exercise one delegation + policy-enforced execution end-to-end with a small real amount.
- Confirm activity feed / registry reads resolve against the mainnet registry contract.

## 9. Rollback procedure

Contracts are immutable once deployed — there is no "rollback" for a bad contract deploy, only
"deploy a corrected version and repoint config at it." If a deployed contract is wrong or
compromised:

1. Do not point Render/Vercel env vars at it (or revert them to the last-known-good IDs).
2. Re-run `scripts/deploy-mainnet.ts --confirm` after fixing the underlying issue, producing new
   contract IDs.
3. Update `configs/contracts.mainnet.json`, Render, and Vercel with the new IDs.
4. Redeploy Render and Vercel.

For a bad *app* deploy (backend/frontend code, not contracts), use Render's and Vercel's normal
redeploy-previous-version flows — no contract changes required.

## 10. Common failure modes

| Symptom | Likely cause | Recovery |
| :--- | :--- | :--- |
| `deploy-mainnet.ts` throws "already exists" | `configs/contracts.mainnet.json` already has values from a prior run | Confirm you actually intend to redeploy, then re-run with `--confirm` |
| Deploy script throws parsing a contract ID/WASM hash | `stellar` CLI output format changed, or the upload/deploy command itself failed | Read the full command output printed above the error; fix the underlying `stellar` CLI issue, don't just retry blindly |
| Deploy fails with insufficient balance | Deployer account underfunded | Fund the deployer account with more XLM, retry |
| Frontend throws "USDC issuer not configured" on mainnet | `NEXT_PUBLIC_MAINNET_USDC_ISSUER` unset in Vercel | Set it, trigger a rebuild (env var is build-time inlined) |
| Backend CORS blocks the real frontend | `ALLOWED_ORIGIN` unset or wrong on Render | Set it to the exact Vercel origin, redeploy |
| Sessions fail to verify after deploy | `AUTH_JWT_SECRET` mismatch between Render and Vercel | Make them identical, redeploy both |
| SQLite data (agents/trades) wiped after a Render redeploy | Render plan without a persistent disk | Confirm the `agents-data` disk is attached and the service is on a disk-backed plan (see `render.yaml`) |
