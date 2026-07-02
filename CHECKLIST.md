# Kairos Code Audit Checklist

> Generated from full codebase audit — 2026-07-02

---

## 🚨 CRITICAL — Must Fix Before Launch

### 1. Delegation Wallet Creation Flow (Broken)

- [ ] **`apps/web/app/dashboard/delegations/page.tsx:11`** — `walletOwner` is always `null`. `DelegationKit` (Freighter connect) and the smart wallet deploy button share **no state**. No mechanism passes the connected Freighter address to the deploy function.
- [ ] **`apps/web/app/dashboard/delegations/page.tsx:27,52`** — `handleDeployWallet` and `handleCreateDelegation` use hardcoded placeholder address `GAAAA...WHF`. On-chain deployment will fail.
- [ ] **`apps/web/app/components/DelegationKit.tsx:76-82`** — `useEffect` auto-popups Freighter on mount (calls `handleConnect()` immediately after `tryCheckConnection()`), even when user just wants to browse.

### 2. Paper Trading <> Real Funds Disconnect

- [ ] **`apps/web/lib/paper-trading/index.ts:40-43`** — `loadState()` returns default $10,000 on server (no `localStorage`). The `/api/paper-trade` route always starts fresh. API-based paper trades never reflect user-deposited funds.
- [ ] **`apps/web/app/api/paper-trade/route.ts`** — No integration with Freighter wallet. Paper trading uses a separate virtual $10,000. `DEPOSIT` action exists but is never called with real delegated XLM.
- [ ] **`apps/web/app/api/paper-trade/route.ts:16`** — `new PaperTradingEngine()` uses no address — no user isolation (all trades under `kairos_paper_default`).

### 3. Hardcoded RPC Source Accounts

- [ ] **`packages/sdk/src/wallet/index.ts:146`** — `WalletModule.balance()` uses hardcoded `GBKKNVTF24OKM2V7YRRQHLQIH6PTWDYRFMZPD6AUKB4RXAPSCRKB3XMO`. If unfunded, simulations fail.
- [ ] **`packages/sdk/src/delegation/index.ts:68`** — `DelegationModule.getNonce()` uses the same hardcoded address.

### 4. Contract Config & Naming Fragility

- [ ] **`packages/sdk/src/types/index.ts:10`** — `ContractConfig.smartWallet?: string` vs config files using `customAccount`. SDK bridges via `smartWallet: config.customAccount` — brittle.

---

## 🔴 HIGH — Must Fix for Feature Completeness

- [ ] **`apps/web/app/api/delegate-sdk/route.ts`** — No `LIST` action for fetching delegations (noted as TODO in delegations page).
- [ ] **`apps/web/app/dashboard/delegations/page.tsx:126-127`** — Missing `PolicyEditor` component (noted as TODO).
- [ ] **`packages/sdk/src/client/index.ts:127-136`** — `pollTransaction` uses raw `fetch` instead of `this.rpcProvider.getTransaction()`.

---

## 🟡 MODERATE — Should Fix

### SDK & Backend

- [ ] **`packages/sdk/src/utils/index.ts:16-21`** — `getAddressXdrBytes` fallback uses regex to extract hex from invalid strkeys — can silently return wrong data.
- [ ] **`apps/web/lib/paper-trading/index.ts:115,155`** — Trade IDs generated with `Math.random()` — not cryptographically secure (acceptable for demo, should use crypto UUID for production).

### Rust Contracts

- [ ] **`contracts/soroban/contracts/custom-account/src/lib.rs:54-71`** — `is_valid_signature()` always returns `true`. `ed25519_verify` panics on failure instead of returning `false`. Contract traps rather than gracefully failing.
- [ ] **`contracts/soroban/contracts/custom-account/src/lib.rs:83-103`** — `__check_auth` branching: if `Bytes::try_from_val` succeeds on arbitrary data, it panics on ed25519 failure. Fallback only triggers if parsing fails — potential bypass vector.

### Frontend

- [ ] **`apps/web/app/page.tsx:148`** — Landing page `/docs` link goes nowhere (no route created).
- [ ] **`apps/web/app/page.tsx:149`** — GitHub link is generic `https://github.com` instead of actual project URL.
- [ ] **`apps/web/app/hooks/usePaperTrading.ts:49`** — `eslint-disable` comment for `react-hooks/set-state-in-effect`.
- [ ] **`apps/web/app/dashboard/trade/page.tsx:68`** — `useSyncExternalStore` no-op pattern for hydration-safe timestamps (works but unusual).

---

## 🔵 LOW — Infrastructure & Config

- [ ] **`.env.example:17`** — `FUNDER_SECRET_KEY` is empty (required for on-chain ops).
- [ ] **`.env.example:22`** — `HUGGINGFACE_API_KEY` is placeholder value (required for AI advisor).
- [ ] **`.env.example:9-12`** — Placeholder contract IDs may not match deployed instances.
- [ ] **`pnpm-workspace.yaml`** — `apps/comming-soon` workspace referenced but gitignored.
- [ ] **`contracts/soroban/contracts/policies/`** — Rust contract named `Policies` vs SDK config key `policyEngine` — naming inconsistency.

---

## Priority Fix Order

```
1.  DelegationKit ↔ DelegationsPage state bridge (critical flow)
2.  Remove hardcoded source accounts in SDK
3.  Fix Freighter auto-popup on mount
4.  Bridge paper trading with Freighter balance
5.  Add LIST action to delegate-sdk API
6.  Add PolicyEditor / delegation-with-policies creation
7.  Fix landing page dead links
8.  User isolation in paper-trade API
9.  Rust contract signature handling
10. All MODERATE items
11. All LOW items
```
