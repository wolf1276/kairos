# Stellar Mainnet XLM Budget — Kairos "Go-Live"

## Context
Kairos is a Soroban (Stellar smart-contract) project. `scripts/deploy-testnet.ts` deploys the
protocol, and `packages/sdk/src/wallet/index.ts` deploys one **CustomAccount smart-wallet
instance per user** at onboarding (sponsored by a funder). The user wants the **full go-live
XLM budget** on mainnet: one-time protocol deploy + per-user wallet instances + ongoing funder
float. No `.wasm` artifacts are currently built, so sizes are estimated (exact numbers require
a build + testnet dry-run, see Validation).

## What gets deployed
From `scripts/deploy-testnet.ts` (4 protocol contracts, 4 distinct WASMs):
- `delegation_manager.wasm` → 1 contract instance
- `policies.wasm` → 1 contract instance
- `custom_account.wasm` → uploaded once, then 1 template instance (and reused for all per-user wallets)
- `registry.wasm` → 1 contract instance
Plus 3 `init`/`invoke` calls (manager, custom-account, registry).

At runtime (`packages/sdk/src/wallet/index.ts`):
- Each onboarding/user → 1 **CustomAccount** instance deployed from the already-uploaded wasm.

## Cost model (Stellar mainnet, Protocol 20+)
- Contract instance + WASM are ledger entries subject to **rent** (prepaid for TTL).
- Rule of thumb: each contract instance needs ~**1 XLM** available (min balance / rent prepay);
  most is recoverable if the entry is archived. Per-call tx fees are tiny (~0.00001–0.001 XLM).
- `stellar contract deploy`/`upload` automatically charge the rent from the deployer; the deploy
  **fails if the deployer balance < required rent**, so over-fund the deployer.

## Headline total (what the user asked for)
- **Smart contracts (all 4: delegation-manager, policies, custom-account, registry + their 4 WASMs):**
  **~6–7 XLM required**, fund the deployer with **~10 XLM** to absorb rent/TTL headroom.
- **SDK (`@wolf1276/kairos-sdk` + packages):** off-chain TypeScript, published to npm / imported —
  **0 XLM**. It only *calls* the contracts above.
- **Total to deploy all smart contracts + ship the SDK: ~10 XLM** on the deployer (of which the
  ~4 XLM contract min balances are recoverable; non-refundable rent/fees < 0.5 XLM).
- To make it *operable* (funder pays SDK-sponsored calls + TTL extensions): add **~10–20 XLM** float.
  → **All-in go-live ≈ 25 XLM.** Per-user CustomAccount instances (created by the SDK at onboarding)
  are **extra, ~1.0–1.5 XLM each**, and scale with users.

> The user's explicit ask ("deploy all my smart contracts plus SDK") = the ~10 XLM deployer fund.
> The larger "full go-live" table below adds users + operational float for completeness.

## Estimated budget (ranges; mainnet fees ≈ testnet fees in stroops)

### 1. One-time protocol deploy (~6–10 XLM)
| Item | Qty | XLM each | Subtotal |
|------|-----|----------|----------|
| Contract instances (min balance + rent) | 4 | ~1.0 | ~4.0 |
| WASM storage rent (≈30–80 KB each) | 4 | ~0.03–0.15 | ~0.1–0.6 |
| Init/invoke tx fees | 3 | <0.01 | <0.05 |
| Deployer account min balance | 1 | 1.0 | 1.0 |
| **Subtotal** | | | **~6–7 XLM** |
Recommend **~10 XLM** on the deployer to avoid rent shortfall failures.

### 2. Per-user CustomAccount instances (linear with users)
- Each instance reuses the uploaded custom_account wasm → only instance rent + min balance:
  **~1.0–1.5 XLM per user** (sponsored by funder).
- Illustrative: 50 users ≈ 50–75 XLM · 100 users ≈ 100–150 XLM · 1,000 users ≈ 1,000–1,500 XLM.

### 3. Operational funder/relayer float (~10–20 XLM)
- `FUNDER_SECRET_KEY` pays all sponsored calls (`register_delegation`, `redeem_delegations`,
  `extend_ttl` on critical entries). Per-call fees are negligible, but TTL extensions recur.
- Keep **~10–20 XLM** float in the funder for steady-state; raise with throughput.

### Full go-live budget (illustrative)
| Scenario | Deploy | Users | Float | Total (mostly recoverable min balances) |
|----------|--------|-------|-------|------------------------------------------|
| Minimal launch | ~10 | 0 | ~15 | **~25 XLM** |
| 50 users | ~10 | ~60 | ~15 | **~85 XLM** |
| 100 users | ~10 | ~125 | ~20 | **~155 XLM** |
| 1,000 users | ~10 | ~1,250 | ~20 | **~1,280 XLM** |

> Non-refundable portion (rent + tx fees) is small — typically <5% of the above; the bulk is
> recoverable contract min balances returned if entries are removed/archived.

## Exact-number procedure (do this to replace estimates)
1. Build: `stellar contract build` in `contracts/soroban` (needs Rust + `wasm32v1-none` target).
2. Point a copy of `scripts/deploy-testnet.ts` at **testnet** (already configured) and run it.
   The CLI prints each upload/deploy fee + rent in stroops — **these equal mainnet fees**.
3. Capture: per-WASM upload cost, per-instance deploy cost, and recommended TTL extensions.
4. For per-user cost, run `examples/create-wallet.ts` once on testnet and read its fee.
5. Multiply by expected user count; add 10–20 XLM funder float.

## Risks / considerations
- **Pre-fund deployer & funder from an exchange** — `friendbot` (testnet faucet) does NOT exist on
  mainnet. Use `STELLAR_NETWORK=mainnet` passphrase `Public Global Stellar Network ; September 2015`
  and RPC `https://soroban-mainnet.stellar.org` (or a provider like QuickNode/Validation Cloud).
- **TTL / rent eviction**: entries expire; budget recurring `extend_ttl` (covered by funder float).
- **Min balances are recoverable** but locked while contracts live — don't treat them as spendable.
- Exact WASMs not yet built, so instance/WASM sizes (and thus rent) are estimated, not measured.
