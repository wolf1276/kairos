# Project Structure

```
kairos/
├── apps/
│   ├── web/                          # Next.js 16 web application (Dashboard & API)
│   │   ├── app/                      # Next.js App Router pages, API routes, components
│   │   ├── components/               # Shadcn UI primitives (button, etc.)
│   │   ├── e2e/                      # Playwright end-to-end tests
│   │   ├── lib/                      # Core business logic
│   │   │   ├── decision/             # AI/strategy decision engine + policy gate
│   │   │   ├── paper-trading/        # Paper trading simulation engine
│   │   │   └── strategy/             # Quantitative strategy engine (EMA crossover)
│   │   ├── oracle/                   # Binance price oracle + indicator engine
│   │   ├── public/                   # Static assets (images, SVGs)
│   │   └── scripts/                  # Build-time scripts (patch-tw-animate-css)
│   └── comming-soon/                 # Standalone pre-launch landing page
│
├── packages/
│   └── sdk/                          # @wolf1276/kairos-sdk — TypeScript SDK
│       ├── src/                      # Source (client, wallet, delegation, policy, etc.)
│       ├── tests/                    # Vitest unit tests
│       └── examples/                 # Usage examples
│
├── contracts/
│   └── soroban/                      # Soroban Rust smart contracts (Cargo workspace)
│       ├── contracts/
│       │   ├── delegation-manager/   # Core delegation logic + replay protection
│       │   ├── custom-account/       # Smart wallet (account abstraction)
│       │   └── policies/             # Composable caveat enforcers
│       └── Cargo.toml                # Workspace root
│
├── configs/
│   └── contracts.testnet.json        # Deployed Stellar contract IDs (testnet)
│
├── scripts/                          # Monorepo-level executable scripts
│   ├── deploy-testnet.ts             # Contract deployment to Stellar testnet
│   ├── test-integration.ts           # SDK integration test (live testnet)
│   └── demo-e2e.ts                   # Full end-to-end demo script
│
├── docs/
│   ├── architecture/                 # Architecture design docs, reports, progress
│   ├── api/                          # SDK API reference
│   ├── deployment/                   # Deployment guide (placeholder)
│   └── security/                     # Security audit & contract-level security model
│   ├── CHANGELOG.md                  # Contract changelog
│   ├── MIGRATION.md                  # SDK migration guide
│   └── TASKS.md                      # Development task checklist
│
├── .github/workflows/
│   └── ci.yml                        # CI pipeline (contracts, SDK, app, JSON checks)
│
├── .env.example                      # Environment variable documentation
├── .gitignore
├── README.md
├── SECURITY.md
├── package.json                      # Root workspace package.json
├── pnpm-workspace.yaml               # pnpm workspace configuration
├── vercel.json                       # Vercel deployment configuration
└── PROJECT_STRUCTURE.md              # This file
```

## Directory Explanations

### `apps/` — Application Packages
Each subdirectory is a deployable application (Next.js, etc.). The main dashboard lives in `apps/web/`. The pre-launch landing page lives in `apps/comming-soon/`.

### `packages/` — Shared Packages
Internal libraries published as workspace packages. Currently only `@wolf1276/kairos-sdk`.

### `contracts/` — Smart Contracts
Soroban Rust smart contracts organized as a Cargo workspace. Each contract in its own subdirectory.

### `configs/` — Shared Configuration
Runtime configuration files (deployed contract IDs, network configs).

### `scripts/` — Executable Scripts
Root-level scripts for deployment, testing, and demos. These run via `npx tsx` from the root.

### `docs/` — Documentation
Consolidated documentation including architecture reports, API references, security audits, and task tracking.

## Architectural Decisions

1. **Feature-grouped frontend code**: Business logic in `apps/web/lib/` is organized by feature (decision, paper-trading, strategy) rather than by file type.

2. **Flat contracts layout**: The Cargo workspace uses `contracts/*` member pattern, keeping each contract as a peer.

3. **Workspace-aware root**: The root `package.json` manages only cross-cutting dependencies. App-specific deps live in their respective `package.json`.

4. **Configuration isolation**: Deployed contract IDs live in `configs/`, not in source code or environment files.

5. **Documentation consolidation**: Cross-cutting documentation (architecture, security, API) lives in `docs/`. Package-specific docs (README, CHANGELOG) remain with their packages.

## Naming Conventions

| Layer | Convention | Example |
|-------|-----------|---------|
| Directories | `kebab-case` | `paper-trading/`, `delegation-manager/` |
| TypeScript files | `camelCase.ts` | `hfIntentParser.ts` |
| React components | `PascalCase.tsx` | `DelegationKit.tsx` |
| Rust source files | `snake_case.rs` | `lib.rs`, `test.rs` |
| Config files | `kebab-case` | `contracts.testnet.json` |
| Docs | `UPPER_CASE.md` | `README.md`, `SECURITY.md` |

## Where to Add New Files

- **New API route**: `apps/web/app/api/<name>/route.ts`
- **New page**: `apps/web/app/<name>/page.tsx`
- **New React component**: `apps/web/app/components/<Name>.tsx`
- **New shared component**: `apps/web/components/ui/<name>.tsx`
- **New SDK feature**: `packages/sdk/src/<feature>/index.ts`
- **New Soroban contract**: `contracts/soroban/contracts/<name>/` + add to workspace members
- **New script**: `scripts/<name>.ts`
- **New config**: `configs/<name>.json`
- **New doc**: `docs/<section>/<name>.md`
