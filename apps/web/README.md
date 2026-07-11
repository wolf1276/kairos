<div align="center">
  <img src="./public/logo.png" alt="Kairos" width="72" height="72" />

  <h1>Kairos Dashboard</h1>

  <p>The Kairos web app — wallet onboarding, portfolio dashboard, agents console, and price API.</p>
</div>

---

A [Next.js 16](https://nextjs.org) (App Router) frontend for the [Kairos](../../README.md) delegation framework. It handles Freighter connection and Smart Wallet onboarding, renders the portfolio and agents consoles served by the [backend](../../backend/README.md), and ships a small GraphQL price API backed by a Binance oracle.

> [!NOTE]
> This app talks to two backends: the **Kairos SDK / Soroban contracts** directly (onboarding,
> delegations) and the **agent backend** over HTTP (agents, positions, audit). Live on-chain agent
> execution depends on a signer that isn't functional yet — see the root
> [project status](../../README.md#what-works-today). Paper-mode agents work end to end.

## Pages

| Route | What it does |
| :--- | :--- |
| `/` | Landing page. |
| `/docs` | Getting-started walkthrough (connect → deploy Smart Wallet → delegate). |
| `/dashboard` | Portfolio overview — balances, protocol allocation, performance chart. |
| `/dashboard/agents` | Agents console — create agents, attach/revoke delegations, configure strategies, view decisions/performance/audit. |
| `/dashboard/context` | Context Layer inspector — the exact `AgentContext` (market, capital, policy, system, historical) the backend assembles for an agent, straight from `GET /api/agents/:id/context`. |

## API routes

| Route | Purpose |
| :--- | :--- |
| `POST /api/connect/check` · `prepare` · `submit` · `register` | Smart Wallet onboarding — checks for an existing wallet, prepares a sponsored deploy, submits the Freighter-signed auth entry, and persists the mapping. Owned by `OnboardingService`. |
| `POST /api/delegate-sdk` | Single action-dispatch endpoint for all SDK delegation operations (a `type`-keyed switch: `PREPARE_/SUBMIT_` wallet-deploy, delegation register/revoke/enable, `SET_POLICY`/`SEED_POLICIES`, `EXECUTE`, `BALANCE`, `DELEGATION_STATUS`, …). Uses the sponsored funder pattern; serializes bigint/`Uint8Array` delegation fields to JSON-safe forms. |
| `POST /api/intent/parse` · `POST /api/analyze` | Intent parsing and market analysis (Hugging Face, with deterministic fallback). `analyze` proxies the backend's `/api/strategies`. |
| `GET/POST /api/graphql` | GraphQL price API (graphql-yoga) fed by the Binance oracle in `oracle/`. |

## Onboarding & auth

There are no passwords or accounts — **the connected Stellar address is the identity**. Two independent, Freighter-signature-gated layers:

- **Onboarding** — deploys (or recovers) a per-owner `CustomAccount` Smart Wallet via `/api/connect/*`. Sponsored: the funder pays fees, the user only signs the Soroban auth entry. If persistence fails after an on-chain deploy, the client re-registers the returned address rather than re-deploying — an owner can never end up with two Smart Wallets.
- **Agent-backend session (SEP-53)** — a challenge/verify handshake yields a short-lived bearer JWT used on every agent-backend call.

These are composed so pages read a single, already-sequenced wallet state:

| Hook | Owns |
| :--- | :--- |
| `useWallet` | Freighter / wallet-kit connection mechanics |
| `useAuthentication` | SEP-53 login handshake + bearer token |
| `useSmartWallets` | Smart Wallet list / selection / balances |
| `useOnboarding` | First-time deploy UI state (delegates to `OnboardingService`) |
| `useSmartWallet` | Composes all of the above — the only hook pages call (via `useWalletContext`) |

## Oracle & indicators

`oracle/` is a self-contained price engine: `BinanceOracle` streams live prices and `IndicatorEngine` computes technical indicators, surfaced through the GraphQL API and the charting components. This feeds the app's charts and price displays only — it is separate from the agent decision pipeline, which uses Stellar Horizon market data in the backend. See [`oracle/README.md`](./oracle/README.md).

## Business logic (`lib/`)

Feature-grouped, deterministic logic that runs client/server-side (distinct from the agent backend):

- `lib/decision/` — `types.ts` (shared decision types), `displayMapper.ts` (mode display summaries). Natural-language intent parsing and advisory decisions now live server-side in `backend/src/intentParser.ts` and `backend/src/decisionEngine.ts` (LLM fallback chain: OpenRouter → GPT-OSS → Nvidia → Gemini, in `backend/src/llmProviders.ts`).
- `lib/strategy/` — `StrategyEngine.evaluate(MarketSnapshot)`: EMA20/EMA50 golden/death-cross signal (needs ≥52 candles).
- `app/lib/sdk/` — server-side SDK glue: `getKairosClient`, `getFunderKeypair`, registry lookup/register, sponsored wallet deploy.

## Environment variables

| Variable | Purpose |
| :--- | :--- |
| `NEXT_PUBLIC_AGENTS_BACKEND_URL` | Agent-backend base URL (default `http://localhost:4001`). Inlined into the client bundle at build time — must be set before the build. |
| `FUNDER_SECRET_KEY` | Funder keypair for sponsored onboarding/delegation operations. |
| `STELLAR_NETWORK`, `STELLAR_RPC_URL`, `STELLAR_NETWORK_PASSPHRASE` | Stellar network config. |
| `DELEGATION_MANAGER_CONTRACT_ID`, `POLICY_CONTRACT_ID`, `CUSTOM_ACCOUNT_CONTRACT_ID`, `CUSTOM_ACCOUNT_WASM_HASH`, `REGISTRY_CONTRACT_ID` | Deployed contract config (from [`configs/contracts.testnet.json`](../../configs/README.md)). |

## Tests

- Unit: Vitest (`pnpm test`) — route handlers (`app/api/**/route.test.ts`), hooks, SDK glue.
- E2E: Playwright (`pnpm e2e`) — `e2e/demo.spec.ts` (mocked-Freighter onboarding demo) and `e2e/devMode.spec.ts` (verifies hidden Developer Mode stays inert for non-allowlisted callers).

> [!NOTE]
> `apps/comming-soon` appears in the workspace config but has no tracked source — only `apps/web` exists today. (A "coming soon" UI component lives at `app/components/ui/ComingSoon.tsx`.)

## Getting started

```bash
pnpm install                 # from the repo root
cp ../../.env.example .env.local   # fill in Stellar + contract vars (see root README)
pnpm run dev                 # http://localhost:3000
```

## Scripts

| Command | Description |
| :--- | :--- |
| `pnpm run dev` | Start the dev server |
| `pnpm run build` | Production build |
| `pnpm run start` | Serve the production build |
| `pnpm run lint` | ESLint |
| `pnpm run e2e` | Playwright end-to-end tests (`pnpm run e2e:ui` for the UI runner) |

## Tech stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · `@creit.tech/stellar-wallets-kit` + `@stellar/freighter-api` · `@wolf1276/kairos-sdk` · lightweight-charts · graphql-yoga · Playwright.

> [!IMPORTANT]
> This project pins a Next.js version whose APIs and conventions may differ from older releases.
> Check `node_modules/next/dist/docs/` before writing new app code, and heed deprecation notices.
