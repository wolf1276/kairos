# Mainnet Deployment Checklist

See `docs/MAINNET_RUNBOOK.md` for the full procedure behind each item.

## Build & release

- [ ] WASMs built (`stellar contract build` in `contracts/soroban`)
- [ ] SHA256 of each WASM recorded before upload
- [ ] WASMs uploaded to mainnet (`scripts/deploy-mainnet.ts`)
- [ ] Contract IDs recorded (DelegationManager, Policies, CustomAccount, Registry)
- [ ] `configs/contracts.mainnet.json` updated and cross-checked against a block explorer

## Environment configuration

- [ ] Render env vars updated (`STELLAR_NETWORK=mainnet`, contract IDs, `ALLOWED_ORIGIN`,
      Turnkey production credentials, `AUTH_JWT_SECRET`, reasoning provider key)
- [ ] Vercel env vars updated (`STELLAR_NETWORK=mainnet`, contract IDs + WASM hash,
      `NEXT_PUBLIC_MAINNET_USDC_ISSUER`, `NEXT_PUBLIC_AGENTS_BACKEND_URL`, `AUTH_JWT_SECRET`
      matching Render)
- [ ] Database migrated / confirmed reachable (`kairos-smart-wallets` Postgres)
- [ ] Scheduler enabled and running (`SCHEDULER_INTERVAL_MS` set, backend healthy)
- [ ] Protocol execution enabled (protocol adapters configured for mainnet where applicable)

## Functional verification

- [ ] Wallet onboarding verified (Freighter login → session issued)
- [ ] Smart wallet deployment verified (deploy a real wallet end-to-end)
- [ ] Registry verified (wallet appears/resolves via the mainnet registry contract)
- [ ] Delegation verified (create + redeem a delegation end-to-end)
- [ ] Policy enforcement verified (a policy-violating action is correctly rejected)
- [ ] Autonomous execution verified (an agent executes one real, policy-compliant trade)
- [ ] Activity feed verified (executed actions show up in the dashboard)

## Operations

- [ ] Monitoring enabled (backend `/health`, Render/Vercel deploy alerts)
- [ ] Alerts enabled (failure notifications reach whoever's on call)
